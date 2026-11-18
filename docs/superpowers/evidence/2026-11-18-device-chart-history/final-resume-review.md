# Final broad device-history review — 2026-11-18

**Final verdict: APPROVED; no remaining actionable blocker found.** The CPU chart, native preference-writer, and five earlier resume findings are addressed. Root's final builds, both-profile tests, live charts, and replacement installation of the private 88 Release are complete; execution evidence is recorded in [the final verification](../../../verification-device-chart-history-2026-11-18.md).

Reviewed the current complete uncommitted implementation against `docs/superpowers/specs/2026-11-18-device-chart-history.md`, using HEAD `9b8178c` as the baseline. Scope includes tracked source/tests/README, new device-history/policy sources and tests, the ledger/fix report, and earlier scoped reviews. Unrelated untracked desktop/tools/release artifacts are excluded. This pass made no code, Git/configuration, device, or shared build-output changes.

## Original P2 — CPU preparation re-buckets device records and can erase a missing reading — ADDRESSED

**Location:** `src/utils/chart-options.js:28`–`35`, the unconditional `cpu_temp` alias minute-bucketing branch.

`buildDeviceHistory()` retains exact device record seconds and independently nullable CPU values, but `temperatureSeries()` puts every CPU point into a map keyed by `Math.floor(timestamp / 60000)`. A later device point in the same minute replaces the earlier record. This loses real device samples and can remove a null CPU reading, causing the rendered line to connect across that missing sensor value.

**Direct reproduction:** Feed `buildDeviceHistory()` three otherwise valid increasing device rows with `ts_iso` values `2026-11-18 12:00:30`, `12:01:00`, and `12:01:30`, increasing raw `ts`, and `cpu_temp_c` values `28`, `null`, and `29`. Run the resulting `chart.temperatures` through `temperatureSeries()` and then `lineOption()` with device time and `maxGapMs:120000`. The adapter returns `[28, null, 29]`; preparation returns `[28, 29]`; the renderer contains two adjacent finite points with no null separator, so it connects the curve across the missing record.

**Real-device evidence:** Read only the existing `.codex/device88-audit-20261118/live-history-resume.csv`. The adapter has 9,254 CPU points; CPU preparation has 9,231. There are 23 same-minute collisions. One contains a missing reading at coordinate `1794940893000` (`2026-11-17 18:41:33`) followed by CPU `37.4` at `1794940917000` (`18:41:57`), so the real missing sample is discarded. This confirms that same-minute device records occur in the delivered input format.

**Minimal fix:** Preserve device CPU points in their existing order without minute bucketing. Retain the existing alias bucketing for factory/phone history. A regression should exercise the complete adapter → temperature preparation → line renderer path with valid/null/valid same-minute device records and explicitly retain the factory alias preference behavior.

## Original P2 — Overlay drag can persist a stale cross-process choice — ADDRESSED IN SOURCE

**Location:** `android-wrapper/app/src/main/java/cn/mu5120/console/MonitorOverlay.java:239`. This retained path is outside the changed source files but affects the required device-mode disabled-overlay behavior.

`MonitorOverlay` captures the monitor process's shared preferences once at construction (line 34). The drag release/cancel handler changes position keys and calls `apply()` on that cached object. The UI and monitor service run in separate processes. If the UI commits disable/revision 2 after the service's last selection reload but before a drag release, the position editor can persist the monitor cache's older enabled/revision values together with the changed position keys. The UI's `stopService()` still stops that service instance, but a later resume reads the restored true choice and can start it again.

The current stamped-command fix correctly avoids explicitly persisting its accepted choice, but it does not guard this separate writer. The process-local `OVERLAY_CHOICE_LOCK` cannot synchronize it with the UI process.

**Framework mechanism checked:** Read the Android 15 AOSP implementations of [SharedPreferencesImpl](https://android.googlesource.com/platform/frameworks/base/+/android-15.0.0_r1/core/java/android/app/SharedPreferencesImpl.java) and [ContextImpl](https://android.googlesource.com/platform/frameworks/base/+/android-15.0.0_r1/core/java/android/app/ContextImpl.java). `commitToMemory()` chooses the entire cached `mMap` (lines 530–541), advances a process-local memory generation when the changed position keys are applied (591–599), and `writeToFile()` serializes that entire map (811). Generation checks do not compare another process's preference revision. `MODE_MULTI_PROCESS` reloads only when explicitly requested, and `hasFileChangedUnexpectedly()` returns false while this process has a disk write in flight (237–243), so a selection reload after `apply()` begins does not repair the pending stale snapshot.

**Minimal device-mode fix:** Skip saved overlay position writes in gauge mode. Those coordinates are not read by the current UI: `ensureView()` always resets to the default position. Keep factory persistence unchanged. The service's redundant gauge configuration preference write can also be bypassed because static `configure()` already commits the configuration; that removes the remaining monitor-process writer to this shared preference file.

**Important triage correction:** Normal `ACTION_CONFIGURE` after the static method has committed the identical configuration is not by itself a reproduced overwrite: the current selection reload refreshes the map, and Android skips disk serialization when none of the edited keys changed. The drag path differs because changed position keys create a real write.

**Focused regression route:** Use independent real `SharedPreferencesImpl` instances for one temporary preference file (or a monitor-process instrumentation helper). Cache true/revision 1 in the monitor instance, commit false/revision 2 in the UI instance, invoke the production drag release with changed coordinates, drain pending preference writes, reload, and assert that false/revision 2 remains and a subsequent refresh does not start the service. This reviewer verified framework/source behavior; root subsequently executed the real framework RED reproduction and final GREEN in both profiles, as recorded below.

## Spec coverage otherwise observed

| Requirement | Review result |
| --- | --- |
| Device CSV for speed, temperature, LTE/NR, battery curves and list | Wired independently of factory login; exact device archive replaces phone chart history. |
| Nullable telemetry, zero values, old columns | Separate permissive history representation and strict estimator representation preserve independent values and legacy estimator behavior. |
| Device wall clock, exact 2/24-hour endpoint, raw identity | Timezone-neutral calendar coordinate, UTC component display, original text/raw seconds retained; device windows end at the exact last second. |
| Invalid/reversed/gap/network boundaries | Adapter preserves boundaries and separates LTE/NR; the CPU re-bucketing exception is now addressed below. |
| Requests, cache, endpoint/failure handling | In-flight reads coalesce; manual force bypasses fresh cached failures; configuration generations reject late old-device results; same-device failures retain the archive and show the last-record time. |
| Startup, return, manual and minute refresh | Page uses the history path on initialization/return/manual refresh and a visible-page minute timer. Native pause also invalidates queued foreground reads. |
| Old phone chart/battery files | 88 mode bypasses reads, backfill, capture, and writes; old files remain preserved. Foreground diagnostic samples are separate in-memory data. |
| Optional native overlay | Off selection gates service start; screen-off cancels owned reads and request continuations; no gauge archive/SMS/watchdog/locks/boot restoration. Drag/config preference-writer fixes passed final Android GREEN in both profiles. Factory paths retain collection policy. |
| Factory dashboard and management | Existing realtime path remains; bridge lifecycle cancellation preserves explicit management writes and factory transport bypass. |
| UI/docs and runtime estimate | Device provenance/failure/latest-time text is present; device CSV runtime estimation retains its prior zero-percent target. |

The new delayed-HTTP JVM and phone bridge/choice fixtures target actual request and preference interleavings, rather than only policy flags. Root's final GREEN execution and documentation evidence are complete. Minor source formatting inconsistencies do not materially affect behavior and are not blockers.

## Verification in this review

Only two direct Node reproductions and two read-only analyses of the saved device CSV were executed; no full build or suite was duplicated. All Windows commands used `exec_command` with `tty:true`. The original CPU failure and real archive counts above were observed directly.

## Scoped CPU re-review — ADDRESSED

Reviewed the focused change at `src/utils/chart-options.js:29`–`37`, the two new regressions at `tests/device-history.test.mjs:57` and `:76`, and `fix-6-cpu-red.log`, `fix-6-cpu-green.log`, and the recorded downloaded-fixture GREEN result.

Device canonical CPU points now bypass alias minute bucketing whenever the normalized CPU series contains device provenance. Null values and exact record seconds survive intact. The prior factory canonical-over-alias branch remains unchanged for phone/factory points. The architecture supplies separate device and factory archives, so this provenance branch does not mix their representations.

The device regression exercises the complete parser/adapter → temperature preparation → line renderer sequence and asserts all three timestamp/value pairs plus `connectNulls:false`. The companion factory regression checks that a canonical CPU point replaces its alias in the same minute while retaining the alias in the following minute.

This reviewer ran only:

```text
node --test --test-name-pattern='CPU|cpu|alias' tests/device-history.test.mjs
```

**2 passed, 0 failed**, exit 0. The recorded RED shows the missing middle null pair at the intended assertion. Fix-agent focused GREEN reports **64/64**, and its saved real archive check retains all **9,254/9,254** CPU records with **8,000** null readings; the prepared CPU array deeply equals the adapter array. No new concrete regression was found within this fix. No full build or suite was duplicated by this reviewer.

## Scoped native preference-writer re-review — ADDRESSED IN SOURCE

Reviewed only the stable drag/config changes, their new regressions, the corrected real Android RED artifact, and new breakage attributable to these fixes. No shared compilation, full suite, device action, or application preference edit was performed by this reviewer.

- `MonitorOverlay.java:239`–`244` excludes only gauge mode from the position editor on both `ACTION_UP` and `ACTION_CANCEL`. Touch handling, current in-session movement, event consumption, default opening position, and the factory persistence branch remain unchanged. These are unused saved coordinates in the current opening path, so removing the gauge disk write does not remove a visible user capability.
- `BackgroundMonitorService.java:371`–`381` excludes only gauge mode from its redundant configuration preference editor. The same action still updates runtime router/password/battery fields, advances the configuration generation before/after mutation, clears the session when requested, and invalidates the CSV cache. The public static `configure()` and `RouterBridge.configureBackground()` continue committing the UI-owned persistent configuration before dispatch. Factory configuration persistence is unchanged.
- The current gauge command-acceptance branch already avoids persisting stamped overlay choices. Removing drag and redundant config writes therefore closes the identified monitor-cache writers without changing authoritative UI preference updates.

**Corrected actual RED:** `.codex/device88-audit-20261118/native-drag-red-corrected-instrumentation.txt` reports **2 tests, 2 failures, 0 errors**. Both failures are the intended disk-enabled assertions in `testDeviceDragReleaseCannotPersistCachedEnableOverANewerDisable` and `testStaleServiceConfigurationCannotPersistCachedEnableAfterItsStartGate`. The earlier fixture error involving an internal pending-write helper is not RED evidence and is excluded.

The corrected fixtures use two independent real Android `SharedPreferencesImpl` objects pointing at one temporary XML file, a third independent object to reload disk, and a public synchronous no-op `edit().commit()` on the same cached instance as a FIFO disk-write barrier. They do not manufacture the overwrite in a mock map. The drag fixture invokes the actual private production listener and covers UP/CANCEL. The config fixture uses a real delayed intent getter to commit a newer UI disable after the start gate, then applies genuinely different stale configuration values; it additionally asserts that the latest persisted UI address remains. The factory fixture invokes the actual listener and checks persisted x/y.

This preserves the triage distinction: ordinary identical current-config edits are not a finding; the corrected stale-config fixture has changed keys and therefore triggered real serialization in RED. No new concrete production regression was found in the fixes. **Source and execution closure are approved.** Read root's final `.codex/device88-audit-20261118/instrumentation-gauge-final.txt` and `instrumentation-factory-final.txt`: both report **OK (21 tests)**, taking 0.518 and 0.529 seconds respectively. The gauge persistence cases and factory position/transport assertions execute in their corresponding profiles. The same final code passed 360 JavaScript tests and 14 JVM suites in each profile. Root installed the verified private Release using `adb install -r`; the actual installed APK matches its hash, size, version, non-debuggable flag, and existing signer. No build, suite, or device action was duplicated by this reviewer.
