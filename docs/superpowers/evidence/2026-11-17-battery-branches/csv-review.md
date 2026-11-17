# Task 1 review

Spec compliant: strict bounded CSV parsing, preserved invalid boundaries, device-clock age0..120, continuity/reboot/threshold/live joining, actual SOC slope to0/100 and exclusive device CSV.
Cross-task transport freshness/cache/native parity require integration verification.

Important: src/utils/battery-csv.js:207-222 repeats unknown/full/confirming/external guard chain from src/utils/battery-estimate.js:74-89 almost verbatim. Extract shared pure guard/result initialization, retain separate fitting. Task quality needs fixes.
Minor: exact .2SOC/.05Wh accepted threshold fixtures missing; add shared deterministic boundary cases.

Review inspected diff and focused unchanged sanitizer/guard contract, no suites rerun. Root dispatches fix1 to original worker; scoped re-review next.
