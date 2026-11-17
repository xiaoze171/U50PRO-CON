# Final integration review

Reviewed staged source/test/spec changes from c93a79c using final-review.diff, the approved spec and plan, progress ledger, and CSV/JavaScript/native/UI reports and scoped review results. The staged common profile is factory; the working gauge profile used for final generated artifacts is an intentional controller change. Generated legacy www deletion content was omitted from the review package; its deletion inventory and generated-only Gradle source sets were reviewed.

## Strengths

- Both runtimes consume the tracked profile, enforce source and port 88, isolate gauge cookies, invalidate configuration generations, and keep device CSV separate from app history.
- CSV continuity, device-clock freshness, live joins, guards, thresholds, and factory 24-hour/0.15-hour slope behavior are implemented consistently at the model level. Shared fixtures cover the exact minimum thresholds.
- Fresh native CSV recovery no longer loses a valid collector estimate behind retained failed/stale/insufficient foreground cache entries. Complete sanitized measurements and freshness remain required.
- Shared UI stays in the existing page/helper tree. Gradle generates the selected profile's H5 assets rather than packaging tracked legacy files.

## Issues

### Important — P2: Empty factory charging flags break native history estimation

File: android-wrapper/app/src/main/java/cn/mu5120/console/MonitorHistoryStore.java:226

chargingValue returns false only for an explicit battery_charging 0/false. Empty factory charging and external-power flags therefore serialize as null at batterySample line 308, even though native preparation sets the measurement mode to discharging and the approved foreground factory behavior treats those flags as false. BatteryFactory.estimate at line 33 requires Boolean charging values, so these native history records continually break the factory slope and also break the restored foreground segment.

A focused in-memory probe against the existing compiled production classes created an hour of status-derived samples falling from 55% to 50%: empty flags produced runtime.state=collecting and minutes=null; changing only battery_charging to 0 produced runtime.state=estimated and minutes=600. No source/test file was changed by the probe.

Fix the factory path to return the legacy Boolean interpretation for all flags, while retaining unknown/null gauge charging. Add a native raw-status -> batterySample -> BatteryFactory.estimate regression for empty flags, alongside explicit-off and external-power behavior.

### Minor — P3: Native compact summaries omit the common source fields

File: android-wrapper/app/src/main/java/cn/mu5120/console/BackgroundMonitorService.java:498

Native preparation publishes percent, measurement and mode but never sets the foreground summary's percentSource and percentEndpoint fields. The CSV estimator also does not populate them. A production-class preparation probe confirmed both top-level fields are absent while measurement.percentageSource is gauge88.

This is a common-summary contract gap: index.vue lines 1182 and 1224 select the CSV estimate label and diagnostic rows using top-level percentSource, and LAN normalization preserves the missing fields. Current foreground backfill repairs the fields through restoreBatterySummary, so that path does not establish an existing visible failure; the native summary itself still differs from the shared public shape. Populate source and normalized endpoint during preparation and verify their preservation through compaction/relay, including an unavailable gauge marker.

### Critical

None.

## Focused verification

- The controller reports actual factory and gauge full JavaScript runs each at 286/286, each profile's 11 native JVM suites with 57 shared CSV cases, both Gradle assembleDebug/H5 builds, byte-identical six-file APK www inventories, and matching BuildConfig/compiled-JavaScript profile constants. Desktop self-tests and sync transport checks passed. No suite was rerun by this reviewer.
- The suspected API 23 Double.isFinite issue is rejected. Local SDK API metadata marks the method since API 24, but dexdump of the current BatteryCsv.dex and BatteryFactory.dex proves D8 rewrites the calls into synthesized methods using supported Double.isInfinite and Double.isNaN; no direct isFinite invocation remains in those archives.
- Reviewed integration joins around configuration invalidation, native preparation/compaction, local/native estimate selection, background factory history production, and viewer normalization. Only the concrete gaps above required production-class probes.
- Commands used tty:true; in-memory Java probe subprocesses used windowsHide:true. This report is the sole checkout write. No index/branch/source mutation, subagents, device access, push, or installation occurred.

## Assessment

Ready to merge: With fixes.

The implementation is otherwise coherent and the supplied validation is strong. Correct the native empty-flag history semantics and align native summary source metadata; then review that focused fix and complete the controller's pending branch-tip/profile-only difference verification.
