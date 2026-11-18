package cn.mu5120.console;

import com.sun.net.httpserver.HttpServer;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real delayed HTTP responses expose requests initiated after lifecycle transitions. */
public final class NativeMonitorRequestLifecycleTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static void set(Object object, String name, Object value) throws Exception {
        Field field = object.getClass().getDeclaredField(name); field.setAccessible(true); field.set(object, value);
    }
    private static MonitorRouterClient client(String url) throws Exception {
        // Bypass only Android's asset/context constructor, as in NativeRouterAuthTest.
        Class<?> allocator = Class.forName("sun.misc.Unsafe");
        Field singleton = allocator.getDeclaredField("theUnsafe"); singleton.setAccessible(true);
        MonitorRouterClient client = (MonitorRouterClient) allocator.getMethod("allocateInstance", Class.class)
            .invoke(singleton.get(null), MonitorRouterClient.class);
        set(client, "routerUrl", url); set(client, "password", "fixture");
        JSONObject inventory = new JSONObject();
        for (String group : new String[] { "status", "signal", "temperature", "resources", "locks", "neighbors", "features" }) {
            inventory.put(group, new JSONArray().put(group.equals("status") ? "loginfo" : group));
        }
        set(client, "fields", inventory);
        BatteryGaugeConfig config = new BatteryGaugeConfig("factory", "", 88);
        // This fixture isolates the factory dashboard HTTP chain; no battery transport is mocked.
        set(config, "source", "factory"); set(client, "batteryConfig", config);
        return client;
    }
    private static void dashboard(MonitorRouterClient client, MonitorRouterClient.RequestAllowed allowed) throws Exception {
        Method method;
        try { method = MonitorRouterClient.class.getDeclaredMethod("dashboard", MonitorRouterClient.RequestAllowed.class); }
        catch (NoSuchMethodException missingGate) { method = MonitorRouterClient.class.getDeclaredMethod("dashboard"); }
        method.setAccessible(true);
        try { if (method.getParameterCount() == 0) method.invoke(client); else method.invoke(client, allowed); }
        catch (InvocationTargetException error) { throw (Exception) error.getCause(); }
    }
    private static void transition(String name, boolean screenOff, boolean disable, boolean generationChanged, boolean factory, boolean loginNeeded) throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicInteger requests = new AtomicInteger(), generation = new AtomicInteger(1);
        AtomicBoolean screen = new AtomicBoolean(true), enabled = new AtomicBoolean(true);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            int index = requests.incrementAndGet();
            if (index == 1) {
                entered.countDown();
                try { if (!release.await(5, TimeUnit.SECONDS)) throw new AssertionError("held response not released"); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            }
            byte[] body = (loginNeeded && index == 1 ? "{\"loginfo\":\"no\"}" : "{\"loginfo\":\"ok\"}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try { exchange.getResponseBody().write(body); } finally { exchange.close(); }
        });
        server.start(); ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            MonitorRouterClient client = client("http://127.0.0.1:" + server.getAddress().getPort());
            MonitorRouterClient.RequestAllowed allowed = () -> generation.get() == 1
                && MonitorRuntimePolicy.shouldPoll(!factory, enabled.get(), false, screen.get());
            Future<?> poll = worker.submit(() -> { try { dashboard(client, allowed); } catch (Exception expectedCancellation) { } });
            check(entered.await(5, TimeUnit.SECONDS), "first dashboard HTTP entered: " + name);
            if (screenOff) screen.set(false);
            if (disable) enabled.set(false);
            if (generationChanged) generation.incrementAndGet();
            release.countDown(); poll.get(5, TimeUnit.SECONDS);
            if (!factory) check(requests.get() == 1, name + " must suppress all later HTTP, observed " + requests.get());
            else check(requests.get() == 9, "factory screen-off still completes all nine dashboard HTTP requests");
            screen.set(true); enabled.set(true); generation.set(1);
            int beforeResume = requests.get();
            dashboard(client, allowed);
            check(requests.get() == beforeResume + 9, "screen-on/new generation resumes dashboard HTTP: " + name);
        } finally { release.countDown(); worker.shutdownNow(); server.stop(0); }
        System.out.println("PASS native dashboard request lifecycle " + name);
    }
    public static void main(String[] args) throws Exception {
        transition("screen-off", true, false, false, false, false);
        transition("disable", false, true, false, false, false);
        transition("generation invalidation", false, false, true, false, false);
        transition("screen-off before login", true, false, false, false, true);
        transition("factory screen-off", true, false, false, true, false);
    }
}
