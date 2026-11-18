# Native request lifecycle re-review

**Verdict: ADDRESSED.** The original request-chain finding is fixed in the reviewed source. No new concrete production breakage was found in this request fix. This re-review excludes overlay selection/revision and RouterBridge changes.

## Why the original reproduction stops now

`BackgroundMonitorService.java:472` supplies a per-poll predicate requiring a running service, unchanged configuration generation, and current native snapshot eligibility. Screen-off increments the generation, stops the scheduler, and cancels owned requests at lines 108-114. Disable and service destruction also cancel pending requests after clearing `running`.

`MonitorRouterClient.java:61-68` propagates that predicate into the initial status and any login sequence. Every factory request now checks the predicate before starting transport (`request()` at lines 281-305) and after receiving response headers at line 306. The group loop checks again at line 74. Thus the original delayed-status/screen-off reproduction ends without sending the remaining groups, station lists, or gauge request. The station-list exception handlers cannot restart traffic because both commands retain the same false predicate. Login uses that predicate for each constituent GET/POST at lines 267-274.

The gauge branch uses the same gate for its asynchronous CSV loader at lines 63-64, before the state query at lines 96-97, and at both transport entry points (`fetchGaugeState()` lines 146-167; `fetchGaugeCsv()` lines 203-218). Pending connections use a concurrent set; `cancelPendingRequests()` invalidates/cancels the CSV future and disconnects owned connections at lines 184-187. A cancelled poll also fails the final gate at line 115.

## Recorded regression evidence

I read the existing logs without rerunning shared builds or performing device actions:

- `fix-4-red-gauge88-csv.log`: the original delayed-response regression fails with `screen-off must suppress all later HTTP, observed 9`.
- `fix-4-green-gauge88-csv.log` and `fix-4-green-factory.log`: all five lifecycle scenarios pass: screen-off, disable, generation invalidation, screen-off before login, and factory screen-off. Both logs also report passing native authentication and CSV cache/isolation tests.

`tests/java/NativeMonitorRequestLifecycleTest.java:52-85` holds an actual local HTTP status response, changes the lifecycle predicate, then releases it. Gauge lifecycle scenarios assert exactly one request; the factory scenario asserts all nine requests still complete. Each scenario also reenables the predicate and asserts another complete nine-request dashboard sequence. This directly tests request counts rather than only rejecting the final snapshot.

Test limits: the JVM fixture deliberately uses a factory battery source to isolate the factory HTTP chain. It does not execute the asynchronous gauge CSV/state branch or the service receiver/disconnect path; the source review above covers predicate propagation into those branches. Root subsequently completed separate Android verification: final gauge and factory instrumentation logs each report `OK (21 tests)`, and the live gauge screen-off check reports `polling=false`, no wake/Wi-Fi locks, and `lastSavedAt=0`. The JVM logs alone do not establish those device results; their evidence is in `.codex/device88-audit-20261118/instrumentation-gauge-final.txt`, `instrumentation-factory-final.txt`, and [the final verification](../../../verification-device-chart-history-2026-11-18.md).

## API 23 and factory compatibility

- The request predicate is a custom `RequestAllowed` interface, avoiding a newly required `java.util.function.BooleanSupplier` runtime API. `Collections.newSetFromMap`, `ConcurrentHashMap`, `InterruptedIOException`, existing executor APIs, and `HttpURLConnection.disconnect()` are available on API 23. No new API-24-only dependency is introduced by this fix.
- Existing ungated entry points remain available through overloads with an always-true predicate. The factory service's live predicate still allows screen-off polling because `MonitorRuntimePolicy.shouldPoll(false, ..., screenInteractive=false)` remains true, and only gauge mode registers the screen-off cancellation receiver.
- Factory SMS requests retain their previous always-allowed command route. A destroyed service now cancels owned requests; it does not suppress ordinary factory screen-off collection. The recorded factory regression confirms all nine dashboard requests and successful subsequent dashboard requests.

The request fix satisfies the original spec requirement that the optional gauge88 overlay must not continue initiating its query chain after screen-off or disable. No additional request-fix findings.
