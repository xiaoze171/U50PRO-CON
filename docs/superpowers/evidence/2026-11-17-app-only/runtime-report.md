# App-only runtime cleanup — 2026-11-17

Scope: runtime transport and stock UI browser preview cleanup. No commits, profile edits, Gradle builds, or generated Android artifacts were made by this runtime task.

## Changes

- `src/services/router-client.js`: removed `isH5`, browser `/router-api` and `/battery-api` URLs, the `uni.request` fallback, dead JS cookie collection/headers, and the browser-specific forced `LOGOUT`. Every router/gauge/CSV request now requires `AndroidRouter.request`; a missing bridge produces `Android 原生桥接不可用，请在 Android App 中打开`.
- Kept the native request payload/callback parsing, timeouts, bounded CSV handling, local configuration, background collection/history merge, and both battery profiles.
- Native session ownership remains in `RouterBridge`/`RouterSession`: Android supplies Cookie/Origin/Referer and ignores those JS headers. Configuration changes still invoke native `clearSession`.
- `src/pages/index/index.vue`: removed the H5 preview diagnostic, external browser stock UI entry, browser-only same-origin iframe hash watchers/retries, and browser navigation fallbacks. Native localhost proxy embedding, 2-second native session recovery, zoom controls, and `openStockUi` full-screen navigation remain. Missing full-screen bridge reports an explicit error without navigating the browser.
- `tests/app-runtime.test.mjs`: added native-only router rejection, native login URL/body/callback behavior, and local-proxy/full-screen selection regressions.
- `tests/dashboard-navigation.test.mjs`: added missing-bridge full-screen behavior, embedded native login, and native session recovery coverage.
- Existing runtime integration tests already used `AndroidRouter.request`; no old `uni.request` fixtures needed migration. The only test `uni.request` stub is deliberately provided by the new negative test to prove browser transport is never invoked.

## Verification

1. Red: `node --test --test-reporter=spec tests/app-runtime.test.mjs` before the transport edit: 3 tests, 2 failures. Missing-bridge login incorrectly succeeded via the browser fallback, and forced native login performed the browser-specific logout before requesting `/index.html`.
2. Red: `node --test --test-reporter=spec --test-name-pattern='stock UI|stock UI restores' tests/dashboard-navigation.test.mjs` before the page edit: 4 tests, 1 failure. Missing native stock bridge still navigated the browser and reported ready instead of the bridge error.
3. Green targeted: `node --test --test-reporter=spec tests/app-runtime.test.mjs tests/dashboard-navigation.test.mjs tests/battery-profile-integration.test.mjs tests/background-history.test.mjs`: 56 passed, 0 failed.
4. Green final full suite: `node --test --test-reporter=spec tests/*.test.mjs`: 285 passed, 0 failed, 0 skipped/cancelled. Exit 0, duration 2592 ms. This includes the factory and gauge88-csv profile tests without changing the tracked profile.
5. `git diff --check`: exit 0. Git only warned about the root task's `vite.config.js` LF/CRLF normalization.
6. Scoped source scan found no `H5`, `isH5`, `/router-api`, `/battery-api`, `uni.request`, same-origin stock watcher, browser/external stock entry, or browser preview text in the two edited production files.
7. Independent read-only native/session review found no actionable correctness issue. Callback transport and session ownership remain consistent with native Java.

The full APK build and on-device verification are outside this runtime subtask. The existing updater's GitHub `fetch` and chart WebView shim were retained because they serve the App itself.
