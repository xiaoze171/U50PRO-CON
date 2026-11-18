package cn.mu5120.console;

import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Set;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;

public final class RouterBridge {
    private final WebView webView;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final StockProxyServer stockProxy = new StockProxyServer();
    private String lastSharedSession = "";
    private volatile boolean appForeground = true;
    private volatile long requestGeneration;
    private final Set<HttpURLConnection> foregroundReads = Collections.newSetFromMap(new ConcurrentHashMap<HttpURLConnection, Boolean>());
    // 最近一次 H5 configureBackground 传来的路由器地址，供 StockProxyServer
    // （原厂后台本地反代）转发使用。
    private static volatile String routerBaseUrl = "http://192.168.0.1";

    RouterBridge(WebView webView) {
        this.webView = webView;
        stockProxy.start();
    }

    // 原厂后台本地反代端口（127.0.0.1），0 表示未启动（H5 会退回全屏直连）。
    @JavascriptInterface
    public int getStockProxyPort() {
        return stockProxy.getPort();
    }

    @JavascriptInterface
    public void clearSession() {
        RouterSession.clear();
        synchronized (this) { lastSharedSession = ""; }
        BackgroundMonitorService.clearSession(webView.getContext());
    }

    @JavascriptInterface
    public void configureBackground(String routerUrl, String password, String batterySettings) {
        BackgroundMonitorService.configure(webView.getContext(), routerUrl, password, batterySettings);
        if (routerUrl != null && !routerUrl.trim().isEmpty()) routerBaseUrl = routerUrl.trim();
    }

    static String getRouterBaseUrl() {
        return routerBaseUrl;
    }

    // 原厂后台全屏直连：H5 页面点"进入原厂后台"时调用。走 loadUrl 而非页面
    // location.href，避开 WebViewClient 导航拦截的不确定性；仅放行局域网
    // 路由器地址（与 request() 同一份白名单）。
    @JavascriptInterface
    public void openStockUi(final String url) {
        final String target = url == null ? "" : url.trim();
        try {
            URL parsed = new URL(target);
            if (!"http".equals(parsed.getProtocol()) && !"https".equals(parsed.getProtocol())) return;
            if (!isLocalRouterHost(parsed.getHost())) return;
            // 会话由 HttpOnly Cookie 识别：把原生层持有的会话 Cookie 注入
            // WebView 的 CookieManager，全屏直连才能共享 App 的登录态。
            String sessionCookie = RouterSession.header();
            if (!sessionCookie.isEmpty()) {
                try {
                    CookieManager cookieManager = CookieManager.getInstance();
                    for (String raw : sessionCookie.split(";")) {
                        String value = raw.trim();
                        if (!value.isEmpty()) cookieManager.setCookie(target, value);
                    }
                    cookieManager.flush();
                } catch (Exception ignored) {}
            }
            webView.post(() -> webView.loadUrl(target));
        } catch (java.net.MalformedURLException ignored) {}
    }

    @JavascriptInterface
    public String getBackgroundBatteryHistory() {
        return BackgroundMonitorService.readBatteryHistory(webView.getContext());
    }

    @JavascriptInterface
    public void getBackgroundBatteryHistoryAsync(final String requestId) {
        executor.execute(() -> deliverHistory(requestId,
            BackgroundMonitorService.readBatteryHistory(webView.getContext())));
    }

    @JavascriptInterface
    public void getBackgroundHistory(final String requestId) {
        executor.execute(() -> {
            String history = BackgroundMonitorService.readMonitorHistory(webView.getContext());
            deliverHistory(requestId, history);
        });
    }

    private void deliverHistory(String requestId, String history) {
        String script = "window.__mu5120HistoryResponse(" + JSONObject.quote(requestId) + "," + JSONObject.quote(history) + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @JavascriptInterface
    public String getBackgroundMonitorState() {
        return BackgroundMonitorService.readMonitorState(webView.getContext());
    }

    @JavascriptInterface
    public void updateBackgroundSms(String payload) {
        BackgroundMonitorService.acceptSms(webView.getContext(), payload);
    }

    @JavascriptInterface
    public void updateBackgroundSnapshot(String payload) {
        BackgroundMonitorService.acceptSnapshot(webView.getContext(), payload);
    }

    @JavascriptInterface
    public boolean getOverlayEnabled() {
        return BackgroundMonitorService.isOverlayEnabled(webView.getContext());
    }

    @JavascriptInterface
    public boolean canDrawOverlays() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(webView.getContext());
    }

    @JavascriptInterface
    public void setOverlayEnabled(boolean enabled) {
        BackgroundMonitorService.setOverlayEnabled(webView.getContext(), enabled);
    }

    @JavascriptInterface
    public void requestOverlayPermission() {
        if (canDrawOverlays()) return;
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + webView.getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        webView.getContext().startActivity(intent);
    }

    @JavascriptInterface
    public boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < 23) return true;
        PowerManager pm = (PowerManager) webView.getContext().getSystemService(android.content.Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(webView.getContext().getPackageName());
    }

    @JavascriptInterface
    public void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < 23 || isIgnoringBatteryOptimizations()) return;
        Intent intent = new Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + webView.getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        webView.getContext().startActivity(intent);
    }

    @JavascriptInterface
    public void request(String requestId, String payload) {
        final long generation = requestGeneration;
        executor.execute(() -> {
            JSONObject result = new JSONObject();
            HttpURLConnection connection = null;
            try {
                JSONObject input = new JSONObject(payload);
                URL url = new URL(input.getString("url"));
                boolean gaugeRequest = BatteryProfile.isGaugeRoute(url);
                String method = input.optString("method", "GET").toUpperCase();
                String body = input.optString("body", "");
                // Pause read/login sequences without changing explicit management writes.
                boolean lifecycleRead = "GET".equals(method) || "HEAD".equals(method) || gaugeRequest
                    || ("&" + body + "&").contains("&goformId=LOGIN&");
                MonitorRouterClient.RequestAllowed allowed = () -> !lifecycleRead
                    || !"gauge88-csv".equals(BatteryProfile.mode()) || appForeground && generation == requestGeneration;
                String protocol = url.getProtocol();
                if (!"http".equals(protocol) && !"https".equals(protocol)) throw new SecurityException("只允许 HTTP/HTTPS");
                String host = url.getHost();
                if (!isLocalRouterHost(host)) throw new SecurityException("只允许访问局域网路由器地址");

                MonitorRouterClient.ensureRequestAllowed(allowed);
                connection = RouterNetwork.open(webView.getContext(), url);
                if (lifecycleRead && "gauge88-csv".equals(BatteryProfile.mode())) foregroundReads.add(connection);
                connection.setRequestMethod(method);
                int timeout = Math.min(Math.max(input.optInt("timeoutMs", 12000), 1000), 20000);
                connection.setConnectTimeout(timeout);
                connection.setReadTimeout(timeout);
                connection.setInstanceFollowRedirects(!gaugeRequest);
                connection.setUseCaches(false);
                connection.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01");
                connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
                connection.setRequestProperty("Origin", url.getProtocol() + "://" + url.getAuthority());
                connection.setRequestProperty("Referer", url.getProtocol() + "://" + url.getAuthority() + "/index.html");

                JSONObject headers = input.optJSONObject("headers");
                if (headers != null) {
                    JSONArray names = headers.names();
                    if (names != null) for (int index = 0; index < names.length(); index++) {
                        String name = names.getString(index);
                        if (!"Cookie".equalsIgnoreCase(name) && !"Origin".equalsIgnoreCase(name) && !"Referer".equalsIgnoreCase(name)) {
                            connection.setRequestProperty(name, headers.optString(name));
                        }
                    }
                }
                String sessionCookie = gaugeRequest ? "" : RouterSession.header();
                if (!sessionCookie.isEmpty()) connection.setRequestProperty("Cookie", sessionCookie);

                if (!body.isEmpty() && !"GET".equals(connection.getRequestMethod()) && !"HEAD".equals(connection.getRequestMethod())) {
                    connection.setDoOutput(true);
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    MonitorRouterClient.ensureRequestAllowed(allowed);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(bytes);
                    }
                }

                MonitorRouterClient.ensureRequestAllowed(allowed);
                int status = connection.getResponseCode();
                MonitorRouterClient.ensureRequestAllowed(allowed);
                if (!gaugeRequest) {
                    RouterSession.remember(connection.getHeaderFields());
                    shareSessionIfChanged();
                }
                JSONObject responseHeaders = new JSONObject();
                String gaugeAge = connection.getHeaderField("X-Gauge-Age");
                if (gaugeAge != null) responseHeaders.put("X-Gauge-Age", gaugeAge);
                result.put("headers", responseHeaders);
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String responseBody = gaugeRequest && stream != null
                    ? MonitorRouterClient.readBounded(stream, "/backup/battery-log.csv".equals(url.getPath()) ? BatteryCsv.MAX_BYTES : 256 * 1024,
                        System.nanoTime() + java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(timeout))
                    : readText(stream, connection.getContentType());
                MonitorRouterClient.ensureRequestAllowed(allowed);
                result.put("ok", status >= 200 && status < 300);
                result.put("status", status);
                result.put("body", responseBody);
                if (status < 200 || status >= 300) result.put("error", "路由器返回 HTTP " + status);
            } catch (Throwable error) {
                try {
                    result.put("ok", false);
                    result.put("status", 0);
                    result.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
                } catch (Exception ignored) {}
            } finally {
                if (connection != null) { connection.disconnect(); foregroundReads.remove(connection); }
            }
            deliver(requestId, result.toString());
        });
    }

    private void deliver(String requestId, String response) {
        String script = "window.__mu5120NativeResponse(" + JSONObject.quote(requestId) + "," + JSONObject.quote(response) + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    /** MainActivity.onDestroy 调用：释放路由器请求、异步历史线程池和本地反代。 */
    void shutdown() {
        setAppForeground(false);
        executor.shutdownNow();
        stockProxy.stop();
    }

    synchronized void setAppForeground(boolean foreground) {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        appForeground = foreground;
        if (!foreground) {
            requestGeneration++;
            for (HttpURLConnection connection : foregroundReads) connection.disconnect();
        }
    }

    private synchronized void shareSessionIfChanged() {
        String session = RouterSession.header();
        if (session.equals(lastSharedSession)) return;
        lastSharedSession = session;
        BackgroundMonitorService.acceptSession(webView.getContext(), session);
    }

    private static String readText(InputStream stream, String contentType) throws Exception {
        if (stream == null) return "";
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = stream.read(buffer)) >= 0) bytes.write(buffer, 0, count);
        Charset charset = StandardCharsets.UTF_8;
        if (contentType != null) {
            Matcher matcher = Pattern.compile("charset\\s*=\\s*([^;]+)", Pattern.CASE_INSENSITIVE).matcher(contentType);
            if (matcher.find()) {
                try { charset = Charset.forName(matcher.group(1).trim().replaceAll("[\\\"']", "")); }
                catch (Exception ignored) {}
            }
        }
        return new String(bytes.toByteArray(), charset).trim();
    }

    // 包内可见：MainActivity 放行原厂后台全屏直连时复用同一份局域网白名单。
    static boolean isLocalRouterHost(String host) {
        if (host == null) return false;
        if ("localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host)) return true;
        if (host.matches("^10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$")) return true;
        if (host.matches("^192\\.168\\.\\d{1,3}\\.\\d{1,3}$")) return true;
        if (host.matches("^172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}$")) return true;
        return host.endsWith(".local");
    }
}
