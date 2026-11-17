package cn.mu5120.console;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

/** The activity's bridge lifecycle releases real HTTP/history workers and its localhost proxy. */
public final class NativeLocalBridgeTest {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        Method shutdown;
        try { shutdown = RouterBridge.class.getDeclaredMethod("shutdown"); }
        catch (NoSuchMethodException error) {
            throw new AssertionError("Local bridge lifecycle must release requests and history without a LAN service", error);
        }
        shutdown.setAccessible(true);
        RouterBridge bridge = new RouterBridge(null);
        try {
            Field workerField = RouterBridge.class.getDeclaredField("executor");
            workerField.setAccessible(true);
            ExecutorService workers = (ExecutorService) workerField.get(bridge);
            check("completed".equals(workers.submit(() -> "completed").get(5, TimeUnit.SECONDS)),
                "router and asynchronous history workers accept work while the activity is open");
            check(bridge.getStockProxyPort() > 0, "embedded stock UI starts its localhost proxy");
            shutdown.invoke(bridge);
            check(workers.awaitTermination(5, TimeUnit.SECONDS), "bridge shutdown terminates idle request/history workers");
            try {
                workers.submit(() -> "late request");
                throw new AssertionError("a destroyed activity must reject new router/history requests");
            } catch (RejectedExecutionException expected) { }
            check(bridge.getStockProxyPort() == 0, "bridge shutdown releases the stock UI proxy");
            shutdown.invoke(bridge);
        } finally {
            shutdown.invoke(bridge);
        }
        System.out.println("PASS native local bridge request/history worker and localhost proxy lifecycle");
    }
}
