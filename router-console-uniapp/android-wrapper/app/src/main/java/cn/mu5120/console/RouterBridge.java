package cn.mu5120.console;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class RouterBridge {
    private final WebView webView;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final Map<String, String> cookies = new HashMap<>();

    RouterBridge(WebView webView) {
        this.webView = webView;
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
                synchronized (cookies) {
                    if (!cookies.isEmpty()) {
                        StringBuilder value = new StringBuilder();
                        for (Map.Entry<String, String> item : cookies.entrySet()) {
                            if (value.length() > 0) value.append("; ");
                            value.append(item.getKey()).append('=').append(item.getValue());
                        }
                        connection.setRequestProperty("Cookie", value.toString());
                    }
                }

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
                rememberCookies(connection.getHeaderFields());
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String responseBody = readText(stream);
                result.put("ok", status >= 200 && status < 300);
                result.put("status", status);
                result.put("body", responseBody);
                if (status < 200 || status >= 300) result.put("error", "路由器返回 HTTP " + status);
            } catch (Exception error) {
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

    private void rememberCookies(Map<String, List<String>> headers) {
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (entry.getKey() == null || !"Set-Cookie".equalsIgnoreCase(entry.getKey())) continue;
            for (String raw : entry.getValue()) {
                String first = raw.split(";", 2)[0];
                int separator = first.indexOf('=');
                if (separator > 0) synchronized (cookies) {
                    cookies.put(first.substring(0, separator), first.substring(separator + 1));
                }
            }
        }
    }

    private static String readText(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) output.append(line).append('\n');
        }
        return output.toString().trim();
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
