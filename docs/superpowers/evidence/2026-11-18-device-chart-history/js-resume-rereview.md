# Scoped JavaScript re-review — 2026-11-18

Re-reviewed only the fixes for the three findings in `js-resume-review.md`, plus regressions introduced by those fixes. Reviewed current uncommitted CSV parser/client, router history path, adapter, chart preparation, source tooltip, page time/window plumbing, `BatteryHistory.vue`, `format.js`, new tests, and the recorded `fix-1*.log`, `fix-2*.log`, and `fix-3*.log` results.

**Result: all three original findings are ADDRESSED. No new actionable breakage was found within the scoped fixes.**

## Finding 1: missing battery fields discard valid telemetry — ADDRESSED

- `src/utils/battery-csv.js:77` now defaults to the existing strict estimator mode and has an explicit history parsing mode. Timestamp validation and structural/header/size checks remain shared. History parsing makes missing/malformed battery metrics independently nullable and retains valid speed, temperature, and signal fields; it still rejects invalid raw timestamps.
- `src/services/battery-csv-client.js:47` retains separate strict `csv` and nullable `historyCsv` representations for the same download. `src/services/router-client.js:381` explicitly uses `historyCsv` for charts. Battery estimates continue to consume strict `csv`; the change does not substitute permissive chart rows into the estimator path.
- `src/utils/chart-options.js:57` retains timestamp-valid device samples whose SOC is missing, converting that percentage to `null`; factory samples keep their prior filtering. The line renderer has `connectNulls:false`, so a valid/null/valid SOC sequence remains disconnected rather than filtering away the intervening missing sample.
- `src/components/BatteryHistory.vue:9` renders missing SOC as `—`, fixing the `%`-only display that otherwise followed from retaining nullable battery rows.

**Evidence:** `tests/device-history.test.mjs:29` checks empty/malformed `soc`, `voltage_mv`, `current_ma`, `power_w`, `temp_c`, and empty `status`. Each strict estimator row remains rejected while the history row preserves download/CPU/NR values and record identity. `tests/device-history.test.mjs:44` verifies `[91.8434, null, 91]` survives battery series and line preparation with `connectNulls:false`. The actual mocked router path is checked by `tests/device-history-integration.test.mjs:71`, and SSR history-list rendering is checked by `tests/device-history-time.test.mjs:53`.

The recorded red results contain the missing-telemetry, missing-SOC-gap, and router-path failures. `fix-1-green.log` reports 118 passing tests, including unchanged strict CSV parser/estimator fixtures; `fix-1-list-red.log` demonstrates the `%`-only output and `fix-1-list-green.log` reports all three list/time tests passing.

## Finding 2: viewer DST rewrites wall-clock text and fabricates reversals — ADDRESSED

- `src/utils/device-history.js:27` now returns the validated UTC-field coordinate directly. It no longer creates a local `Date`, so viewer DST rules cannot shift the stored wall-clock coordinate or fabricate a reversal. Validated original text is retained in each battery sample's `wallClock` and in `latestWallClock` (`src/utils/device-history.js:107`, `115`).
- Device axes opt into ECharts `useUTC` and use UTC getters in the custom axis label formatter (`src/utils/chart-options.js:118`, `144`). Factory axes continue to use local getters.
- `src/utils/format.js:98` accepts the source, formatting device coordinates with UTC ISO components and keeping the existing local `Intl.DateTimeFormat` for factory history. Device tooltip headings, battery history-list dates, and the page's latest-record hint all route through this source-aware formatting (`src/utils/collection-source.js:44`, `src/components/BatteryHistory.vue:6`, `src/pages/index/index.vue:1206`).

**Evidence:** `tests/device-history-time.test.mjs:21` exercises `America/New_York`, `Europe/Berlin`, `Asia/Shanghai`, and `UTC`. The original New York spring-gap sequence `2026-03-08 02:59:00` → `03:00:00` retains two records with zero reversals. Tests check 2-hour labels, 24-hour date/time labels, tooltip headings, latest-record hints, and rendered history-list dates. The factory regression test at line 61 verifies local axes/tooltips/date formatting remain intact. `fix-2-red.log` records the original failure; `fix-2-green.log` reports 56 passing tests. Historical render warnings in intermediate green logs did not recur in the current focused run.

## Finding 3: device windows round the last record up — ADDRESSED

- `src/utils/chart-options.js:104` uses the exact timestamp when `behavior.deviceTime` is enabled and keeps the existing minute rounding otherwise.
- `src/pages/index/index.vue:1212` supplies `deviceTime:true` for all device-history metric charts. The throughput prefilter at line 1217 now also uses the exact device timestamp, so it does not shift the effective data cutoff before `lineOption` receives the data.

**Evidence:** `tests/device-history-integration.test.mjs:154` checks the original subminute coordinate `1795009836000` for both 2-hour and 24-hour windows: maximum equals the last record and minimum equals that exact coordinate minus the requested duration. The same test checks the factory maximum remains `1795009860000` and its 2-hour minimum remains `1795002660000`. `fix-3-red.log` records the original 24-second discrepancy; `fix-3-green.log` reports 23 passing tests.

## Current focused verification

Executed only the three relevant test files, with Windows `tty:true` and mocked transport:

```text
node --test tests/device-history.test.mjs tests/device-history-integration.test.mjs tests/device-history-time.test.mjs
```

**31 passed, 0 failed, 0 skipped**, exit code 0. No Vue render warnings occurred. The coordinating reviewer owns the complete both-profile JavaScript run; this re-review did not duplicate that full suite.

No implementation, Git/config, shared build output, or device state was changed. This re-review report is the only artifact written in this scoped pass.
