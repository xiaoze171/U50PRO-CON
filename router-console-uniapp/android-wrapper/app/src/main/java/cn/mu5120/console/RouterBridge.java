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
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
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
    public void clearSession() {
        synchronized (cookies) {
            cookies.clear();
        }
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

    @JavascriptInterface
    public void database(String requestId, String payload) {
        executor.execute(() -> {
            JSONObject result = new JSONObject();
            try {
                JSONObject input = new JSONObject(payload);
                JSONObject database = input.getJSONObject("database");
                String operation = input.getString("operation");
                JSONObject data = input.optJSONObject("data");
                if (data == null) data = new JSONObject();
                try (Connection connection = openDatabase(database)) {
                    JSONObject response = databaseOperation(connection, operation, data);
                    result.put("ok", true);
                    result.put("data", response);
                }
            } catch (Throwable error) {
                try {
                    result.put("ok", false);
                    result.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
                } catch (Exception ignored) {}
            }
            deliverDatabase(requestId, result.toString());
        });
    }

    private void deliver(String requestId, String response) {
        String script = "window.__mu5120NativeResponse(" + JSONObject.quote(requestId) + "," + JSONObject.quote(response) + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void deliverDatabase(String requestId, String response) {
        String script = "window.__u50proNativeDatabaseResponse(" + JSONObject.quote(requestId) + "," + JSONObject.quote(response) + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private static Connection openDatabase(JSONObject config) throws Exception {
        String host = config.optString("host").trim();
        String database = config.optString("database").trim();
        String user = config.optString("user");
        String password = config.optString("password");
        int port = config.optInt("port", 3306);
        if (!host.matches("[A-Za-z0-9.-]{1,253}")) throw new IllegalArgumentException("数据库地址格式不正确");
        if (!database.matches("[A-Za-z0-9_]{1,64}")) throw new IllegalArgumentException("数据库名格式不正确");
        if (user.isEmpty()) throw new IllegalArgumentException("请输入数据库用户名");
        if (port < 1 || port > 65535) throw new IllegalArgumentException("数据库端口不正确");
        Class.forName("com.mysql.jdbc.Driver");
        String url = "jdbc:mysql://" + host + ":" + port + "/" + database
            + "?connectTimeout=10000&socketTimeout=15000&useSSL=false&allowPublicKeyRetrieval=true"
            + "&useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai";
        Connection connection = DriverManager.getConnection(url, user, password);
        ensureDatabaseSchema(connection);
        return connection;
    }

    private static void ensureDatabaseSchema(Connection connection) throws Exception {
        try (Statement statement = connection.createStatement()) {
            statement.executeUpdate("DROP TABLE IF EXISTS router_operation_logs");
            statement.executeUpdate("DROP TABLE IF EXISTS router_latest_state");
        }
        if (!hasColumn(connection, "router_profiles", "router_password")) {
            try (PreparedStatement statement = connection.prepareStatement(
                "ALTER TABLE router_profiles ADD COLUMN router_password TEXT NULL AFTER router_url")) {
                statement.executeUpdate();
            }
        }
        dropColumn(connection, "router_profiles", "last_imei");
        dropColumn(connection, "router_profiles", "last_iccid");
        dropColumn(connection, "router_profiles", "last_login_at");
        dropColumn(connection, "router_profiles", "router_password_cipher");
        dropColumn(connection, "router_profiles", "developer_password_cipher");
        ensureColumn(connection, "router_battery_history", "rate_per_hour", "DECIMAL(10,4) NULL AFTER temperature_c");
        ensureColumn(connection, "router_battery_history", "estimated_remaining_minutes", "INT NULL AFTER rate_per_hour");
        ensureColumn(connection, "router_battery_history", "charge_type", "VARCHAR(64) NULL AFTER estimated_remaining_minutes");
        ensureColumn(connection, "router_battery_history", "external_power", "TINYINT(1) NOT NULL DEFAULT 0 AFTER charge_type");
        ensureColumn(connection, "router_battery_history", "battery_voltage", "VARCHAR(64) NULL AFTER external_power");
        ensureColumn(connection, "router_battery_history", "battery_current", "VARCHAR(64) NULL AFTER battery_voltage");
        ensureColumn(connection, "router_battery_history", "battery_capacity", "VARCHAR(64) NULL AFTER battery_current");
        ensureColumn(connection, "router_battery_history", "battery_health", "VARCHAR(64) NULL AFTER battery_capacity");
    }

    private static void ensureColumn(Connection connection, String table, String column, String definition) throws Exception {
        if (hasColumn(connection, table, column)) return;
        try (Statement statement = connection.createStatement()) {
            statement.executeUpdate("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
        }
    }

    private static void dropColumn(Connection connection, String table, String column) throws Exception {
        if (!hasColumn(connection, table, column)) return;
        try (Statement statement = connection.createStatement()) {
            statement.executeUpdate("ALTER TABLE " + table + " DROP COLUMN " + column);
        }
    }

    private static boolean hasColumn(Connection connection, String table, String column) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?")) {
            statement.setString(1, table);
            statement.setString(2, column);
            try (ResultSet rows = statement.executeQuery()) {
                rows.next();
                return rows.getInt(1) > 0;
            }
        }
    }

    private static JSONObject databaseOperation(Connection connection, String operation, JSONObject data) throws Exception {
        if ("test".equals(operation)) {
            try (PreparedStatement statement = connection.prepareStatement("SELECT 1"); ResultSet rows = statement.executeQuery()) {
                rows.next();
            }
            return new JSONObject().put("message", "MySQL 连接成功");
        }

        String profileKey = data.optString("profileKey", "default").trim();
        if (!profileKey.matches("[A-Za-z0-9_.-]{1,64}")) throw new IllegalArgumentException("共享配置标识格式不正确");
        if ("pullProfile".equals(operation)) {
            try (PreparedStatement statement = connection.prepareStatement(
                "SELECT router_url, router_password FROM router_profiles WHERE profile_key = ? LIMIT 1")) {
                statement.setString(1, profileKey);
                try (ResultSet rows = statement.executeQuery()) {
                    if (!rows.next()) return new JSONObject().put("found", false);
                    return new JSONObject()
                        .put("found", true)
                        .put("routerUrl", rows.getString("router_url"))
                        .put("password", rows.getString("router_password"));
                }
            }
        }
        if ("pushProfile".equals(operation)) {
            String routerUrl = data.optString("routerUrl").trim();
            String password = data.optString("password");
            if (routerUrl.isEmpty() || password.isEmpty()) throw new IllegalArgumentException("路由器地址和密码不能为空");
            try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO router_profiles (profile_key, display_name, router_url, router_password, last_seen_at) " +
                "VALUES (?, 'U50 Pro', ?, ?, CURRENT_TIMESTAMP(3)) " +
                "ON DUPLICATE KEY UPDATE router_url = VALUES(router_url), router_password = VALUES(router_password), " +
                "last_seen_at = VALUES(last_seen_at), revision = revision + 1")) {
                statement.setString(1, profileKey);
                statement.setString(2, routerUrl);
                statement.setString(3, password);
                statement.executeUpdate();
            }
            return new JSONObject().put("message", "配置已同步到 MySQL");
        }
        if ("syncBatteryHistory".equals(operation)) {
            long profileId = ensureProfile(connection, profileKey, data.optString("routerUrl", "http://192.168.0.1"));
            JSONArray samples = data.optJSONArray("samples");
            int inserted = insertBatterySamples(connection, profileId, samples == null ? new JSONArray() : samples);
            JSONArray history = readBatteryHistory(connection, profileId);
            return new JSONObject()
                .put("message", "电池续航数据已同步")
                .put("inserted", inserted)
                .put("samples", history);
        }
        throw new IllegalArgumentException("不支持的数据库操作");
    }

    private static long ensureProfile(Connection connection, String profileKey, String routerUrl) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(
            "INSERT INTO router_profiles (profile_key, display_name, router_url, last_seen_at) " +
            "VALUES (?, 'U50 Pro', ?, CURRENT_TIMESTAMP(3)) " +
            "ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)")) {
            statement.setString(1, profileKey);
            statement.setString(2, routerUrl == null || routerUrl.trim().isEmpty() ? "http://192.168.0.1" : routerUrl.trim());
            statement.executeUpdate();
        }
        try (PreparedStatement statement = connection.prepareStatement(
            "SELECT id FROM router_profiles WHERE profile_key = ? LIMIT 1")) {
            statement.setString(1, profileKey);
            try (ResultSet rows = statement.executeQuery()) {
                if (!rows.next()) throw new IllegalStateException("无法创建共享设备配置");
                return rows.getLong(1);
            }
        }
    }

    private static int insertBatterySamples(Connection connection, long profileId, JSONArray samples) throws Exception {
        if (samples.length() == 0) return 0;
        boolean autoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);
        int inserted = 0;
        String sql = "INSERT INTO router_battery_history " +
            "(profile_id, sample_time, battery_percent, is_charging, temperature_c, rate_per_hour, " +
            "estimated_remaining_minutes, charge_type, external_power, battery_voltage, battery_current, battery_capacity, battery_health) " +
            "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM DUAL " +
            "WHERE NOT EXISTS (SELECT 1 FROM router_battery_history WHERE profile_id = ? AND sample_time = ?)";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < samples.length(); index++) {
                JSONObject sample = samples.optJSONObject(index);
                if (sample == null || !sample.has("timestamp") || !sample.has("percent")) continue;
                Timestamp sampleTime = new Timestamp(sample.optLong("timestamp"));
                statement.setLong(1, profileId);
                statement.setTimestamp(2, sampleTime);
                statement.setDouble(3, sample.optDouble("percent"));
                statement.setBoolean(4, sample.optBoolean("charging"));
                setNullableDouble(statement, 5, sample, "temperature");
                setNullableDouble(statement, 6, sample, "ratePerHour");
                if (sample.isNull("remainingMinutes") || !sample.has("remainingMinutes")) statement.setNull(7, Types.INTEGER);
                else statement.setInt(7, sample.optInt("remainingMinutes"));
                setNullableString(statement, 8, sample, "chargeType");
                statement.setBoolean(9, sample.optBoolean("externalPower"));
                setNullableString(statement, 10, sample, "voltage");
                setNullableString(statement, 11, sample, "current");
                setNullableString(statement, 12, sample, "capacity");
                setNullableString(statement, 13, sample, "health");
                statement.setLong(14, profileId);
                statement.setTimestamp(15, sampleTime);
                statement.addBatch();
            }
            for (int count : statement.executeBatch()) if (count > 0) inserted += count;
            connection.commit();
            return inserted;
        } catch (Exception error) {
            connection.rollback();
            throw error;
        } finally {
            connection.setAutoCommit(autoCommit);
        }
    }

    private static JSONArray readBatteryHistory(Connection connection, long profileId) throws Exception {
        JSONArray output = new JSONArray();
        try (PreparedStatement statement = connection.prepareStatement(
            "SELECT sample_time, battery_percent, is_charging, temperature_c, rate_per_hour, " +
            "estimated_remaining_minutes, charge_type, external_power, battery_voltage, battery_current, battery_capacity, battery_health " +
            "FROM router_battery_history WHERE profile_id = ? AND sample_time >= DATE_SUB(NOW(3), INTERVAL 30 DAY) " +
            "ORDER BY sample_time DESC LIMIT 2000")) {
            statement.setLong(1, profileId);
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    JSONObject sample = new JSONObject()
                        .put("timestamp", rows.getTimestamp("sample_time").getTime())
                        .put("percent", rows.getDouble("battery_percent"))
                        .put("charging", rows.getBoolean("is_charging"))
                        .put("externalPower", rows.getBoolean("external_power"));
                    putNullable(sample, "temperature", rows.getObject("temperature_c"));
                    putNullable(sample, "ratePerHour", rows.getObject("rate_per_hour"));
                    putNullable(sample, "remainingMinutes", rows.getObject("estimated_remaining_minutes"));
                    putNullable(sample, "chargeType", rows.getString("charge_type"));
                    putNullable(sample, "voltage", rows.getString("battery_voltage"));
                    putNullable(sample, "current", rows.getString("battery_current"));
                    putNullable(sample, "capacity", rows.getString("battery_capacity"));
                    putNullable(sample, "health", rows.getString("battery_health"));
                    output.put(sample);
                }
            }
        }
        JSONArray chronological = new JSONArray();
        for (int index = output.length() - 1; index >= 0; index--) chronological.put(output.get(index));
        return chronological;
    }

    private static void setNullableDouble(PreparedStatement statement, int index, JSONObject value, String key) throws Exception {
        if (!value.has(key) || value.isNull(key)) statement.setNull(index, Types.DECIMAL);
        else statement.setDouble(index, value.optDouble(key));
    }

    private static void setNullableString(PreparedStatement statement, int index, JSONObject value, String key) throws Exception {
        String item = value.optString(key, "");
        if (item.isEmpty()) statement.setNull(index, Types.VARCHAR);
        else statement.setString(index, item);
    }

    private static void putNullable(JSONObject output, String key, Object value) throws Exception {
        output.put(key, value == null ? JSONObject.NULL : value);
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
