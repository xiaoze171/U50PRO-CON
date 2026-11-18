# Resume review fixes — 2026-11-18

Scope: five confirmed findings in `js-resume-review.md` and `native-resume-review.md`, plus final whole-change findings for CPU minute bucketing and native cached-preference persistence, against `docs/superpowers/specs/2026-11-18-device-chart-history.md`. Existing uncommitted implementation was preserved. No Git/index/config/device/README changes were made by this fix agent. Root owns final Gradle builds, installations, and instrumentation.

## 1. Independent telemetry survives missing battery values

Root cause: the chart history consumed estimator-strict CSV rows. Missing/malformed battery fields rejected the entire row, including independent valid speed/temperature/signal telemetry. Battery chart preparation also filtered null SOC samples and could reconnect their neighbors.

Resolution: `parseBatteryCsv(text, { history: true })` retains independently nullable battery values while still requiring a valid raw timestamp and structurally valid CSV. The default parser remains estimator-strict. The shared download caches both representations; router chart history consumes `historyCsv`. Device battery series retains null SOC samples, and the history list displays `—` for a missing reading.

RED: `node --test tests/device-history.test.mjs tests/device-history-integration.test.mjs` failed on dropped independent rows and missing null SOC gaps; see `fix-1-red.log`.

GREEN: `node --test tests/device-history.test.mjs tests/device-history-integration.test.mjs tests/battery-csv.test.mjs tests/battery-csv-client.test.mjs tests/chart-options.test.mjs` passed 118/118; see `fix-1-green.log`.

List RED/GREEN: `node --test tests/device-history-time.test.mjs` first showed `<b>%</b>` instead of a missing value; after the list change it passed 3/3. See `fix-1-list-red.log` and `fix-1-list-green.log`.

## 2. Device wall-clock ordering and display are timezone neutral

Root cause: validated timezone-free device calendar text was converted to a viewer-local Date. Viewer DST normalization could change its hour and manufacture a clock reversal.

Resolution: device calendar UTC fields provide a numerical wall-clock coordinate; they do not interpret the device timestamp as an actual UTC instant. Original text is retained in `wallClock` and `latestWallClock`, and raw `ts` remains device identity. Device chart axes use UTC components and ECharts `useUTC`; tooltips, battery list, and diagnostic history hint format these coordinates as the device wall-clock text. Factory formatting/axes remain as before.

RED: `node --test tests/device-history-time.test.mjs` failed with `America/New_York: 1 !== 2` at the 2026 spring DST gap; see `fix-2-red.log`.

GREEN: `node --test tests/device-history-time.test.mjs tests/device-history.test.mjs tests/device-history-integration.test.mjs tests/chart-options.test.mjs tests/chart-tooltip.test.mjs tests/chart-performance.test.mjs` passed 56/56; see `fix-2-green.log`. The time regression checks New York, Berlin, Shanghai, UTC, the actual battery-list template render, both axis label shapes, tooltips, diagnostic hint, and factory compatibility. A test-only Vue render-prefix adjustment removed proxy warnings in the later 3/3 run.

## 3. Device windows use the exact recorded second

Root cause: the shared chart option and throughput cutoff unconditionally rounded up to a minute.

Resolution: device history uses the exact `behavior.now` coordinate for both chart endpoints and throughput cutoff. Factory minute rounding remains unchanged.

RED: `node --test tests/device-history-integration.test.mjs` failed with `1795009860000 !== 1795009836000`; see `fix-3-red.log`.

GREEN: `node --test tests/device-history-integration.test.mjs tests/device-history-time.test.mjs tests/chart-options.test.mjs` passed 23/23; see `fix-3-green.log`. Literal 2-hour and 24-hour window bounds include a nonzero last-record second, with explicit factory-rounding assertions.

## 4. Native dashboard stops its request chain on lifecycle cancellation

Root cause: scheduler cancellation suppressed future ticks but the current `dashboard()` could still initiate login, grouped fields, station lists, and gauge requests before rejecting its final snapshot.

Resolution implemented so far: the service passes its running/config-generation/snapshot policy into a project-owned, API23-compatible `RequestAllowed` interface. The dashboard, login chain, factory HTTP transport, queued CSV loader, and gauge state transport check that policy before initiating HTTP. Owned connections are tracked; screen-off, optional stop, and destroy cancel them and invalidate the CSV request/cache. Existing no-argument entry points preserve factory behavior. The cached CSV loader accepts a per-request loader so queued work captures its own lifecycle policy.

RED: `.superpowers/sdd/2026-11-18-device-chart-history/run-fix-jvm.ps1 -Phase fix-4-red` failed on a real held localhost HTTP response with `screen-off must suppress all later HTTP, observed 9`; see `fix-4-red-gauge88-csv.log`.

GREEN: the same isolated runner with `-Phase fix-4-green -Tests NativeMonitorRequestLifecycleTest,NativeRouterAuthTest,NativeBatteryCsvCacheTest` passed all three suites under `-Profile gauge88-csv` and `-Profile factory`; see `fix-4-green-gauge88-csv.log` and `fix-4-green-factory.log`. The new suite executes screen-off, disable, generation invalidation, cancellation before login, factory screen-off continuation, and screen-on/new-generation resumption against a real HTTP server. JVM allocation bypasses only the Android context/assets constructor, matching the existing native auth-test approach.

Related foreground transport RED: root's actual phone run in `.codex/device88-audit-20261118/native-races-red-instrumentation.txt` reproduced `expected:<1> but was:<2>` in `RouterBridgeLifecycleTest#testPausedDeviceHistoryBridgeCannotStartSubsequentRequests`. The bridge now captures a foreground request generation, gates read/login HTTP before connection I/O and response acceptance, and tracks/cancels owned reads on `MainActivity.onPause`. Resume enables a new generation. Explicit management writes and factory transport retain their existing behavior; cancellation errors still resolve the pending native response callbacks. Isolated compilation plus `NativeLocalBridgeTest`/`NativeMonitorRequestLifecycleTest` passed (`fix-4-bridge-compile-gauge88-csv.log`). Root's full actual on-device GREEN subsequently passed 18/18 tests; see below.

## 5. Stale overlay refresh cannot borrow a later revision

Root cause: refresh captured `enabled` before dispatch; dispatch attached a fresh revision to that old value. Service acceptance could also persist a stale accepted value after a newer UI disable.

Failing regressions: `MonitorOverlayStateTest#testRefreshCapturedBeforeDisableCannotBorrowItsNewRevisionAndStartAService` controls the exact refresh/disable/dispatch interleaving using latches; `#testServiceAcceptingStampedChoiceCannotOverwriteANewerUiDisable` changes the real preference pair after its snapshot/revision read, before the service can write.

Actual RED: after root installed its same-signer debug/test APK, `.codex/device88-audit-20261118/native-races-red-instrumentation.txt` reported `Tests run: 12, Failures: 3, Errors: 0`: both selection tests and the foreground bridge test failed for their intended assertions. Stale refresh started one service instead of zero, and service acceptance overwrote the newer persisted disable.

Resolution: dispatch uses a single current `SharedPreferences.getAll()` enabled/revision snapshot, serialized with same-process UI setters. Stale intent booleans cannot borrow a later revision because both outgoing values come from the same current snapshot. Stamped commands update only the service cache; the service never persists them over a newer UI choice. Fresh persisted-choice checks gate service start and receiver continuation. Legacy unstamped explicit-choice and factory paths retain their prior cache behavior.

Isolated compilation plus request/local-bridge/policy suites passed (`fix-5-compile-gauge88-csv.log`). Root's full actual on-device GREEN subsequently passed 18/18 tests:

```text
adb -s 10ACAS1SDH000Q3 shell am instrument -w -r cn.mu5120.console.test/android.test.InstrumentationTestRunner
```

Log `.codex/device88-audit-20261118/instrumentation-gauge-final.txt`: `OK (18 tests)`, `Time: 0.465`. This closes the three previously failing refresh/acceptance/foreground-bridge cases. The new final-wave cached-preference persistence regression remains separate below.

## Files changed by this fix agent

- `src/utils/battery-csv.js`
- `src/services/battery-csv-client.js`
- `src/services/router-client.js`
- `src/utils/device-history.js`
- `src/utils/chart-options.js`
- `src/utils/collection-source.js`
- `src/utils/format.js`
- `src/pages/index/index.vue`
- `src/components/BatteryHistory.vue`
- `tests/device-history.test.mjs`
- `tests/device-history-integration.test.mjs`
- `tests/device-history-time.test.mjs` (new)
- `android-wrapper/app/src/main/java/cn/mu5120/console/MonitorRouterClient.java`
- `android-wrapper/app/src/main/java/cn/mu5120/console/BatteryCsvCache.java`
- `android-wrapper/app/src/main/java/cn/mu5120/console/BackgroundMonitorService.java`
- `android-wrapper/app/src/main/java/cn/mu5120/console/RouterBridge.java`
- `android-wrapper/app/src/main/java/cn/mu5120/console/MainActivity.java`
- `android-wrapper/app/src/main/java/cn/mu5120/console/MonitorOverlay.java`
- `tests/run-native-battery-tests.ps1` (default runner now includes policy and delayed-HTTP lifecycle suites; 14 total)
- `tests/java/NativeMonitorRequestLifecycleTest.java` (new)
- `android-wrapper/app/src/androidTest/java/cn/mu5120/console/MonitorOverlayStateTest.java`
- `android-wrapper/app/src/androidTest/java/cn/mu5120/console/RouterBridgeLifecycleTest.java` (new)
- This report, `run-fix-jvm.ps1`, and the named red/green logs in this directory. JVM class output is isolated in this directory and is not a source deliverable.

## Final-review CPU null-gap preservation

Root cause: `temperatureSeries()` treated device CPU readings like factory sensor aliases and reduced them to one point per minute. Device records at `12:00:30 = 28`, `12:01:00 = null`, and `12:01:30 = 29` became two non-null points; the null gap disappeared and the line reconnected. The downloaded live fixture lost 23 CPU records for the same reason.

Resolution: canonical device CPU points bypass alias minute bucketing. Every device record and null value survives into chart series. Factory CPU alias merging still selects canonical values within each minute.

RED: `node --test tests/device-history.test.mjs` failed when the adapter → temperature-series → line-option regression expected all three timestamp/value pairs but the middle null pair was absent; `fix-6-cpu-red.log` records the intended failure. The companion factory canonical-over-alias regression passed before and after the fix.

GREEN: `node --test tests/device-history.test.mjs tests/device-history-integration.test.mjs tests/device-history-time.test.mjs tests/chart-options.test.mjs tests/chart-tooltip.test.mjs tests/chart-performance.test.mjs tests/temperature.test.mjs` passed 64/64; see `fix-6-cpu-green.log`.

Read-only downloaded-fixture verification executed:

```powershell
node --input-type=module -e 'import {readFileSync} from "node:fs"; import assert from "node:assert/strict"; import {parseBatteryCsv} from "./src/utils/battery-csv.js"; import {buildDeviceHistory} from "./src/utils/device-history.js"; import {temperatureSeries} from "./src/utils/chart-options.js"; const history=buildDeviceHistory(parseBatteryCsv(readFileSync(".codex/device88-audit-20261118/live-history-resume.csv","utf8"),{history:true})); const cpu=temperatureSeries(history.chart.temperatures).find(item=>item.id==="cpu_temp"); assert.equal(history.snapshotCount,9254); assert.equal(cpu.data.length,9254); assert.deepEqual(cpu.data,history.chart.temperatures.cpu_temp); console.log(JSON.stringify({snapshots:history.snapshotCount,adapterCpu:history.chart.temperatures.cpu_temp.length,renderPreparedCpu:cpu.data.length,nullReadings:cpu.data.filter(point=>point[1]===null).length}));'
```

Exit 0, output `{"snapshots":9254,"adapterCpu":9254,"renderPreparedCpu":9254,"nullReadings":8000}`. Log: `fix-6-cpu-live-green.log`. The complete prepared CPU array deeply equals the adapter CPU array, including all null readings.

## Final isolated JVM regression

For each profile, the fix agent ran:

```powershell
.superpowers/sdd/2026-11-18-device-chart-history/run-fix-jvm.ps1 -Phase final-jvm -Profile gauge88-csv -Tests @('NativeBatteryProfileTest','NativeBatteryCsvTest','NativeBatteryCsvCacheTest','NativeBatteryFactoryTest','NativeBatteryGaugeTest','NativeBatteryCurrentWindowTest','NativeMonitorGaugeHistoryTest','NativeBatteryHistoryTest','MonitorSourceTest','MonitorTemperatureTest','NativeRouterAuthTest','NativeLocalBridgeTest','MonitorRuntimePolicyTest','NativeMonitorRequestLifecycleTest')
.superpowers/sdd/2026-11-18-device-chart-history/run-fix-jvm.ps1 -Phase final-jvm -Profile factory -Tests @('NativeBatteryProfileTest','NativeBatteryCsvTest','NativeBatteryCsvCacheTest','NativeBatteryFactoryTest','NativeBatteryGaugeTest','NativeBatteryCurrentWindowTest','NativeMonitorGaugeHistoryTest','NativeBatteryHistoryTest','MonitorSourceTest','MonitorTemperatureTest','NativeRouterAuthTest','NativeLocalBridgeTest','MonitorRuntimePolicyTest','NativeMonitorRequestLifecycleTest')
```

Both exited 0, with all 14 suites passing. Logs: `final-jvm-gauge88-csv.log`, `final-jvm-factory.log`. This includes the strict 57 shared CSV cases, 600-minute device CSV model, factory/gauge estimator regressions, cache/auth/history contracts, policy gates, actual delayed HTTP cancellation/resumption, and local bridge worker/proxy lifecycle.

## Final-wave native cached-preference persistence

Source-verified root cause: the monitor process retains its own `MODE_PRIVATE` preference map. Android editor writes serialize that complete cached map. An actual drag release (`ACTION_UP` or `ACTION_CANCEL`) changes saved x/y and can serialize the cached `overlayEnabled=true, overlayRevision=1` after the UI independently committed `false, 2`. A genuinely changed stale configuration intent can likewise cause the redundant service configuration editor to write its old complete preference map. An identical editor apply with no changed value is not the configuration reproduction.

Prepared regressions in `MonitorOverlayStateTest`:

- `testDeviceDragReleaseCannotPersistCachedEnableOverANewerDisable`: two independent real `android.app.SharedPreferencesImpl(File, int)` objects for a temp XML file; service cache remains true/revision 1; UI commits false/revision 2; actual private `MonitorOverlay.DragListener` release receives changed x/y; a public no-op synchronous commit on the same cached instance waits for pending FIFO disk writes without modifying any key; a third real preference instance reloads disk and asserts false/revision 2. Both UP/CANCEL are covered.
- `testStaleServiceConfigurationCannotPersistCachedEnableAfterItsStartGate`: independent real cache and a real delayed configuration-intent getter commit the disable after the service start gate and before its changed stale configuration is applied; reloaded disk must retain the disable and latest UI router address.
- `testFactoryDragReleaseStillPersistsItsPosition` protects the existing factory position write.

Actual RED: root's corrected phone run in `.codex/device88-audit-20261118/native-drag-red-corrected-instrumentation.txt` reported `Tests run: 2, Failures: 2, Errors: 0`, `Time: 0.063`. Both assertions failed because drag/config persistence restored the service's cached enabled map on disk. The earlier run with the blocked internal drain helper was a fixture error and is not counted as RED evidence; the public commit barrier replaced that helper without changing production.

Resolution: in `gauge88-csv` mode, drag UP/CANCEL no longer persist x/y. The overlay already resets position on every opening, and current in-session dragging remains unchanged. Gauge `ACTION_CONFIGURE` updates its existing runtime fields/generation but skips the redundant service preference editor: static UI `configure()` already commits those settings. Factory branches retain their previous drag-position and service-configuration writes. No old preference keys/files are deleted.

Isolated compile/policy/request checks executed with current sources:

```powershell
.superpowers/sdd/2026-11-18-device-chart-history/run-fix-jvm.ps1 -Phase fix-7-preferences-compile -Profile gauge88-csv -Tests NativeBatteryProfileTest,MonitorRuntimePolicyTest,NativeMonitorRequestLifecycleTest
.superpowers/sdd/2026-11-18-device-chart-history/run-fix-jvm.ps1 -Phase fix-7-preferences-compile -Profile factory -Tests NativeBatteryProfileTest,MonitorRuntimePolicyTest,NativeMonitorRequestLifecycleTest
```

Both exited 0 with all three named suites passing. Logs `fix-7-preferences-compile-gauge88-csv.log` and `fix-7-preferences-compile-factory.log`. These verify native compilation and existing profile/request policies, not Android preference persistence. Actual on-device GREEN for the new persistence cases remains pending root's full 21-test gauge and factory runs. All persistence fixtures are temp XML files, with no app preference or device-setting changes.

`git diff --check` also exited 0 after the fixes; Git emitted only the workspace's existing LF/CRLF conversion notices.

All fix-agent Windows commands used `exec_command` with `tty: true`. No shared JVM/Gradle output directories were compiled by this agent. Existing javac deprecated-API notices are present in JVM logs; test failures are the explicit ASCII assertion messages above.
