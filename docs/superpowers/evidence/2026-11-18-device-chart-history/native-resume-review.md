# Native optional overlay resume review

Reviewed the uncommitted native lifecycle implementation against `docs/superpowers/specs/2026-11-18-device-chart-history.md` on the existing workspace. Read-only source review; no production code, Git, configuration, device, or shared JVM/Gradle build changes. The only write is this report. Runtime regressions below are deterministic source-traced interleavings; they were not executed on a device in this review.

## Findings

### [P2] Stop further HTTP requests when the screen goes off

Primary location: `android-wrapper/app/src/main/java/cn/mu5120/console/BackgroundMonitorService.java:108-113`; cancellation implementation at lines 514-517. The screen-off receiver invalidates `configGeneration` and calls `stopFastPolling()`, which uses `fastPollTask.cancel(false)`. That suppresses future scheduled polls but deliberately lets the active poll finish. The active `routerClient.dashboard()` at line 469 has no lifecycle cancellation or per-request gate: `MonitorRouterClient.java:55-85` performs the status/login flow, six groups, station lists, and the gauge request before the service checks the generation and screen state at lines 470-471.

Deterministic reproduction:

1. In gauge88-csv mode, enable the overlay, put the app in the background, and keep the screen on.
2. Let a native dashboard poll enter its factory status request; hold that HTTP response in a test server.
3. Deliver screen-off and wait until the runtime receiver has stopped the scheduled future.
4. Release a valid status response with `loginfo: ok` while the screen remains off.
5. Observe subsequent signal, temperature, resources, locks, neighbors, features, station-list, LAN-list, and gauge-state HTTP requests. The final snapshot is rejected, but the newly initiated requests already occurred after screen-off.

This violates the spec's “息屏不继续查询” requirement. In-flight response rejection is not equivalent to stopping the remaining query sequence. Disabling also calls `shutdownNow()`, but the factory request path (`MonitorRouterClient.java:223-247`) has no interrupt gate, so cancellation needs to cover the request chain rather than only the final payload.

Regression recommendation: use a delayed local HTTP fixture or injected request transport, stop the overlay lifecycle after the first request enters, release the held response, and assert that no additional requests start. Cover both screen-off and disable; verify that screen-on resumes requests and factory mode retains screen-off collection. Pass a lifecycle cancellation/generation predicate through native dashboard requests and check it before each HTTP request; also cancel owned pending requests where supported.

### [P2] Capture the overlay choice and revision together

Primary location: `android-wrapper/app/src/main/java/cn/mu5120/console/BackgroundMonitorService.java:263-267`; callers at lines 243-256 and acceptance at lines 394-406. `refreshOverlay()` captures an enabled value before calling `sendCommand()`. `sendCommand()` takes that old value from the intent but stamps the intent with the latest preference revision. Consequently an old enabled value can acquire the revision belonging to a later disable. `acceptOverlayChoice()` considers the revision current and commits the stale enabled value back to preferences.

Deterministic reproduction:

1. Start with `overlayEnabled=true`, `overlayRevision=1`.
2. On the activity thread, let `refreshOverlay()` read true at line 256, then pause before `sendCommand()` reads preferences.
3. On the WebView bridge thread, execute `setOverlayEnabled(false)`: commit false/revision 2, send the disable broadcast, and stop the optional service.
4. Resume the activity's refresh. `sendCommand()` uses its already captured true value but reads revision 2 from preferences, sending enabled=true/revision 2.
5. Deliver that command. The equality check at lines 400-403 accepts it; lines 404-406 set and persist true, and `onStartCommand()` starts the optional runtime.

These callers really occur on different threads: `MainActivity.java:205-209` refreshes on resume, whereas the `@JavascriptInterface` setter at `RouterBridge.java:139-141` executes through the WebView bridge. The result can restore a service after the user's latest choice disabled it, violating the disabled-overlay requirement.

Regression recommendation: add a latch-controlled test around choice capture and command dispatch using the exact sequence above, and assert that the final stored choice is false, the runtime remains stopped, and no service start occurs. Carry the revision captured with the choice rather than attaching a fresh revision later; synchronize relevant same-process preference updates/reads or dispatch from the current preference pair so a captured value cannot borrow another choice's revision.

## Spec coverage observed

| Requirement | Source/test coverage | Limitation |
| --- | --- | --- |
| Disabled gauge88 overlay does not create a service | `sendCommand()` gates all nine entry points; instrumentation `testDeviceHistoryCommandsNeverStartAServiceWhileOverlayIsDisabled()` also covers old alarm, boot, and package replacement | Does not cover the stale-value/new-revision interleaving above |
| Enabled overlay accepts live values without archiving | Snapshot acceptance plus profile gates for history store and battery writes; instrumentation asserts absent history files and late disabled payload rejection | Test injects snapshots and sets `running` reflectively rather than exercising the actual request chain |
| Screen-off does not continue queries | Pure policy tests reject ticks/polls and late native snapshots while noninteractive; runtime registers screen broadcasts | No request-level cancellation test; finding 1 remains |
| No gauge88 background SMS polling | `shouldPollSms()` gates the native SMS branch; foreground SMS command returns before archiving | Verified by source, not an actual HTTP-count test |
| No gauge88 wake/Wi-Fi locks or watchdog alarms | `shouldWake()` gates lock acquisition and alarm scheduling; disable cancels existing watchdog | Instrumentation's fake context has no alarm service, so it does not verify real alarm cancellation |
| Old phone history ignored and preserved | Profile-gated history readers plus `testOldPhoneHistoriesAreIgnoredAndPreservedInDeviceMode()` | Covered directly by existing instrumentation |
| Factory behavior retained | Policy tests explicitly preserve service, screen-off ticker/polling, archival, SMS, and wake behavior; screen broadcast receiver registration is gauge-only | Full serial JVM/Gradle and device verification remains with the root coordinator |

Existing `testAnOldEnableCommandCannotOverrideANewerDisableChoice()` supplies revision 1 explicitly after setting revision 2, so it validates rejection of an honestly stamped old command, not a stale value stamped with revision 2. Existing late-snapshot assertions validate result rejection after disable, not suppression of HTTP calls after the lifecycle transition.

No additional concrete production findings in the requested native scope.
