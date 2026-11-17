# Battery branch split implementation plan

> **For agentic workers:** Use subagent-driven-development for independent implementation units, then integration review.

**Goal:** Preserve factory behavior and share the current UI with the new 88/CSV branch.

**Architecture:** A single profile selects two data strategies behind the existing battery summary interface. JavaScript and Android consume the same profile and deterministic fixtures.

**Tech Stack:** Vue/uni-app, JavaScript node:test, Java 8/Android, Gradle.

**Spec:** `docs/superpowers/specs/2026-11-17-battery-branches.md`

## Global constraints

- UI source is identical across branches. No duplicate page/component tree.
- Factory runtime uses the original 24-hour continuous SOC endpoint slope (minimum 0.15 hours).
- Gauge runtime uses device CSV exclusively, output target 0%; no app-history fallback.
- All Windows commands use `tty: true`; subprocesses and helpers remain hidden.
- No push, release or installation; keep unrelated untracked files intact.

## Task 1: CSV analysis module

Create `src/utils/battery-csv.js`, `tests/battery-csv.test.mjs`, `tests/fixtures/battery-csv-cases.json`.
Interfaces: `parseBatteryCsv(text)` returns `{rows, invalidRows}`; `estimateCsvBatteryTimes({csv, measurement, deviceNowSeconds, calculatedAt})` returns `{timeToFull,runtime,calculatedAt,windowSeconds,csvAnalysis}` using the existing time result shape. Export a pure analysis helper if native fixtures need it. `csv` is the parsed result.

- [x] Write failing tests for quoted/reordered CSV, invalid boundaries, 50% SOC with a 5 percentage point/hour drop => 600 minutes, 0% => 0, stale log, clock offset, charging, tapering, corrections, short windows and malformed inputs.
- [x] Run `node --test tests/battery-csv.test.mjs` and verify intended failures.
- [x] Implement strict parser and time-based segment analysis per spec; no imports/execution of device evidence scripts.
- [x] Run parser/model tests including repository device CSV sample.

## Task 2: JavaScript transport and profile integration

Modify `src/services/router-client.js`, `dev/battery-proxy.js`, `desktop/router-http.js`, and relevant tests. Create `src/services/battery-csv-client.js`, `src/utils/battery-factory.js` if useful. Controller owns `config/battery-profile.json` and shared UI.
Consume `parseBatteryCsv` and `estimateCsvBatteryTimes` from Task 1. Import profile JSON directly; enforce it at config load/update. Factory estimate takes original status and only factory samples. `batterySummary` retains its public shape and gains CSV provenance. Native bridge passes text responses through existing body parsing.

- [x] Write failing observable integration tests: gauge requests CSV and yields estimate from pre-existing device history immediately; factory never requests port 88 and preserves legacy slope; cache interval/coalescing, bad CSV and source-change races; CSV proxy route and cookie isolation.
- [x] Run targeted tests to prove failures.
- [x] Implement independent bounded CSV cache, gate source using profile, wire both summaries and restore paths, extend allowed gauge routes.
- [x] Update old integration cases where model contract intentionally changed, retaining equivalent coverage for persistence, identity and freshness.
- [x] Run all JavaScript tests for both profile values.

## Task 3: Native background parity

Modify Gradle, `BatteryGaugeConfig`, `MonitorRouterClient`, `BackgroundMonitorService`, `MonitorHistoryStore`, native tests/test runner; create `BatteryCsv` / `BatteryProfile` helpers as needed. Consume the same JSON profile and Task 1 fixture.

- [x] Write failing native CSV and factory/source migration tests.
- [x] Implement native profile enforcement, independent CSV fetch/cache without cookies, limits/timeouts and same analysis thresholds; attach summary to background snapshot and retain provenance in compact serialization.
- [x] Keep original factory estimator behavior for native history and do not let prepareBatterySnapshot replace CSV/factory estimates with app-current estimates.
- [x] Run native JVM suite and Android compilation.

## Task 4: Shared UI, branch tips and verification

Controller owns profile file, shared UI presentation and README. UI must communicate effective source, fixed gauge port and CSV unavailable/stale/collecting reasons without exposing a source selector that contradicts the branch.

- [x] Preserve existing working code in a baseline commit on the newly created branch, excluding untracked binaries/tools.
- [x] Adapt common settings and detail labels to effective profile/summary provenance.
- [x] Run H5 builds and relevant desktop/native regression suites.
- [x] Independent review of final integration; fix actionable defects and re-test.
- [ ] Commit shared implementation with factory profile, advance `codex/daily-monitor-ui` by fast-forward, then commit only profile switch to `gauge88-csv` on new branch. Rebuild generated assets consistently or generate them at build time to avoid branch UI source drift.
- [ ] Verify branch diff contains only the intended profile distinction; leave new branch checked out and record validation.
