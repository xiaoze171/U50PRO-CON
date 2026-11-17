# Navigation test harness correction

The new Android full-screen stock UI test extracted `openStockConsoleNative()` into a VM context without its `stockOpenMode` dependency. The real page initializes this value using `routerApi.stockUiOpenMode()`, which returns `navigate` for Android when the local stock proxy is unavailable.

Changed only the test fixture in `tests/dashboard-navigation.test.mjs` to supply `stockOpenMode: 'navigate'`. Existing assertions still require the saved router URL to reach the Android bridge, the confirmed session to mark the console logged in, and the busy flag to clear. No production changes were needed.

Verification on November 17, 2026:

- Before: `node --test tests/dashboard-navigation.test.mjs` exited 1, with 24 passed and 1 failed. The failing assertion reported `ReferenceError: stockOpenMode is not defined`.
- After: the same command exited 0, with all 25 tests passed and 0 failed.

The code delta from the delegated starting state is one fixture property:

```diff
 const context = {
+  stockOpenMode: 'navigate',
   stockConsole: { busy: false, loggedIn: false, message: '' },
```
