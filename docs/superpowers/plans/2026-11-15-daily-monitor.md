# Daily Monitor Implementation Plan

> **For agentic workers:** Use subagent-driven-development. User approved implementation and in-place APK upgrade on 2026-11-15. Keep executing through build, install and verification.

**Goal:** Deliver the approved daily monitoring UI, correct invalid temperature handling, and install the signed update on the connected phone without clearing data.

**Architecture:** Keep Vue/uni-app, existing router communication, Android background service, LAN synchronization and history storage. Reorganize navigation into 首页 / 趋势 / 设备 / 设置; retain existing detailed flows behind these entries. Share explicit temperature validation between JS consumers, with matching native validation.

**Tech Stack:** Vue 3, uni-app, ECharts, Electron, Java Android WebView, Node test runner.

**Spec:** `docs/ui-functional-review-2026-11-15.md` (approved by “开始实现，然后覆盖安装”).

## Global constraints

- Windows commands use `tty:true`; subprocesses use no-window flags. Always target phone serial explicitly, never the router's ADB endpoint.
- Preserve full background collection, 24-hour history, source tags, virtual lists, compact live publications, fallback/direct connection, manual radio settings and in-app APK updates.
- Light palette: page #f3f6fa, surface #ffffff, ink #172b45, secondary #61728a, blue #246bfd, divider #e6ecf3. System Chinese fonts and tabular numeric digits; no remote font dependency.
- Mobile has readable single-column hierarchy and fixed four-item navigation. Desktop uses sidebar and multiple columns. No new large blur/gradient surfaces.
- Existing user changes in `desktop/package.json` and untracked release artifacts remain intact. Work on a new local `codex/` branch in the current checkout to reuse Android build dependencies. No push or Release publication requested.
- Unknown, disconnected and invalid measurements must not become zero, normal charging state, or fresh data. Raw temperature values remain available for diagnostics.

## Task 1: Temperature and time correctness

Files: new `src/utils/temperature.js`; `src/utils/history.js`, `src/utils/format.js`, `src/services/router-client.js`; native `TemperatureReading.java`, `MonitorHistoryStore.java`, `BackgroundMonitorService.java`; focused Node/Java tests.

Interface: `TEMPERATURE_LABELS`, `isTemperatureField(key)`, `temperatureReading(key, raw)` returning `{ value: number|null, state: 'valid'|'missing'|'invalid', raw: string }`, `normalizeTemperaturePoints(key, list)` retaining valid source-tagged points. Known temperature fields explicitly include `wifi_temp_level_1/2`, exclude `therm_*_level`. Reject nonnumeric and implausible readings outside -40..150 °C as suspect; this is an application plausibility guard, not a claim about a 9461 sentinel or an operating temperature rating.

- [x] Reproduce `wifi_chip_temp=-80`, valid independent Wi-Fi sensors, malformed text, empty values, legitimate negative signal values and `formatHours(12.999)` with failing tests.
- [x] Implement explicit sensor semantics and validation. Preserve raw snapshots, sanitize temperature chart/battery sample history on merge and read, match native generated histories and displayed battery temperature.
- [x] Fix duration rounding via total rounded minutes, not separately rounded remainder. Keep unknown charging distinct where new summaries consume it.
- [x] Run targeted Node and native tests; report exact changes and test results for review.

## Task 2: Daily monitoring navigation and content

Files: `src/pages/index/index.vue`, optional new `src/components/DashboardHome.vue`, focused navigation/summary behavior tests. Integrate Task 1 exports without duplicating its implementation.

- [x] Establish four main routes and subviews, including backward compatibility for old radio/usage/battery/manage links and native shortcuts.
- [x] Homepage: compact persistent connection/source/freshness status; primary real upload/download values and chart; battery + monthly usage + valid temperatures; connected clients / SMS shortcuts. Distinguish unknown readings and estimates.
- [x] Trends: throughput, temperature, battery, signal; 2h/24h switch, readable time marks, no slider; clip only view data and retain source tags. Signal uses per-metric selection to avoid combined scales.
- [x] Devices: clients by default plus network/radio, SMS inbox-first with compose toggle, original console, device identity/control. Settings: connection before update; monitoring/sync settings, collapsible diagnostics and source counts.
- [x] Preserve all existing operation handlers and explicit risky-operation confirmation. Change misleading selected-cell “最强” wording to selected-cell description. Freshness status must remain visible on mobile.
- [x] Wire temperature validation into live metrics, capture/load/persist/merged histories and charts before smoothing. Validate unknown charging/usage summaries.
- [x] Run relevant tests and production H5 build after integration.

## Task 3: Light visual system

Files: `src/pages/index/index.css`, existing `MetricGrid.vue`, `DataList.vue`, `BatteryHistory.vue`, `App.vue`, `uni.scss`; native MainActivity and resource color edits owned by root.

- [x] Remove old glass background, nested blur and purple accents; use coherent light styles, clear number hierarchy, restrained borders/radii and accessible focus states.
- [x] Implement desktop sidebar, four-item mobile bottom nav, tab/subview states, forms and active/busy states. Preserve touch/virtualization behavior.
- [x] Coordinate class names with Task 2, verify narrow mobile and wide desktop screenshots, fix wrapping/overflow/low contrast.

## Task 4: Integration, review and delivery

Files: version manifests/lockfiles, Android theme, README, plan/verification notes; generated web assets and new signed APK.

- [x] Independently review Task 1 data handling and Task 2/3 integrated feature preservation; fix material findings.
- [x] Run `node --test tests/*.test.mjs`, desktop history/election/sync self-tests, native relevant tests, `npm run build:h5`, and Android release build.
- [x] Increment version to 1.4.0 and versionCode above installed package (minimum 72), preserving release signing credentials without logging them.
- [x] Verify APK package/version/signature against installed app, then `adb -s PHONE install -r APK`; never uninstall or clear app data.
- [x] Launch and inspect phone home, trends, devices, settings, back navigation, runtime errors, source/freshness and history availability; check screenshot layout. Do not execute real lock/reboot/SMS commands for UI tests.
- [x] Capture desktop browser layout using a local fixture or installed frontend, distinguish fixture checks from live data. Verify background records after a short background/resume cycle where possible.
- [x] Deliver APK path and actual installation/test outcome; report any remaining device-dependent limitation accurately.

## Execution record

- Baseline: 26 Node tests passed. Phone V2231A attached as `10ACAS1SDH000Q3`; router ADB also present and excluded from installation.
- 2026-11-15: implementation approved, plan recorded; no further design approval required.

- Final checks: 52 Node tests, 59 desktop selftests and 3 native test classes passed. Signed release 1.4.0/72 installed with data-preserving `install -r`; installed APK hash matches the delivered APK; release homepage shows live data.
- Background check: OriginOS froze the monitor process and disabled its wake lock. User requested completion of installation first and will configure background permissions later. No claim of successful screen-off collection.
