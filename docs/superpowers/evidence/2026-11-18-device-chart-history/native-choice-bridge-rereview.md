# Native overlay choice and foreground bridge re-review

**Original finding 2: ADDRESSED in the reviewed source.** The stale-refresh/new-revision reproduction can no longer restore an enabled choice. The related foreground bridge issue is also addressed in source. No new concrete production breakage was found in these scoped fixes. Root is running GREEN compilation/device instrumentation; this report does not claim those checks have passed.

## Overlay choice

`BackgroundMonitorService.java:246-255` serializes the UI preference update and command dispatch with `OVERLAY_CHOICE_LOCK`. Dispatch at lines 267-289 reads `preferences.getAll()` once, derives both enabled and revision from that same snapshot, and replaces an overlay intent's earlier captured enabled value with the current snapshot value. The original activity-refresh/bridge-disable interleaving therefore dispatches false/revision 2 and follows the stop branch rather than starting a service.

At lines 410-414, stamped gauge commands reload the authoritative persisted choice into service memory and return without editing preferences. This removes the second race in which the UI could disable immediately after the service's preference read, only for the service to commit an earlier accepted enabled value. Before starting runtime, `onStartCommand()` checks `currentOverlaySelection()` again at lines 343-347. The overlay broadcast receiver uses the same fresh selection gate at line 108. Existing polling and overlay-display gates continue to consult current selection.

The legacy unstamped action path retains its explicit-choice cache update; factory command dispatch retains its existing intent behavior. These paths do not reintroduce the reviewed production reproduction because gauge commands emitted by `sendCommand()` are stamped.

The two added `MonitorOverlayStateTest` regressions exercise meaningful interleavings:

- `testRefreshCapturedBeforeDisableCannotBorrowItsNewRevisionAndStartAService()` (lines 128-149) blocks the refresh after its old boolean has been captured, completes a real UI disable, then resumes dispatch. It asserts zero starts, persisted false/revision 2, and stopped runtime.
- `testServiceAcceptingStampedChoiceCannotOverwriteANewerUiDisable()` (lines 152-176) changes persisted selection immediately after the service snapshot read. It asserts that acceptance cannot overwrite false/revision 2 and that a later stamped command cannot restart runtime.

## Foreground bridge transport

`MainActivity.java:207` marks the bridge foreground before WebView timers resume; line 222 marks it paused before WebView pause/timer shutdown. `RouterBridge.java:284-290` applies this only to gauge88-csv, marks foreground false, increments request generation, and disconnects owned foreground reads.

`RouterBridge.request()` captures request generation at line 181. Lines 191-195 classify GET/HEAD, gauge requests, and the standard `goformId=LOGIN` POST as lifecycle reads. Their predicate requires foreground and the captured generation to remain current. Checks occur before opening transport, before request body output, before/after response headers, and before delivering a successful body (lines 201, 232, 238-240, 254). Consequently both work already queued before pause and newly submitted reads after pause are rejected before starting later HTTP, and paused requests do not become valid merely because the activity resumes.

Explicit management writes retain an always-allowed lifecycle predicate; they are not added to the foreground cancellation set. Factory profile bypasses the new pause gate. The wire-format LOGIN detection matches the existing form request path; it pauses login continuation without changing ordinary management POSTs.

`RouterBridgeLifecycleTest.java:35-75` uses an actual held local TCP HTTP response and an actual bridge executor. It pauses the bridge, submits a second read, then asserts gauge mode observes one HTTP request while factory mode observes two. The gauge assertion directly reproduces the issue rather than only inspecting a flag.

## Evidence and limits

Read `.codex/device88-audit-20261118/native-races-red-instrumentation.txt`: actual phone instrumentation ran 12 tests with 3 failures and 0 errors. The failures are precisely the two new choice regressions (stale refresh caused one start; service acceptance overwrote the newer disable) and the bridge pause regression (two HTTP requests rather than one).

The current fixes target each failing production path directly. GREEN evidence remains with root's concurrent run. The factory bridge test returns early in a gauge build, so the RED gauge run's passing factory test entry does not establish the factory-mode assertion. The current bridge test checks paused reads; management POST preservation and login gating are supported by this source review rather than dedicated assertions in that fixture. It also does not test activity pause wiring end to end or successful resume of newly submitted bridge requests.

No builds, Git/configuration changes, or device actions were performed by this reviewer. The only write is this report. The request-chain finding reviewed earlier remains outside this re-review except for confirming that current selection still feeds its existing request predicate.
