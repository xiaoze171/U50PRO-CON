# Serialized-charging caller correction review

Scope: new deduplication correction and NativeBatteryHistoryTest additions in caller-fix-review.diff. The five previously approved metadata insertions appear as context and were not reconsidered. Read the native-report.md caller-correction appendix; no probes or suites were rerun.

## Finding status

P2 deduplication regression: Addressed.

BackgroundMonitorService.java:555 now obtains charging from the actual batterySample output, normalizing an absent value to JSONObject.NULL. Its comparison and logging therefore use the same nullable Boolean representation that is persisted. The existing 60-second, collection-source, percentage-source, endpoint and measurement-identity conditions are retained.

The regression invokes the real private recordBattery path, serialization, pruning and history-file writes. Only the Android files-directory Context boundary is supplied; factory empty flags and unknown gauge readings at 0, 1, 30 and 60 seconds verify one point within the minute and the next point at 60 seconds, with false and null preserved respectively. Temporary history files are cleaned up.

## Evidence

The report records the intended pre-fix failure for repeated empty-flag factory acquisitions, both-profile targeted history passes, and both-profile full native runs of 11 suites and 57 shared CSV cases with compilation of all native sources. The test now covers the caller that the prior two-point, hour-long slope regression did not reach.

## Issues

None in the new caller correction or regression test.

## Assessment

Approved for the scoped correction. The deduplication finding is resolved, and no new breakage was found. The two original final-review findings remain addressed. Controller-owned final Android assemblies, APK verification and branch-tip/profile-only verification remain the final integration gates.

The sole checkout write is this report. Commands used tty:true; no source/index/branch changes, subagents, device access, suite reruns or additional probes occurred.
