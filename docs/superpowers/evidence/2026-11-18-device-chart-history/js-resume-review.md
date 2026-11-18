# JavaScript resume review — 2026-11-18

Read-only review of the existing uncommitted implementation on `codex/battery-88-csv`, against `docs/superpowers/specs/2026-11-18-device-chart-history.md` and its saved implementation plan. Reviewed CSV parsing/client, device-history adapter, router API, page integration, chart preparation, and changed/new JavaScript tests. No implementation, Git/config, build output, or device changes were made; this report is the only written artifact.

## Findings

### P2 — Missing battery fields discard otherwise valid chart telemetry

**Location:** `src/services/router-client.js:381`, where the new history path consumes the estimator-oriented `result.csv`; rejection occurs in the pre-existing `src/utils/battery-csv.js:38`–`43`.

The CSV parser returns `null` for an entire row whenever `soc`, `voltage_mv`, `current_ma`, `power_w`, or `temp_c` is missing/malformed, or `status` is empty. The new device-history path uses only these parsed rows, so independently valid network speed, CPU/Modem/PA temperature, and LTE/NR fields disappear too. A missing battery sensor reading therefore looks like a gap in every chart and also removes the sample from `snapshotCount` and the latest-history timestamp. This violates the specification's missing-value semantics for the 25-column device history.

**Confirmed reproduction:** Construct a named-header CSV row with a valid `ts_iso=2026-11-18 13:50:36`, `ts=1795009836`, `download_bps=1024`, `upload_bps=128`, `net_interval_s=60`, `cpu_temp_c=28`, `network_type=SA`, and `nr_rsrp_dbm=-98`. Keep the other required battery values valid, then blank one field at a time: `soc`, `temp_c`, `current_ma`, or `status`. For each case, `parseBatteryCsv(...).rows[0] === null`, and `buildDeviceHistory(...)` returns `snapshotCount=0`, `chart.down=[]`, and `chart.temperatures.cpu_temp=[]`. Valid telemetry is lost instead of preserving the row and marking only the unavailable field as missing.

**Fix direction:** Preserve the existing battery-estimator parser contract and its strict fixtures. Give chart history a separate row representation or parsing mode that retains timestamp-valid rows and independently nullable fields. If battery percentage becomes nullable, preserve its gap through `batterySeries` rather than filtering that sample away and potentially reconnecting nearby valid values.

**Coverage:** `tests/device-history.test.mjs:28` checks the opposite direction—malformed added telemetry must not destroy valid battery data. It does not cover missing battery fields with independently valid chart telemetry. Existing estimator tests intentionally require strict battery rejection and should remain intact.

### P2 — Viewer DST rules rewrite device wall-clock text and fabricate reversals

**Location:** `src/utils/device-history.js:27`–`29`.

The calendar parser correctly validates the device's timezone-free text using UTC fields, but then creates a local `Date`. Local timezone daylight-saving rules can normalize a valid device time to a different hour. Formatting, tooltip times, and chart window calculations then use this altered time. At the end of the viewer's spring-forward gap, the altered local times also decrease, which makes the adapter discard otherwise monotonic device records as a clock reversal.

**Confirmed reproduction:** In a Node process set `process.env.TZ = 'America/New_York'`. A valid CSV row whose `ts_iso` is `2026-03-08 02:30:00` renders via `new Date(history.latestTimestamp).toLocaleString('sv-SE')` as `2026-03-08 03:30:00`. Two rows with `ts_iso` values `2026-03-08 02:59:00` and `2026-03-08 03:00:00`, and raw `ts` increasing by 60 seconds, produce `snapshotCount=1`, `reversedRows=1`, and `droppedRows=1`. The device text is valid and increasing; only the viewer's DST conversion creates the reversal.

**Spec compliance:** Device timestamps must display their timezone-free wall-clock text and must not depend on the phone's clock/timezone interpretation. This is a real calendar-correctness issue for users in DST zones; Shanghai's current timezone hides it.

**Fix direction:** Keep wall-clock order on a timezone-neutral numerical coordinate, preserve the validated original text, and make device chart axes/tooltips/history-list formatting use those wall-clock components consistently. Factory charts should keep their current local-time behavior.

**Coverage:** `tests/device-history.test.mjs:129` covers malformed dates and explicit timezone suffixes. Current clock-offset tests use ordinary dates/local calendar construction and do not cross a viewer DST gap.

### P3 — Device window endpoint rounds up instead of using the last record

**Location:** `src/utils/chart-options.js:102`.

Although the page passes `deviceHistory.latestTimestamp` as `behavior.now`, `lineOption` always rounds it up to the next minute. Device logs contain real seconds, so the 2/24-hour window shifts forward by up to 59 seconds and its endpoint no longer equals the last record. This is a small but direct mismatch with the specified last-device-record window semantics.

**Confirmed reproduction:** Build history from `ts_iso=2026-11-18 13:50:36`, then call `lineOption` with `now=history.latestTimestamp` and `windowMs=7200000`. `option.xAxis.max - history.latestTimestamp === 24000`; the lower window bound shifts by the same amount.

**Fix direction:** Allow device history to use its exact timestamp while preserving existing minute rounding in factory mode.

**Coverage:** `tests/device-history-integration.test.mjs:135` checks the window using `latestTimestamp=180000`, already an exact minute, so it cannot detect this discrepancy.

## Verified behavior

- History requests go directly to `/backup/battery-log.csv` independently of original-router login; factory mode returns disabled without this history fetch.
- Normal/forced CSV reads share an in-flight request, manual force bypasses fresh cached failures, and cache identity avoids repeat adapter work.
- The adapter distinguishes zero/null added telemetry, retains separate LTE/NR series, carries network/segment boundaries, and drops prior prefixes on actual raw/calendar reversals rather than sorting them together.
- Same-endpoint fetch errors retain the downloaded archive and expose failure/latest time; endpoint changes discard old result/cache, including late responses.
- The page's 88 path bypasses old phone chart loading/writes/capture and native historical backfill. Current diagnostic samples remain in memory and do not populate the device chart archive.
- The history-only interval checks `document.visibilityState`. An initially suspected hidden-page polling problem is **not a finding**: the coordinating reviewer confirmed that actual `MainActivity.onPause` pauses the WebView and timers, and `onResume` resumes them. The no-screen-off-query behavior should be assessed together with that native lifecycle.

## Validation run

Executed, with Windows `tty:true`, and no live device transport:

```text
node --test tests/device-history.test.mjs tests/device-history-integration.test.mjs tests/battery-csv.test.mjs tests/battery-csv-client.test.mjs tests/battery-config-race.test.mjs tests/battery-integration.test.mjs tests/background-history.test.mjs tests/chart-options.test.mjs tests/chart-tooltip.test.mjs tests/chart-performance.test.mjs tests/router-api-contract.test.mjs tests/dashboard-navigation.test.mjs
```

Result: **225 tests passed, 0 failed, 0 skipped**, exit code 0. Additional direct Node reproductions confirmed all three findings above. Passing tests therefore establish current regression coverage, but do not close these missing-value/DST/subminute cases.

No APK, JVM, instrumentation, native service, install, or device checks were run by this JavaScript reviewer; those remain with the coordinating/native review work.
