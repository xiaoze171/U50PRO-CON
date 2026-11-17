# Final native fix re-review

Scope: final-fix-review.diff only, the final native-report.md appendix, and one focused existing caller inspection required by the changed sample contract. No suite or probe was rerun.

## Original findings

- P2 empty factory flags: Addressed in serialization and estimation. MonitorHistoryStore.batterySample now uses the legacy Boolean rule for a valid factory acquisition, while generic legacy and unknown gauge charging remain null. The new raw-status -> preparation -> batterySample -> factory estimator regression checks 600 minutes from an hour of 55% to 50% history.
- P3 common source metadata: Addressed. Native preparation supplies percentSource, normalized percentEndpoint, charging and externalPower. New tests check factory/gauge values, compaction, and identity retention after live gauge expiry.

## New issue introduced by the fix

### Important — P2: The deduplication caller still compares the old charging interpretation

File: android-wrapper/app/src/main/java/cn/mu5120/console/BackgroundMonitorService.java:544

recordBattery computes charging with MonitorHistoryStore.chargingValue(status), which intentionally remains null for empty factory flags. It then compares that value to previous.charging at line 561. The new batterySample policy now persists false for the same valid raw factory reading. Consequently null never equals false, and the existing within-60-second deduplication check fails on every background poll. The legacy history file, explicitly intended to stay minute-sized at line 554, instead accumulates repeated records at the polling cadence, increasing history parsing, persistence and foreground backfill work.

Use the charging value from the actual serialized sample produced at line 555 for deduplication and logging, so the comparison uses the same interpretation as the archive. Add a raw empty-flag regression that observes two acquisitions within a minute and verifies only one same-source/endpoint sample is archived; retain intentional charge/source/identity transitions.

The new factory regression uses two samples an hour apart and therefore does not cover this caller mismatch. This finding comes from the new false serialization interacting with the unchanged caller, not from a broader review expansion.

## Evidence and boundaries

The final appendix records red failures for empty-flag serialization and missing percentSource, then both profiles passing 11 native JVM suites and 57 shared CSV cases, plus final native compilation with exit 0. These results support the two original fixes; they do not test within-minute deduplication after the serialization change.

Commands used tty:true. The sole checkout write is this report; no source/index/branch change, subagent, device access, probe or suite rerun occurred.

## Assessment

Both original findings are addressed. Scoped fix quality: Needs the deduplication correction above before approval. No other new breakage was found in the five-file fix.
