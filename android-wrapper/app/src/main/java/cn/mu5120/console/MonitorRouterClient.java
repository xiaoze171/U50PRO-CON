package cn.mu5120.console;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/** Complete read-only collection using the same field inventory as router-client.js. */
final class MonitorRouterClient {
    private static final ScheduledExecutorService DEADLINES = Executors.newScheduledThreadPool(2, task -> {
        Thread thread = new Thread(task, "battery-request-deadline"); thread.setDaemon(true); return thread;
    });
    private final Context context;
    private final JSONObject fields;
    private final BatteryGaugeConfig batteryConfig;
    private final BatteryCsvCache batteryCsvCache;
    private String routerUrl;
    private String password;

    MonitorRouterClient(Context context, String routerUrl, String password) throws Exception {
        this(context, routerUrl, password, new BatteryGaugeConfig("gauge", "", 88));
    }

    MonitorRouterClient(Context context, String routerUrl, String password, String source, String host, int port) throws Exception {
        this(context, routerUrl, password, new BatteryGaugeConfig(source, host, port));
    }

    MonitorRouterClient(Context context, String routerUrl, String password, BatteryGaugeConfig batteryConfig) throws Exception {
        this.context = context.getApplicationContext();
        this.routerUrl = routerUrl;
        this.password = password;
        this.batteryConfig = batteryConfig;
        this.batteryCsvCache = new BatteryCsvCache(this::readGaugeCsv);
        try (InputStream input = context.getAssets().open("router-fields.json")) {
            fields = new JSONObject(read(input));
        }
    }

    JSONObject dashboard() throws Exception {
        Future<BatteryCsvCache.Result> csvRequest = "gauge".equals(batteryConfig.source)
            ? batteryCsvCache.request(batteryConfig.csvEndpoint(routerUrl)) : null;
        JSONObject status = group("status");
        if (!"ok".equals(status.optString("loginfo"))) {
            login();
            status = group("status");
        }
        if (!"ok".equals(status.optString("loginfo"))) throw new Exception("路由器登录失败");
        JSONObject snapshot = new JSONObject().put("status", status);
        JSONObject errors = new JSONObject();
        for (String name : new String[] { "signal", "temperature", "resources", "locks", "neighbors", "features" }) {
            try { snapshot.put(name, group(name)); }
            catch (Exception error) { errors.put(name, message(error)); }
        }
        JSONObject clientAvailability = new JSONObject().put("stations", false).put("cableStations", false);
        try {
            JSONObject response = command("station_list");
            snapshot.put("stations", list(response, "station_list"));
            clientAvailability.put("stations", response.has("station_list"));
        }
        catch (Exception error) { errors.put("stations", message(error)); }
        try {
            JSONObject response = command("lan_station_list");
            snapshot.put("cableStations", list(response, response.has("lan_station_list") ? "lan_station_list" : "station_list"));
            clientAvailability.put("cableStations", response.has("lan_station_list") || response.has("station_list"));
        } catch (Exception error) { errors.put("cableStations", message(error)); }
        snapshot.put("clientAvailability", clientAvailability);
        // Fetch the live marker last so unrelated factory calls cannot age it before normalization.
        if (csvRequest != null) {
            BatteryCsvCache.Result csv;
            try { csv = csvRequest.get(3, TimeUnit.SECONDS); }
            catch (Exception error) { csv = new BatteryCsvCache.Result(null, message(error), error instanceof java.util.concurrent.TimeoutException ? "timeout" : "fetch-error"); }
            status.put("battery_gauge", gauge());
            JSONObject marker = status.optJSONObject("battery_gauge");
            JSONObject raw = marker == null ? null : marker.optJSONObject("raw");
            long calculatedAt = System.currentTimeMillis();
            JSONObject estimates = BatteryCsv.estimate(csv.csv, BatteryGaugeReading.normalizeBatteryMeasurement(status),
                raw == null ? null : BatteryGaugeReading.numeric(raw.opt("ts")), calculatedAt);
            JSONObject analysis = estimates.getJSONObject("csvAnalysis");
            analysis.put("source", "device-csv").put("endpoint", batteryConfig.csvEndpoint(routerUrl))
                .put("url", batteryConfig.csvEndpoint(routerUrl)).put("fetchedAt", csv.fetchedAt);
            if (!csv.error.isEmpty()) {
                analysis.put("state", "unavailable").put("reason", csv.reason).put("error", csv.error);
                for (String key : new String[] { "timeToFull", "runtime" }) {
                    JSONObject time = estimates.getJSONObject(key);
                    if ("unavailable".equals(time.optString("state"))) time.put("reason", "CSV日志获取失败");
                }
            }
            snapshot.put("battery", estimates);
        }
        snapshot.put("timestamp", System.currentTimeMillis());
        BatteryGaugeReading.refreshStatus(status, snapshot.getLong("timestamp"));
        snapshot.put("login", new JSONObject().put("loggedIn", true).put("message", "后台采集已连接"));
        if (errors.length() > 0) snapshot.put("errors", errors);
        return snapshot;
    }

    JSONObject sms() throws Exception {
        JSONObject ready = command("sms_cmd_status_info", "sms_cmd", "1");
        if (!"3".equals(ready.optString("sms_cmd_status_result"))) throw new Exception("短信模块暂未就绪");
        JSONObject response = command("sms_data_total", "page", "0", "data_per_page", "500", "mem_store", "1", "tags", "10", "order_by", "order by id desc");
        JSONArray messages = list(response, "messages");
        for (int index = 0; index < messages.length(); index++) {
            JSONObject item = messages.optJSONObject(index);
            if (item == null) continue;
            String raw = item.optString("content");
            item.put("rawContent", raw).put("content", decodeSms(raw));
        }
        return new JSONObject().put("timestamp", System.currentTimeMillis()).put("ready", ready)
            .put("messages", messages).put("capacity", command("sms_capacity_info"));
    }

    private JSONObject gauge() throws Exception {
        return fetchGaugeState(context, batteryConfig.endpoint(routerUrl));
    }

    static JSONObject fetchGaugeState(Context context, String endpoint) throws Exception {
        HttpURLConnection connection = null;
        ScheduledFuture<?> abort = null;
        AtomicBoolean timedOut = new AtomicBoolean();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        try {
            URL target = new URL(endpoint);
            if (!RouterBridge.isLocalRouterHost(target.getHost())) throw new SecurityException("只允许访问局域网路由器地址");
            connection = RouterNetwork.open(context, target);
            HttpURLConnection active = connection;
            abort = DEADLINES.schedule(() -> { timedOut.set(true); active.disconnect(); }, 3, TimeUnit.SECONDS);
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(2000);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/json");
            // Gauge requests never consume or update the factory session cookie jar.
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("Gauge HTTP " + code);
            String age = connection.getHeaderField("X-Gauge-Age");
            try (InputStream input = connection.getInputStream()) {
                return BatteryGaugeReading.read(new JSONObject(readBounded(input, 256 * 1024, deadline)), age, endpoint, System.currentTimeMillis());
            }
        } catch (Exception error) {
            return new JSONObject().put("percent", JSONObject.NULL).put("state", "unavailable")
                .put("url", endpoint).put("raw", JSONObject.NULL).put("error", timedOut.get() ? "Gauge state request timeout" : message(error));
        } finally { if (abort != null) abort.cancel(false); if (connection != null) connection.disconnect(); }
    }

    void invalidateBatteryCsv() { batteryCsvCache.invalidate(); }

    private String readGaugeCsv(String endpoint) throws Exception {
        return fetchGaugeCsv(context, endpoint);
    }

    static String fetchGaugeCsv(Context context, String endpoint) throws Exception {
        URL target = new URL(endpoint);
        if (!RouterBridge.isLocalRouterHost(target.getHost())) throw new SecurityException("只允许访问局域网路由器地址");
        HttpURLConnection connection = RouterNetwork.open(context, target);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        AtomicBoolean timedOut = new AtomicBoolean();
        ScheduledFuture<?> abort = DEADLINES.schedule(() -> { timedOut.set(true); connection.disconnect(); }, 3, TimeUnit.SECONDS);
        try {
            connection.setRequestMethod("GET"); connection.setConnectTimeout(2000); connection.setReadTimeout(2000);
            connection.setUseCaches(false); connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "text/csv");
            // Never read or write RouterSession, including Set-Cookie on error/redirect responses.
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("Gauge CSV HTTP " + code);
            int length = connection.getContentLength(); if (length > BatteryCsv.MAX_BYTES) throw new Exception("Battery CSV byte limit exceeded");
            try (InputStream input = connection.getInputStream()) { return readBounded(input, BatteryCsv.MAX_BYTES, deadline); }
        } catch (Exception error) {
            if (timedOut.get()) throw new java.net.SocketTimeoutException("Gauge CSV request timeout");
            throw error;
        } finally { abort.cancel(false); connection.disconnect(); }
    }

    static String readBounded(InputStream input, int limit, long deadline) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int length;
        while ((length = input.read(buffer)) != -1) {
            if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline) throw new java.net.SocketTimeoutException("Gauge request timeout");
            if (output.size() + length > limit) throw new Exception("Battery CSV byte limit exceeded");
            output.write(buffer, 0, length);
        }
        if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline) throw new java.net.SocketTimeoutException("Gauge request timeout");
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }

    private JSONObject group(String name) throws Exception {
        JSONArray names = fields.getJSONArray(name);
        StringBuilder command = new StringBuilder();
        for (int index = 0; index < names.length(); index++) {
            if (index > 0) command.append(',');
            command.append(names.getString(index));
        }
        return command(command.toString(), "multi_data", "1");
    }

    private JSONObject command(String command, String... parameters) throws Exception {
        String query = form("isTest", "false", "cmd", command, "_", String.valueOf(System.currentTimeMillis()));
        if (parameters.length > 0) query += "&" + form(parameters);
        return new JSONObject(request("/goform/goform_get_cmd_process?" + query, "GET", ""));
    }

    private void login() throws Exception {
        RouterSession.clear();
        request("/index.html", "GET", "");
        command("Language,cr_version,wa_inner_version", "multi_data", "1");
        JSONObject token = command("LD", "multi_data", "1");
        String hash = SyncServer.sha256Hex(SyncServer.sha256Hex(password) + token.optString("LD"));
        request("/goform/goform_set_cmd_process", "POST", form("isTest", "false", "goformId", "LOGIN", "password", hash));
    }

    private String request(String path, String method, String body) throws Exception {
        HttpURLConnection connection = RouterNetwork.open(context, new URL(routerUrl + path));
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01");
            connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            connection.setRequestProperty("Origin", routerUrl);
            connection.setRequestProperty("Referer", routerUrl + "/index.html");
            String cookie = RouterSession.header();
            if (!cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
            if (!body.isEmpty()) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            RouterSession.remember(connection.getHeaderFields());
            if (status < 200 || status >= 300) throw new Exception("路由器返回 HTTP " + status);
            try (InputStream input = connection.getInputStream()) { return read(input); }
        } finally { connection.disconnect(); }
    }

    private static JSONArray list(JSONObject response, String key) throws Exception {
        Object value = response.opt(key);
        if (value instanceof JSONArray) return (JSONArray) value;
        JSONArray list = new JSONArray();
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                Object item = object.opt(keys.next());
                if (item instanceof JSONObject) list.put(item);
            }
        }
        return list;
    }

    private static String decodeSms(String value) {
        if (!value.matches("(?i)[0-9a-f]+")) return value;
        StringBuilder output = new StringBuilder();
        for (int index = 0; index < value.length(); index += 4) {
            int code = Integer.parseInt(value.substring(index, Math.min(index + 4, value.length())), 16);
            if (code != 0 && code != 9) output.append((char) code);
        }
        return output.toString();
    }

    private static String form(String... values) throws Exception {
        StringBuilder output = new StringBuilder();
        for (int index = 0; index + 1 < values.length; index += 2) {
            if (output.length() > 0) output.append('&');
            output.append(URLEncoder.encode(values[index], "UTF-8")).append('=')
                .append(URLEncoder.encode(values[index + 1], "UTF-8"));
        }
        return output.toString();
    }

    private static String read(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int length;
        while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }

    static String message(Throwable error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }
}
