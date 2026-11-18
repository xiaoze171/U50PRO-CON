package cn.mu5120.console;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.test.AndroidTestCase;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/** Pausing the WebView also invalidates already queued native foreground HTTP. */
public final class RouterBridgeLifecycleTest extends AndroidTestCase {
    private static final class RecordingWebView extends WebView {
        RecordingWebView(Context context) { super(context); }
        @Override public void evaluateJavascript(String script, ValueCallback<String> callback) { }
    }
    private static void foreground(RouterBridge bridge, boolean foreground) throws Exception {
        try {
            Method method = RouterBridge.class.getDeclaredMethod("setAppForeground", boolean.class); method.setAccessible(true);
            method.invoke(bridge, foreground);
        } catch (NoSuchMethodException missingGate) { /* The old implementation runs the actual HTTP reproduction below. */ }
    }
    private void pausedRequests(boolean factory) throws Exception {
        FutureTask<RecordingWebView> create = new FutureTask<>(() -> new RecordingWebView(getContext()));
        new Handler(Looper.getMainLooper()).post(create);
        RecordingWebView webView = create.get(5, TimeUnit.SECONDS);
        RouterBridge bridge = new RouterBridge(webView);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicInteger requests = new AtomicInteger();
        ServerSocket server = new ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"));
        Thread receiver = new Thread(() -> {
            try {
                while (!server.isClosed()) {
                    try (Socket socket = server.accept()) {
                        BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                        String line;
                        while ((line = input.readLine()) != null && !line.isEmpty()) { }
                        if (requests.incrementAndGet() == 1) {
                            entered.countDown(); release.await(5, TimeUnit.SECONDS);
                        }
                        try { socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".getBytes(StandardCharsets.UTF_8)); }
                        catch (java.io.IOException cancelledConnection) { }
                    }
                }
            } catch (Exception closed) { }
        }, "held-foreground-http");
        receiver.start();
        try {
            String payload = new JSONObject().put("url", "http://127.0.0.1:" + server.getLocalPort() + "/goform/status").put("timeoutMs", 3000).toString();
            foreground(bridge, true); bridge.request("active", payload);
            assertTrue("foreground HTTP entered before pause", entered.await(5, TimeUnit.SECONDS));
            foreground(bridge, false); bridge.request("late", payload); release.countDown();
            Field executor = RouterBridge.class.getDeclaredField("executor"); executor.setAccessible(true);
            ThreadPoolExecutor workers = (ThreadPoolExecutor) executor.get(bridge);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while ((workers.getActiveCount() > 0 || !workers.getQueue().isEmpty()) && System.nanoTime() < deadline) Thread.sleep(10);
            assertEquals("native workers finish their held/queued requests", 0, workers.getActiveCount());
            assertEquals(factory ? "factory pause retains existing transport behavior" : "pause must prevent the second foreground HTTP request", factory ? 2 : 1, requests.get());
        } finally {
            release.countDown(); bridge.shutdown(); server.close(); receiver.join(5000);
            FutureTask<Void> destroy = new FutureTask<>(() -> { webView.destroy(); return null; });
            new Handler(Looper.getMainLooper()).post(destroy); destroy.get(5, TimeUnit.SECONDS);
        }
    }
    public void testPausedDeviceHistoryBridgeCannotStartSubsequentRequests() throws Exception {
        if ("gauge88-csv".equals(BatteryProfile.mode())) pausedRequests(false);
    }
    public void testFactoryBridgePauseRetainsExistingRequestBehavior() throws Exception {
        if ("factory".equals(BatteryProfile.mode())) pausedRequests(true);
    }
}
