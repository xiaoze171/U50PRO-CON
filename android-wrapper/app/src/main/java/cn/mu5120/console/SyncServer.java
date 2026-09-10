package cn.mu5120.console;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 局域网同步 HTTP 服务（安卓端）。定位：哑管道 + 缓存 —— 只负责鉴权、按分钟桶切片返回
 * 前端 publish 进来的 store、把别人 POST 来的片段排队等前端来取合并。
 * 与桌面 desktop/sync-server.js 行为一一对应；所有“合并/角色/归一”都在共享 JS。
 */
final class SyncServer {
    static final int SYNC_HTTP_PORT = 51200;
    static final String APP_TAG = "u50pro-sync";
    static final int PROTOCOL_VERSION = 1;
    private static final int MAX_BODY = 4 * 1024 * 1024; // 单次 POST 上限 4MB
    private static final int MAX_INBOUND = 64;           // 待前端消费的入站队列上限
    private static final String[] CHART_KEYS = { "rsrp", "sinr", "rsrq", "down", "up" };

    private final Object lock = new Object();
    private ServerSocket serverSocket;
    private ExecutorService executor;
    private volatile Thread acceptThread;

    private volatile String token = "";            // sha256(路由器密码) 十六进制大写；空表示未启用
    private JSONObject self = new JSONObject();     // 本机身份 {id,name,platform,role,collecting,version}
    private JSONObject publishedLive = null;
    private JSONObject publishedChart = emptyChart();
    private JSONArray publishedBattery = new JSONArray();
    private final List<JSONObject> inboundQueue = new ArrayList<>();

    static JSONObject emptyChart() {
        JSONObject chart = new JSONObject();
        try {
            for (String key : CHART_KEYS) chart.put(key, new JSONArray());
            chart.put("temperatures", new JSONObject());
        } catch (Exception ignored) {}
        return chart;
    }

    static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder();
            for (byte item : digest) output.append(String.format(Locale.US, "%02X", item));
            return output.toString();
        } catch (Exception error) {
            return "";
        }
    }

    void setToken(String password) {
        token = password != null && !password.isEmpty() ? sha256Hex(password) : "";
    }

    String tokenFingerprint() {
        return token.isEmpty() ? "" : token.substring(0, 8);
    }

    void setSelf(JSONObject next) {
        if (next == null) return;
        synchronized (lock) {
            JSONArray names = next.names();
            if (names == null) return;
            for (int index = 0; index < names.length(); index++) {
                String name = names.optString(index);
                try { self.put(name, next.get(name)); } catch (Exception ignored) {}
            }
        }
    }

    void publish(String json) {
        if (json == null || json.isEmpty()) return;
        try {
            JSONObject store = new JSONObject(json);
            synchronized (lock) {
                if (store.has("live")) publishedLive = store.isNull("live") ? null : store.optJSONObject("live");
                JSONObject chart = store.optJSONObject("chart");
                if (chart != null) publishedChart = chart;
                JSONArray battery = store.optJSONArray("battery");
                if (battery != null) publishedBattery = battery;
            }
        } catch (Exception ignored) {}
    }

    /** 取走并清空入站队列（前端来合并后再 publish 回来）。 */
    JSONArray drainInbound() {
        JSONArray output = new JSONArray();
        synchronized (lock) {
            for (JSONObject item : inboundQueue) output.put(item);
            inboundQueue.clear();
        }
        return output;
    }

    void start() {
        synchronized (lock) {
            if (serverSocket != null) return;
            try {
                ServerSocket socket = new ServerSocket();
                socket.setReuseAddress(true);
                socket.bind(new InetSocketAddress((java.net.InetAddress) null, SYNC_HTTP_PORT));
                serverSocket = socket;
                executor = Executors.newFixedThreadPool(4);
            } catch (IOException error) {
                // 端口占用等：静默失败，前端会退回直连。
                serverSocket = null;
                return;
            }
            Thread thread = new Thread(this::acceptLoop, "u50-sync-accept");
            thread.setDaemon(true);
            acceptThread = thread;
            thread.start();
        }
    }

    void stop() {
        ServerSocket socket;
        ExecutorService pool;
        synchronized (lock) {
            socket = serverSocket;
            pool = executor;
            serverSocket = null;
            executor = null;
            acceptThread = null;
        }
        if (socket != null) { try { socket.close(); } catch (Exception ignored) {} }
        if (pool != null) pool.shutdownNow();
    }

    private void acceptLoop() {
        ServerSocket socket = serverSocket;
        while (socket != null && !socket.isClosed()) {
            try {
                Socket client = socket.accept();
                ExecutorService pool = executor;
                if (pool != null) pool.execute(() -> handle(client));
                else { try { client.close(); } catch (Exception ignored) {} }
            } catch (IOException error) {
                break; // socket 关闭：退出循环
            }
            socket = serverSocket;
        }
    }

    private void handle(Socket client) {
        try {
            client.setSoTimeout(8000);
            InputStream input = client.getInputStream();
            OutputStream output = client.getOutputStream();

            String requestLine = readLine(input);
            if (requestLine == null || requestLine.isEmpty()) { client.close(); return; }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) { respond(output, 400, err("bad request")); client.close(); return; }
            String method = parts[0].toUpperCase(Locale.US);
            String target = parts[1];

            Map<String, String> headers = new HashMap<>();
            String headerLine;
            while ((headerLine = readLine(input)) != null && !headerLine.isEmpty()) {
                int separator = headerLine.indexOf(':');
                if (separator > 0) {
                    headers.put(headerLine.substring(0, separator).trim().toLowerCase(Locale.US),
                        headerLine.substring(separator + 1).trim());
                }
            }

            String path = target;
            String query = "";
            int q = target.indexOf('?');
            if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }

            if (!path.startsWith("/sync/")) { respond(output, 404, err("not found")); client.close(); return; }
            if (!authorized(headers)) { respond(output, 403, err("invalid token")); client.close(); return; }

            if ("GET".equals(method) && "/sync/hello".equals(path)) {
                respond(output, 200, helloBody());
            } else if ("GET".equals(method) && "/sync/live".equals(path)) {
                JSONObject body = new JSONObject();
                synchronized (lock) { body.put("live", publishedLive == null ? JSONObject.NULL : publishedLive); }
                body.put("time", System.currentTimeMillis());
                respond(output, 200, body);
            } else if ("GET".equals(method) && "/sync/history".equals(path)) {
                long since = parseSince(query);
                JSONObject body = sliceSince(since);
                body.put("since", since > 0 ? since : 0);
                body.put("now", System.currentTimeMillis());
                respond(output, 200, body);
            } else if ("POST".equals(method) && "/sync/history".equals(path)) {
                int contentLength = 0;
                try { contentLength = Integer.parseInt(headers.getOrDefault("content-length", "0")); } catch (Exception ignored) {}
                if (contentLength < 0 || contentLength > MAX_BODY) { respond(output, 413, err("too large")); client.close(); return; }
                byte[] bodyBytes = readBody(input, contentLength);
                try {
                    JSONObject parsed = new JSONObject(new String(bodyBytes, StandardCharsets.UTF_8));
                    JSONObject item = new JSONObject();
                    JSONObject chart = parsed.optJSONObject("chart");
                    item.put("chart", chart != null ? chart : emptyChart());
                    JSONArray battery = parsed.optJSONArray("battery");
                    item.put("battery", battery != null ? battery : new JSONArray());
                    item.put("from", parsed.optString("from", ""));
                    item.put("at", System.currentTimeMillis());
                    synchronized (lock) {
                        inboundQueue.add(item);
                        while (inboundQueue.size() > MAX_INBOUND) inboundQueue.remove(0);
                    }
                    JSONObject ok = new JSONObject();
                    ok.put("ok", true);
                    respond(output, 200, ok);
                } catch (Exception parseError) {
                    respond(output, 400, err("bad json"));
                }
            } else {
                respond(output, 404, err("not found"));
            }
            client.close();
        } catch (Exception error) {
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    private boolean authorized(Map<String, String> headers) {
        if (token.isEmpty()) return false;
        String provided = headers.get("x-sync-token");
        return provided != null && provided.toUpperCase(Locale.US).equals(token);
    }

    private JSONObject helloBody() {
        JSONObject body = new JSONObject();
        try {
            synchronized (lock) {
                body.put("app", APP_TAG);
                body.put("v", PROTOCOL_VERSION);
                body.put("id", self.optString("id", ""));
                body.put("name", self.optString("name", ""));
                body.put("platform", self.optString("platform", "android"));
                body.put("role", self.optString("role", "auto"));
                body.put("collecting", self.optBoolean("collecting", false));
                body.put("version", self.optString("version", ""));
            }
            body.put("tokenFP", tokenFingerprint());
            body.put("time", System.currentTimeMillis());
        } catch (Exception ignored) {}
        return body;
    }

    // 按 since 只返回新于该时间戳的分钟桶（增量），减少体积。
    private JSONObject sliceSince(long since) throws Exception {
        JSONObject result = new JSONObject();
        synchronized (lock) {
            if (since <= 0) {
                result.put("chart", publishedChart);
                result.put("battery", publishedBattery);
                return result;
            }
            JSONObject chart = emptyChart();
            for (String key : CHART_KEYS) chart.put(key, filterPoints(publishedChart.optJSONArray(key), since));
            JSONObject temps = new JSONObject();
            JSONObject sourceTemps = publishedChart.optJSONObject("temperatures");
            if (sourceTemps != null) {
                JSONArray names = sourceTemps.names();
                if (names != null) for (int index = 0; index < names.length(); index++) {
                    String name = names.optString(index);
                    JSONArray filtered = filterPoints(sourceTemps.optJSONArray(name), since);
                    if (filtered.length() > 0) temps.put(name, filtered);
                }
            }
            chart.put("temperatures", temps);
            result.put("chart", chart);

            JSONArray battery = new JSONArray();
            for (int index = 0; index < publishedBattery.length(); index++) {
                JSONObject sample = publishedBattery.optJSONObject(index);
                if (sample != null && sample.optLong("timestamp", 0) > since) battery.put(sample);
            }
            result.put("battery", battery);
        }
        return result;
    }

    private static JSONArray filterPoints(JSONArray source, long since) {
        JSONArray output = new JSONArray();
        if (source == null) return output;
        for (int index = 0; index < source.length(); index++) {
            JSONArray point = source.optJSONArray(index);
            if (point != null && point.optLong(0, 0) > since) output.put(point);
        }
        return output;
    }

    private static long parseSince(String query) {
        if (query == null || query.isEmpty()) return 0;
        for (String pair : query.split("&")) {
            int separator = pair.indexOf('=');
            if (separator > 0 && "since".equals(pair.substring(0, separator))) {
                try { return Long.parseLong(pair.substring(separator + 1)); } catch (Exception ignored) { return 0; }
            }
        }
        return 0;
    }

    // —— 向对等端发同步请求，自动注入 X-Sync-Token；永不抛出（返回 {ok,status,body,error}）——
    JSONObject fetchPeer(JSONObject options) {
        JSONObject result = new JSONObject();
        String host = options.optString("host", "");
        int port = options.optInt("port", SYNC_HTTP_PORT);
        String path = options.optString("path", "/");
        String method = options.optString("method", "GET").toUpperCase(Locale.US);
        String body = options.optString("body", "");
        HttpURLConnection connection = null;
        try {
            if (token.isEmpty()) return fetchError(result, "同步未启用");
            if (!isLan(host)) return fetchError(result, "仅允许局域网地址");
            URL url = new URL("http", host, port <= 0 ? SYNC_HTTP_PORT : port, path);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("X-Sync-Token", token);
            connection.setRequestProperty("Accept", "application/json");
            if (!body.isEmpty() && !"GET".equals(method) && !"HEAD".equals(method)) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream stream = connection.getOutputStream()) { stream.write(bytes); }
            }
            int status = connection.getResponseCode();
            boolean ok = status >= 200 && status < 300;
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String responseBody = readAll(stream);
            result.put("ok", ok);
            result.put("status", status);
            result.put("body", responseBody);
            if (!ok) result.put("error", "HTTP " + status);
        } catch (Throwable error) {
            try {
                result.put("ok", false);
                result.put("status", 0);
                result.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            } catch (Exception ignored) {}
        } finally {
            if (connection != null) connection.disconnect();
        }
        return result;
    }

    private static JSONObject fetchError(JSONObject result, String message) {
        try { result.put("ok", false); result.put("status", 0); result.put("error", message); } catch (Exception ignored) {}
        return result;
    }

    static boolean isLan(String host) {
        if (host == null || host.isEmpty()) return false;
        if ("localhost".equals(host) || "127.0.0.1".equals(host)) return true;
        if (host.matches("^10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$")) return true;
        if (host.matches("^192\\.168\\.\\d{1,3}\\.\\d{1,3}$")) return true;
        if (host.matches("^172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}$")) return true;
        return host.endsWith(".local");
    }

    // —— HTTP I/O 小工具 —— //

    private static String readLine(InputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int value;
        boolean any = false;
        while ((value = input.read()) != -1) {
            any = true;
            if (value == '\n') break;
            if (value != '\r') buffer.write(value);
        }
        if (!any && buffer.size() == 0) return null;
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }

    private static byte[] readBody(InputStream input, int contentLength) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int remaining = contentLength;
        while (remaining > 0) {
            int count = input.read(chunk, 0, Math.min(chunk.length, remaining));
            if (count < 0) break;
            buffer.write(chunk, 0, count);
            remaining -= count;
        }
        return buffer.toByteArray();
    }

    private static String readAll(InputStream stream) throws IOException {
        if (stream == null) return "";
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int count;
        while ((count = stream.read(chunk)) >= 0) buffer.write(chunk, 0, count);
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }

    private static JSONObject err(String message) {
        JSONObject object = new JSONObject();
        try { object.put("error", message); } catch (Exception ignored) {}
        return object;
    }

    private static void respond(OutputStream output, int status, JSONObject payload) throws IOException {
        byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append(' ').append(statusText(status)).append("\r\n");
        head.append("Content-Type: application/json; charset=utf-8\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Connection: close\r\n\r\n");
        output.write(head.toString().getBytes(StandardCharsets.UTF_8));
        output.write(body);
        output.flush();
    }

    private static String statusText(int status) {
        switch (status) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 413: return "Payload Too Large";
            default: return "OK";
        }
    }
}
