package cn.mu5120.console;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class RouterBridge {
    private final WebView webView;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private String lastSharedSession = "";
    RouterBridge(WebView webView) {
        this.webView = webView;
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
    }

    @JavascriptInterface
    public String getBackgroundBatteryHistory() {
        return BackgroundMonitorService.readBatteryHistory(webView.getContext());
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

                connection = (HttpURLConnection) url.openConnection();
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

    private static boolean isLocalRouterHost(String host) {
        if (host == null) return false;
        if ("localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host)) return true;
        if (host.matches("^10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$")) return true;
        if (host.matches("^192\\.168\\.\\d{1,3}\\.\\d{1,3}$")) return true;
        if (host.matches("^172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}$")) return true;
        return host.endsWith(".local");
    }
}
