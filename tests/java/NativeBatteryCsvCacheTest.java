package cn.mu5120.console;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.lang.reflect.InvocationTargetException;

public final class NativeBatteryCsvCacheTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        Class<?> type;
        try { type = Class.forName("cn.mu5120.console.BatteryCsvCache"); }
        catch (ClassNotFoundException error) { throw new AssertionError("bounded coalescing native CSV cache is required", error); }
        Class<?> loaderType = Class.forName("cn.mu5120.console.BatteryCsvCache$Loader");
        AtomicInteger calls = new AtomicInteger(); AtomicLong now = new AtomicLong(1000); CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        Object loader = Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] { loaderType }, (proxy, method, values) -> {
            calls.incrementAndGet(); entered.countDown(); release.await();
            return "ts,soc,voltage_mv,current_ma,power_w,temp_c,status\n10,50,4000,-400,-1.6,25,Discharging";
        });
        Constructor<?> constructor = type.getDeclaredConstructor(loaderType, BatteryCsvCache.Clock.class); constructor.setAccessible(true);
        Object cache = constructor.newInstance(loader, (BatteryCsvCache.Clock) now::get);
        Method request = type.getDeclaredMethod("request", String.class), invalidate = type.getDeclaredMethod("invalidate");
        Future<?> first = (Future<?>) request.invoke(cache, "http://127.0.0.1:88/backup/battery-log.csv"); entered.await();
        Future<?> second = (Future<?>) request.invoke(cache, "http://127.0.0.1:88/backup/battery-log.csv");
        check(first == second, "concurrent polls coalesce CSV requests"); release.countDown(); first.get();
        check(request.invoke(cache, "http://127.0.0.1:88/backup/battery-log.csv") == first && calls.get() == 1, "60 second cache reuse");
        now.set(60999); request.invoke(cache, "http://127.0.0.1:88/backup/battery-log.csv"); check(calls.get() == 1, "cache interval before boundary");
        now.set(61000); ((Future<?>) request.invoke(cache, "http://127.0.0.1:88/backup/battery-log.csv")).get(); check(calls.get() == 2, "60 second cache refresh");
        invalidate.invoke(cache); ((Future<?>) request.invoke(cache, "http://127.0.0.1:88/backup/battery-log.csv")).get(); check(calls.get() == 3, "configuration invalidation forces refresh");
        ((Future<?>) request.invoke(cache, "http://127.0.0.2:88/backup/battery-log.csv")).get(); check(calls.get() == 4, "endpoint changes invalidate cache");
        check(BatteryProfile.isGaugeRoute(new java.net.URL("http://localhost:88/state.json"))
            && BatteryProfile.isGaugeRoute(new java.net.URL("http://localhost:88/backup/battery-log.csv")), "both gauge routes bypass factory cookies");
        testTransportIsolation();
        testBoundsAndRaces(constructor, loaderType, request, invalidate);
        System.out.println("PASS native CSV coalescing, 60s cache, configuration/endpoint invalidation and cookie route isolation");
    }
    private static void testTransportIsolation() throws Exception {
        Method fetch;
        try { fetch = MonitorRouterClient.class.getDeclaredMethod("fetchGaugeCsv", android.content.Context.class, String.class); }
        catch (NoSuchMethodException error) { throw new AssertionError("native gauge CSV cookie isolation must be verifiable with loopback transport", error); }
        AtomicInteger receivedCookie = new AtomicInteger();
        com.sun.net.httpserver.HttpServer server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool(task -> { Thread t = new Thread(task, "native-gauge-fixture"); t.setDaemon(true); return t; }));
        server.createContext("/backup/battery-log.csv", exchange -> {
            if (exchange.getRequestHeaders().getFirst("Cookie") != null) receivedCookie.incrementAndGet();
            exchange.getResponseHeaders().add("Set-Cookie", "gauge=must-not-join-factory");
            byte[] body = "ts,soc,voltage_mv,current_ma,power_w,temp_c,status\n10,50,4000,-400,-1.6,25,Discharging".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        server.createContext("/state.json", exchange -> {
            if (exchange.getRequestHeaders().getFirst("Cookie") != null) receivedCookie.incrementAndGet();
            exchange.getResponseHeaders().add("Set-Cookie", "gauge=must-not-join-factory");
            exchange.getResponseHeaders().add("X-Gauge-Age", "0");
            byte[] body = "{\"soc\":50,\"ts\":1000,\"data_quality\":\"ok\",\"status\":\"Discharging\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        server.createContext("/slow.csv", exchange -> {
            try {
                exchange.sendResponseHeaders(200, 0);
                for (int i = 0; i < 12; i++) { exchange.getResponseBody().write('a'); exchange.getResponseBody().flush(); Thread.sleep(500); }
            } catch (Exception expected) { } finally { exchange.close(); }
        });
        server.start();
        try {
            RouterSession.replace("factory=session-only");
            String endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/backup/battery-log.csv";
            check(((String) fetch.invoke(null, null, endpoint)).contains("Discharging"), "loopback CSV fetch succeeds");
            Method state = MonitorRouterClient.class.getDeclaredMethod("fetchGaugeState", android.content.Context.class, String.class);
            check("valid".equals(((JSONObject) state.invoke(null, null, endpoint.replace("/backup/battery-log.csv", "/state.json"))).getString("state")), "loopback state fetch ignores device vs phone clock offset");
            check(receivedCookie.get() == 0 && "factory=session-only".equals(RouterSession.header()), "CSV sends no factory cookie and absorbs no gauge Set-Cookie");
            long started = System.nanoTime();
            try { fetch.invoke(null, null, endpoint.replace("/backup/battery-log.csv", "/slow.csv")); throw new AssertionError("slow trickle must hit total CSV deadline"); }
            catch (InvocationTargetException error) { check(error.getCause() instanceof java.net.SocketTimeoutException, "slow trickle reports timeout"); }
            check((System.nanoTime() - started) / 1000000 < 4500, "continuous trickle cannot extend total request deadline");
        } finally { server.stop(0); RouterSession.clear(); }
    }
    private static void testBoundsAndRaces(Constructor<?> constructor, Class<?> loaderType, Method request, Method invalidate) throws Exception {
        AtomicInteger failures = new AtomicInteger();
        Object bad = Proxy.newProxyInstance(loaderType.getClassLoader(), new Class<?>[] { loaderType }, (proxy, method, args) -> {
            failures.incrementAndGet(); throw new java.net.SocketTimeoutException("fixture timeout");
        });
        Object cache = constructor.newInstance(bad, (BatteryCsvCache.Clock) () -> 1000);
        Object result = ((Future<?>) request.invoke(cache, "http://localhost:88/backup/battery-log.csv")).get();
        check(((BatteryCsvCache.Result) result).csv == null && ((BatteryCsvCache.Result) result).error.contains("timeout"), "request failures are explicit");
        ((Future<?>) request.invoke(cache, "http://localhost:88/backup/battery-log.csv")).get(); check(failures.get() == 1, "failure is cached independently for 60 seconds");
        CountDownLatch entered = new CountDownLatch(1), released = new CountDownLatch(1); AtomicInteger calls = new AtomicInteger();
        Object blocked = Proxy.newProxyInstance(loaderType.getClassLoader(), new Class<?>[] { loaderType }, (proxy, method, args) -> {
            if (calls.incrementAndGet() == 1) { entered.countDown(); while (released.getCount() != 0) try { released.await(); } catch (InterruptedException ignored) { } }
            return "ts,soc,voltage_mv,current_ma,power_w,temp_c,status\n10,50,4000,-400,-1.6,25,Discharging";
        });
        cache = constructor.newInstance(blocked, (BatteryCsvCache.Clock) () -> 1000);
        Future<?> old = (Future<?>) request.invoke(cache, "http://localhost:88/backup/battery-log.csv"); entered.await();
        invalidate.invoke(cache);
        Future<?> newer = (Future<?>) request.invoke(cache, "http://127.0.0.1:88/backup/battery-log.csv"); newer.get(); released.countDown();
        check(old.isCancelled() && request.invoke(cache, "http://127.0.0.1:88/backup/battery-log.csv") == newer, "obsolete endpoint request cannot replace new configuration cache");
        try { MonitorRouterClient.readBounded(new ByteArrayInputStream(new byte[17]), 16, Long.MAX_VALUE); throw new AssertionError("oversized input must fail"); }
        catch (Exception error) { check(error.getMessage().contains("limit"), "bounded stream rejects oversized body"); }
        try { MonitorRouterClient.readBounded(new ByteArrayInputStream(new byte[1]), 16, 0); throw new AssertionError("elapsed total timeout must fail"); }
        catch (java.net.SocketTimeoutException expected) { }
    }
}
