package cn.mu5120.console;

import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class RouterBridge {
    private static final String SYNC_PREFS = "u50pro_sync";
    private static final String KEY_DEVICE_ID = "device_id";

    private final WebView webView;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final StockProxyServer stockProxy = new StockProxyServer();
    private String lastSharedSession = "";
    // 最近一次 H5 configureBackground 传来的路由器地址，供 StockProxyServer
    // （原厂后台本地反代）转发使用。
    private static volatile String routerBaseUrl = "http://192.168.0.1";

    // —— 局域网同步状态（主进程内，与 RouterBridge 同生命周期；镜像 Electron 主进程模型）——
    private SyncServer syncServer;
    private DiscoveryBeacon discovery;
    private boolean syncEnabled = false;
    private boolean syncStarted = false;
    private String syncPassword = "";
    private String syncRole = "auto";
    private boolean syncCollecting = false;
    private String deviceId = "";
    private String deviceName = "";
    private String appVersion = "";

    RouterBridge(WebView webView) {
        this.webView = webView;
        stockProxy.start();
    }

    // 原厂后台本地反代端口（127.0.0.1），0 表示未启动（H5 会退回全屏直连）。
    @JavascriptInterface
    public int getStockProxyPort() {
        return stockProxy.getPort();
    }

    void shutdownStockProxy() {
        stockProxy.stop();
    }

    @JavascriptInterface
    public void clearSession() {
        RouterSession.clear();
        synchronized (this) { lastSharedSession = ""; }
        BackgroundMonitorService.clearSession(webView.getContext());
    }

    @JavascriptInterface
    public void configureBackground(String routerUrl, String password) {
        BackgroundMonitorService.configure(webView.getContext(), routerUrl, password);
        if (routerUrl != null && !routerUrl.trim().isEmpty()) routerBaseUrl = routerUrl.trim();
        // 路由器密码是唯一的密钥来源：在此派生同步令牌 sha256(密码)，供服务端鉴权与信标 tokenFP。
        synchronized (this) {
            syncPassword = password == null ? "" : password;
            applySyncState();
        }
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
    public void getBackgroundHistory(final String requestId) {
        executor.execute(() -> {
            String history = BackgroundMonitorService.readMonitorHistory(webView.getContext());
            String script = "window.__mu5120HistoryResponse(" + JSONObject.quote(requestId) + "," + JSONObject.quote(history) + ")";
            webView.post(() -> webView.evaluateJavascript(script, null));
        });
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
        executor.execute(() -> {
            JSONObject result = new JSONObject();
            HttpURLConnection connection = null;
            try {
                JSONObject input = new JSONObject(payload);
                URL url = new URL(input.getString("url"));
                String protocol = url.getProtocol();
                if (!"http".equals(protocol) && !"https".equals(protocol)) throw new SecurityException("只允许 HTTP/HTTPS");
                String host = url.getHost();
                if (!isLocalRouterHost(host)) throw new SecurityException("只允许访问局域网路由器地址");

                connection = RouterNetwork.open(webView.getContext(), url);
                connection.setRequestMethod(input.optString("method", "GET").toUpperCase());
                int timeout = Math.min(Math.max(input.optInt("timeoutMs", 12000), 1000), 20000);
                connection.setConnectTimeout(timeout);
                connection.setReadTimeout(timeout);
                connection.setInstanceFollowRedirects(true);
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
                String sessionCookie = RouterSession.header();
                if (!sessionCookie.isEmpty()) connection.setRequestProperty("Cookie", sessionCookie);

                String body = input.optString("body", "");
                if (!body.isEmpty() && !"GET".equals(connection.getRequestMethod()) && !"HEAD".equals(connection.getRequestMethod())) {
                    connection.setDoOutput(true);
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(bytes);
                    }
                }

                int status = connection.getResponseCode();
                RouterSession.remember(connection.getHeaderFields());
                shareSessionIfChanged();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String responseBody = readText(stream, connection.getContentType());
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
                if (connection != null) connection.disconnect();
            }
            deliver(requestId, result.toString());
        });
    }

    private void deliver(String requestId, String response) {
        String script = "window.__mu5120NativeResponse(" + JSONObject.quote(requestId) + "," + JSONObject.quote(response) + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    // ===== 局域网同步桥（方法面与桌面 window.DesktopRouter 完全对齐）===== //

    @JavascriptInterface
    public String syncGetSelf() {
        ensureIdentity();
        JSONObject self = new JSONObject();
        try {
            self.put("id", deviceId);
            self.put("name", deviceName);
            self.put("platform", "android");
            self.put("version", appVersion);
            self.put("httpPort", SyncServer.SYNC_HTTP_PORT);
            self.put("tokenFP", syncServer != null ? syncServer.tokenFingerprint() : "");
            self.put("enabled", syncEnabled);
        } catch (Exception ignored) {}
        return self.toString();
    }

    @JavascriptInterface
    public String syncGetPeers() {
        DiscoveryBeacon beacon = discovery;
        return beacon != null ? beacon.getPeers().toString() : "[]";
    }

    @JavascriptInterface
    public String syncDrainInbound() {
        SyncServer server = syncServer;
        return server != null ? server.drainInbound().toString() : "[]";
    }

    @JavascriptInterface
    public void syncSetEnabled(boolean enabled) {
        synchronized (this) {
            syncEnabled = enabled;
            applySyncState();
        }
    }

    @JavascriptInterface
    public void syncSetAdvertise(String role, boolean collecting) {
        synchronized (this) {
            syncRole = role == null || role.isEmpty() ? "auto" : role;
            syncCollecting = collecting;
            pushSelfToServer();
            updateBeacon();
        }
    }

    @JavascriptInterface
    public void syncPublish(String json) {
        SyncServer server = syncServer;
        if (server != null) server.publish(json);
    }

    @JavascriptInterface
    public void syncFetch(String requestId, String payload) {
        executor.execute(() -> {
            JSONObject result;
            SyncServer server = syncServer;
            if (server == null) {
                result = new JSONObject();
                try { result.put("ok", false); result.put("status", 0); result.put("error", "同步未启用"); } catch (Exception ignored) {}
            } else {
                try { result = server.fetchPeer(new JSONObject(payload)); }
                catch (Exception error) {
                    result = new JSONObject();
                    try { result.put("ok", false); result.put("status", 0); result.put("error", "请求参数异常"); } catch (Exception ignored) {}
                }
            }
            deliverSync(requestId, result.toString());
        });
    }

    private void deliverSync(String requestId, String response) {
        String script = "window.__mu5120SyncResponse(" + JSONObject.quote(requestId) + "," + JSONObject.quote(response) + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    /** MainActivity.onDestroy 调用：停掉同步服务与发现，释放线程池。 */
    void shutdownSync() {
        synchronized (this) {
            if (syncServer != null) { syncServer.stop(); syncServer = null; }
            if (discovery != null) { discovery.stop(); discovery = null; }
            syncStarted = false;
        }
        executor.shutdownNow();
    }

    // 生成/读取稳定设备身份：UUID 存主进程 SharedPreferences，名称取 Build.MODEL。
    private synchronized void ensureIdentity() {
        if (!deviceId.isEmpty()) return;
        Context context = webView.getContext().getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(SYNC_PREFS, Context.MODE_PRIVATE);
        String id = prefs.getString(KEY_DEVICE_ID, "");
        if (id == null || id.isEmpty()) {
            id = UUID.randomUUID().toString();
            prefs.edit().putString(KEY_DEVICE_ID, id).apply();
        }
        deviceId = id;
        deviceName = Build.MODEL != null && !Build.MODEL.isEmpty() ? Build.MODEL : "Android";
        try {
            String version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
            appVersion = version != null ? version : "";
        } catch (Exception ignored) {
            appVersion = "";
        }
    }

    // 依据 (启用 && 有密码) 启停服务与发现；令牌/身份/信标随时刷新。空闲时静默退回直连。
    private synchronized void applySyncState() {
        ensureIdentity();
        boolean shouldRun = syncEnabled && !syncPassword.isEmpty();
        if (shouldRun) {
            if (syncServer == null) syncServer = new SyncServer();
            if (discovery == null) discovery = new DiscoveryBeacon(webView.getContext());
            syncServer.setToken(syncPassword);
            pushSelfToServer();
            updateBeacon();
            if (!syncStarted) {
                syncServer.start();
                discovery.start();
                syncStarted = true;
            }
        } else if (syncStarted) {
            if (syncServer != null) syncServer.stop();
            if (discovery != null) discovery.stop();
            syncStarted = false;
        }
    }

    private void pushSelfToServer() {
        SyncServer server = syncServer;
        if (server == null) return;
        try {
            JSONObject self = new JSONObject();
            self.put("id", deviceId);
            self.put("name", deviceName);
            self.put("platform", "android");
            self.put("version", appVersion);
            self.put("role", syncRole);
            self.put("collecting", syncCollecting);
            server.setSelf(self);
        } catch (Exception ignored) {}
    }

    private void updateBeacon() {
        DiscoveryBeacon beacon = discovery;
        if (beacon == null) return;
        try {
            JSONObject fields = new JSONObject();
            fields.put("id", deviceId);
            fields.put("name", deviceName);
            fields.put("platform", "android");
            fields.put("httpPort", SyncServer.SYNC_HTTP_PORT);
            fields.put("role", syncRole);
            fields.put("collecting", syncCollecting);
            fields.put("tokenFP", syncServer != null ? syncServer.tokenFingerprint() : "");
            beacon.setBeacon(fields);
        } catch (Exception ignored) {}
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
