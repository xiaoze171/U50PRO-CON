# Spec compliance

❌ Issues found: `src/services/router-client.js:802` loses a fresh native CSV calculation when an older foreground CSV result is retained, violating the required restoration behavior.

⚠️ Native parity/body limits, all parser/model thresholds and final branch/UI identity are outside the Task 2 diff and remain separate controller gates.

# Strengths

- `src/services/router-client.js:117` and `src/services/router-client.js:1141` enforce the tracked source and port at load/update. `tests/battery-profile-integration.test.mjs:40` exercises stored-setting migration and an immediate estimate from device history without bulk-importing CSV into app history.
- `src/services/battery-csv-client.js:21`, `src/services/battery-csv-client.js:31` and `src/services/battery-csv-client.js:38` separate cache ownership, coalesce requests, cache success/error results for 60 seconds, bound input and prevent invalidated work repopulating the cache.
- `src/utils/battery-factory.js:10`, `src/utils/battery-factory.js:27` and `src/utils/battery-factory.js:39` preserve external-power charging semantics and the factory-only 24-hour endpoint slope with the 0.15-hour minimum.
- `src/utils/battery-gauge.js:40` requires relative age instead of comparing device and phone clocks. `tests/battery-config-race.test.mjs:64` covers endpoint roundtrips; `tests/battery-config-race.test.mjs:75` covers changes during login.
- `desktop/router-http.js:65` and `dev/battery-proxy.js:14` extend isolated battery transport to CSV; the added cookie/size tests assert observable transport behavior.

# Issues

## Critical

None.

## Important

- `src/services/router-client.js:802`: Fresh native CSV summaries are accepted only when `latestBatteryCsv` is null. A retained foreground CSV failure, or a cache that becomes stale during background ownership, suppresses a newer native summary despite its fresh live marker and exactly matching sanitized measurement. The caller selects the newer native snapshot at `src/pages/index/index.vue:2172` and overwrites the displayed battery with this degraded restoration at `src/pages/index/index.vue:2175`. A focused production-module probe retained an `invalid-csv` foreground result and then restored a two-second-newer native summary generated from valid CSV and its matching marker: native runtime was 600 minutes, while restoration returned `null` with `invalid-csv`. Select between local and collected calculations by usability/freshness, retaining valid newer native provenance; preserve the existing complete measurement, endpoint and live-marker checks. Add a regression near `tests/battery-profile-integration.test.mjs:96` that populates a failed or expired foreground cache before native handoff.

## Minor

None.

# Assessment

Task quality: Needs fixes.

Reasoning: Profile enforcement, independent caching, cookie isolation and publication guards are well covered. The handoff condition loses a valid collector result whenever the foreground already has a CSV cache entry.

# Checks

- Read the staged diff, implementer report, approved spec and plan Task 2. The first combined output was truncated, so the diff was read in bounded sections. No git commands were run.
- Named contract risks checked: measurement equality via `src/utils/battery-gauge.js:94` and `src/utils/battery-gauge.js:123`; device-log freshness via `src/utils/battery-csv.js:146`; retained-cache/native-result precedence via the restoration caller at `src/pages/index/index.vue:2172`. These inspect Task 2 interfaces rather than the separate model/UI tasks.
- Diff context cut off functions: inspected the remainder of gauge acquisition at `src/services/router-client.js:404`, collection reset at `src/services/router-client.js:694`, and dashboard publication at `src/services/router-client.js:580`. A focused API search found no separate reload mutation path.
- Ran one focused in-memory Node reproduction of retained failure during native handoff. Exit 0; output: `{"nativeMinutes":600,"nativeReason":"","restoredMinutes":null,"restoredReason":"invalid-csv"}`. No source/test file was changed and no device was contacted.
- No suite rerun. Controller supplied 277/277 passing gauge-suite tests and 67/67 passing targeted tests; the inspected implementer report also records an earlier 53-test focused pass and red-to-green evidence.
- Commands used `tty: true`; the only checkout write is this requested report.
