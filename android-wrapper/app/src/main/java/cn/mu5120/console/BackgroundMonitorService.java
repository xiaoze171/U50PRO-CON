package cn.mu5120.console;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.AlarmManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.graphics.BitmapFactory;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public final class BackgroundMonitorService extends Service {
    private static final String TAG = "U50ProMonitor";
    private static final String CHANNEL_ID = "u50pro_background_monitor";
    private static final int NOTIFICATION_ID = 5120;
    private static final String PREFS = "u50pro_background_monitor";
    private static final String KEY_URL = "routerUrl";
    private static final String KEY_PASSWORD = "password";
    private static final String KEY_FOREGROUND_UNTIL = "appForegroundUntil";
    private static final String KEY_OVERLAY_ENABLED = "overlayEnabled";
    private static final String ACTION_FOREGROUND = "cn.mu5120.console.monitor.FOREGROUND";
    private static final String ACTION_CONFIGURE = "cn.mu5120.console.monitor.CONFIGURE";
    private static final String ACTION_SNAPSHOT = "cn.mu5120.console.monitor.SNAPSHOT";
    private static final String ACTION_SESSION = "cn.mu5120.console.monitor.SESSION";
    private static final String ACTION_CLEAR_SESSION = "cn.mu5120.console.monitor.CLEAR_SESSION";
    private static final String ACTION_OVERLAY = "cn.mu5120.console.monitor.OVERLAY";
    static final String ACTION_POLL = "cn.mu5120.console.monitor.POLL";
    private static final long BATTERY_WINDOW_MS = 24L * 60L * 60L * 1000L;
    private static final int BATTERY_MAX_POINTS = 1445;
    private static final Object HISTORY_LOCK = new Object();
    private static volatile BackgroundMonitorService instance;

    private ScheduledExecutorService executor;
    private ScheduledFuture<?> fastPollTask;
    private AlarmManager alarmManager;
    private NotificationManager notificationManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private MonitorOverlay overlay;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private volatile boolean running;
    private volatile boolean appForeground = true;
    private String routerUrl = "http://192.168.0.1";
    private String password = "111111";
    private String lastSpeedDown = "0 B/s";
    private String lastSpeedUp = "0 B/s";
    private String lastBattery = "未知";
    private String lastTemperature = "未知";
    private String lastError = "";
    private volatile long lastSuccessAt;
    private boolean loggedIn;
    private boolean overlayEnabled;

    public static void start(Context context) {
        sendCommand(context, new Intent(context, BackgroundMonitorService.class));
    }

    public static void setAppForeground(Context context, boolean foreground) {
        long until = foreground ? System.currentTimeMillis() + 15000 : 0;
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong(KEY_FOREGROUND_UNTIL, until).commit();
        Intent intent = new Intent(context, BackgroundMonitorService.class)
            .setAction(ACTION_FOREGROUND)
            .putExtra("foreground", foreground);
        sendCommand(context, intent);
    }

    public static void configure(Context context, String routerUrl, String password) {
        String url = routerUrl == null || routerUrl.trim().isEmpty() ? "http://192.168.0.1" : routerUrl.trim().replaceAll("/+$", "");
        String nextPassword = password == null ? "" : password;
        android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean changed = !url.equals(preferences.getString(KEY_URL, "http://192.168.0.1"))
            || !nextPassword.equals(preferences.getString(KEY_PASSWORD, "111111"));
        preferences.edit()
            .putString(KEY_URL, url)
            .putString(KEY_PASSWORD, nextPassword)
            .apply();
        Intent intent = new Intent(context, BackgroundMonitorService.class)
            .setAction(ACTION_CONFIGURE)
            .putExtra(KEY_URL, url)
            .putExtra(KEY_PASSWORD, nextPassword)
            .putExtra("changed", changed);
        sendCommand(context, intent);
    }

    public static String readBatteryHistory(Context context) {
        try {
            File file = historyFile(context);
            if (!file.exists()) return "[]";
            JSONArray source = new JSONArray(new String(readFileBytes(file), StandardCharsets.UTF_8));
            JSONArray output = pruneHistory(source, System.currentTimeMillis());
            return output.toString();
        } catch (Exception ignored) {
            return "[]";
        }
    }

    public static void acceptSnapshot(Context context, String payload) {
        Intent intent = new Intent(context, BackgroundMonitorService.class)
            .setAction(ACTION_SNAPSHOT)
            .putExtra("payload", payload == null ? "{}" : payload);
        sendCommand(context, intent);
    }

    public static void acceptSession(Context context, String cookieHeader) {
        Intent intent = new Intent(context, BackgroundMonitorService.class)
            .setAction(ACTION_SESSION)
            .putExtra("cookies", cookieHeader == null ? "" : cookieHeader);
        sendCommand(context, intent);
    }

    public static void clearSession(Context context) {
        sendCommand(context, new Intent(context, BackgroundMonitorService.class).setAction(ACTION_CLEAR_SESSION));
    }

    public static boolean isOverlayEnabled(Context context) {
        return context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_OVERLAY_ENABLED, false);
    }

    public static void setOverlayEnabled(Context context, boolean enabled) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_OVERLAY_ENABLED, enabled).apply();
        Intent intent = new Intent(context, BackgroundMonitorService.class)
            .setAction(ACTION_OVERLAY)
            .putExtra("enabled", enabled);
        sendCommand(context, intent);
    }

    public static void refreshOverlay(Context context) {
        sendCommand(context, new Intent(context, BackgroundMonitorService.class).setAction(ACTION_OVERLAY));
    }

    private static void sendCommand(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(intent);
        else app.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        running = true;
        android.content.SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        routerUrl = preferences.getString(KEY_URL, "http://192.168.0.1");
        password = preferences.getString(KEY_PASSWORD, "111111");
        overlayEnabled = preferences.getBoolean(KEY_OVERLAY_ENABLED, false);
        appForeground = preferences.getLong(KEY_FOREGROUND_UNTIL, 0) > System.currentTimeMillis();
        Log.w(TAG, "service created foreground=" + appForeground);
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        alarmManager = (AlarmManager) getSystemService(ALARM_SERVICE);
        overlay = new MonitorOverlay(this);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification("正在启动后台监测…"));
        updateOverlay();
        acquireLocks();
        executor = Executors.newSingleThreadScheduledExecutor();
        if (!isAppForeground()) {
            pollNow();
            startFastPolling();
            scheduleWatchdog();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_FOREGROUND.equals(action)) {
                boolean foreground = intent.getBooleanExtra("foreground", false);
                if (foreground != appForeground) {
                    Log.w(TAG, foreground ? "[FG] 应用切换到前台" : "[BG] 应用切换到后台");
                }
                appForeground = foreground;
                updateNotification();
                if (foreground) {
                    stopFastPolling();
                    cancelWatchdog();
                }
                else {
                    pollNow();
                    startFastPolling();
                    scheduleWatchdog();
                }
            } else if (ACTION_CONFIGURE.equals(action)) {
                routerUrl = intent.getStringExtra(KEY_URL);
                password = intent.getStringExtra(KEY_PASSWORD);
                if (routerUrl == null || routerUrl.isEmpty()) routerUrl = "http://192.168.0.1";
                if (password == null) password = "";
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putString(KEY_URL, routerUrl)
                    .putString(KEY_PASSWORD, password)
                    .apply();
                if (intent.getBooleanExtra("changed", false)) {
                    loggedIn = false;
                    RouterSession.clear();
                }
            } else if (ACTION_SESSION.equals(action)) {
                RouterSession.replace(intent.getStringExtra("cookies"));
            } else if (ACTION_CLEAR_SESSION.equals(action)) {
                loggedIn = false;
                RouterSession.clear();
            } else if (ACTION_OVERLAY.equals(action)) {
                overlayEnabled = intent.hasExtra("enabled")
                    ? intent.getBooleanExtra("enabled", false)
                    : getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_OVERLAY_ENABLED, false);
                updateOverlay();
            } else if (ACTION_SNAPSHOT.equals(action)) {
                applySnapshotPayload(intent.getStringExtra("payload"));
            } else if (ACTION_POLL.equals(action)) {
                if (!isAppForeground()) pollNow();
            }
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "service destroyed");
        running = false;
        stopFastPolling();
        cancelWatchdog();
        if (executor != null) executor.shutdownNow();
        releaseLocks();
        if (overlay != null) overlay.remove();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollRouter() {
        if (!running || isAppForeground()) {
            return;
        }
        try {
            JSONObject status = fetchStatus(routerUrl, password);
            applySnapshot(status);
            lastError = "";
        } catch (Throwable error) {
            lastError = error.getMessage() == null ? "等待路由器连接" : error.getMessage();
            Log.e(TAG, "poll failed", error);
            updateNotification();
            updateOverlay();
        } finally {
            if (running && !isAppForeground()) scheduleWatchdog();
        }
    }

    private void pollNow() {
        ScheduledExecutorService current = executor;
        if (current != null && !current.isShutdown()) current.execute(this::pollRouter);
    }

    private void startFastPolling() {
        ScheduledExecutorService current = executor;
        if (current == null || current.isShutdown() || isAppForeground()) return;
        if (fastPollTask != null && !fastPollTask.isCancelled()) return;
        fastPollTask = current.scheduleAtFixedRate(this::pollRouter, 0, 1000, TimeUnit.MILLISECONDS);
        Log.w(TAG, "fast polling enabled interval=1000ms");
    }

    private void stopFastPolling() {
        if (fastPollTask != null) {
            fastPollTask.cancel(false);
            fastPollTask = null;
            Log.w(TAG, "fast polling disabled");
        }
    }

    private void scheduleWatchdog() {
        if (alarmManager == null || isAppForeground()) return;
        long triggerAt = android.os.SystemClock.elapsedRealtime() + 1000;
        PendingIntent pending = watchdogPendingIntent();
        if (Build.VERSION.SDK_INT >= 23) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
        } else {
            alarmManager.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
        }
    }

    private void cancelWatchdog() {
        if (alarmManager != null) alarmManager.cancel(watchdogPendingIntent());
    }

    private PendingIntent watchdogPendingIntent() {
        Intent intent = new Intent(this, MonitorTickReceiver.class).setAction(ACTION_POLL);
        int flags = Build.VERSION.SDK_INT >= 23
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getBroadcast(this, 5121, intent, flags);
    }

    private void applySnapshotPayload(String payload) {
        try {
            JSONObject input = new JSONObject(payload == null ? "{}" : payload);
            JSONObject status = input.optJSONObject("status");
            if (status == null) status = input;
            JSONObject temperature = input.optJSONObject("temperature");
            if (temperature != null && !status.has("battery_temp") && temperature.has("battery_temp")) {
                status.put("battery_temp", temperature.opt("battery_temp"));
            }
            applySnapshot(status);
        } catch (Exception ignored) {}
    }

    private JSONObject fetchStatus(String routerUrl, String password) throws Exception {
        JSONObject status = getFields(routerUrl, "loginfo,realtime_rx_thrpt,realtime_tx_thrpt,battery_temp,battery_value,battery_vol_percent,battery_charging,battery_charg_type,external_charging_flag");
        if (!"ok".equals(status.optString("loginfo"))) {
            login(routerUrl, password);
            status = getFields(routerUrl, "loginfo,realtime_rx_thrpt,realtime_tx_thrpt,battery_temp,battery_value,battery_vol_percent,battery_charging,battery_charg_type,external_charging_flag");
        }
        if (!"ok".equals(status.optString("loginfo"))) throw new Exception("路由器登录失败");
        return status;
    }

    private void login(String routerUrl, String password) throws Exception {
        RouterSession.clear();
        request(routerUrl + "/index.html", "GET", "");
        getFields(routerUrl, "Language,cr_version,wa_inner_version");
        JSONObject token = getFields(routerUrl, "LD");
        String hashed = sha256(sha256(password) + token.optString("LD"));
        String body = form("isTest", "false", "goformId", "LOGIN", "password", hashed);
        request(routerUrl + "/goform/goform_set_cmd_process", "POST", body);
        JSONObject check = getFields(routerUrl, "loginfo");
        loggedIn = "ok".equals(check.optString("loginfo"));
        if (!loggedIn) throw new Exception("路由器登录失败");
    }

    private JSONObject getFields(String routerUrl, String fields) throws Exception {
        String query = form("isTest", "false", "multi_data", "1", "cmd", fields, "_", String.valueOf(System.currentTimeMillis()));
        String raw = request(routerUrl + "/goform/goform_get_cmd_process?" + query, "GET", "");
        return new JSONObject(raw);
    }

    private String request(String address, String method, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(8000);
        connection.setUseCaches(false);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Connection", "close");
        connection.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01");
        connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
        connection.setRequestProperty("Referer", address.substring(0, address.indexOf('/', address.indexOf("//") + 2) + 1) + "index.html");
        String sessionCookie = RouterSession.header();
        if (!sessionCookie.isEmpty()) connection.setRequestProperty("Cookie", sessionCookie);
        if (body != null && !body.isEmpty() && !"GET".equals(method)) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        }
        try {
            int status = connection.getResponseCode();
            RouterSession.remember(connection.getHeaderFields());
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String response = readText(stream);
            if (status < 200 || status >= 300) throw new Exception("路由器返回 HTTP " + status);
            return response;
        } finally {
            connection.disconnect();
        }
    }

    private void applySnapshot(JSONObject status) {
        double down = number(status, "realtime_rx_thrpt");
        double up = number(status, "realtime_tx_thrpt");
        double percent = number(status, "battery_vol_percent");
        if (!Double.isFinite(percent)) percent = number(status, "battery_value");
        double temperature = number(status, "battery_temp");
        lastSpeedDown = formatRate(down);
        lastSpeedUp = formatRate(up);
        lastBattery = Double.isFinite(percent) ? formatNumber(percent) + "%" : "未知";
        lastTemperature = Double.isFinite(temperature) ? formatNumber(temperature) + "°C" : "未知";
        lastError = "";
        lastSuccessAt = System.currentTimeMillis();
        recordBattery(this, status, null);
        updateNotification();
        updateOverlay();
    }

    private void updateOverlay() {
        mainHandler.post(() -> {
            if (overlay == null) return;
            if (!overlayEnabled) {
                overlay.remove();
                return;
            }
            overlay.update(lastSpeedDown, lastSpeedUp, lastBattery, lastTemperature, lastError);
        });
    }

    private static void recordBattery(Context context, JSONObject status, JSONObject temperatureObject) {
        if (status == null) return;
        synchronized (HISTORY_LOCK) {
            double percent = number(status, "battery_vol_percent");
            if (!Double.isFinite(percent)) percent = number(status, "battery_value");
            if (!Double.isFinite(percent)) {
                Log.w(TAG, "recordBattery skipped: percent unavailable");
                return;
            }
            boolean charging = "1".equals(status.optString("battery_charging")) || "1".equals(status.optString("external_charging_flag"));
            long now = System.currentTimeMillis();
            SharedHistory history = new SharedHistory(context);
            JSONArray samples = history.loadUnlocked();
            JSONObject previous = samples.length() == 0 ? null : samples.optJSONObject(samples.length() - 1);
            if (previous != null && now - previous.optLong("timestamp", 0) < 60000 && charging == previous.optBoolean("charging", false)) {
                return;
            }
            JSONObject sample = new JSONObject();
            try {
                sample.put("timestamp", now);
                sample.put("percent", percent);
                sample.put("charging", charging);
                double batteryTemp = number(status, "battery_temp");
                if (!Double.isFinite(batteryTemp) && temperatureObject != null) batteryTemp = number(temperatureObject, "battery_temp");
                if (Double.isFinite(batteryTemp)) sample.put("temperature", batteryTemp);
                sample.put("chargeType", status.optString("battery_charg_type", ""));
                sample.put("externalPower", "1".equals(status.optString("external_charging_flag")));
                sample.put("voltage", status.optString("battery_voltage", ""));
                sample.put("current", status.optString("battery_current", ""));
                sample.put("capacity", status.optString("battery_capacity", ""));
                sample.put("health", status.optString("battery_health", ""));
                samples.put(sample);
                history.saveUnlocked(pruneHistory(samples, now));
                Log.w(TAG, "recordBattery saved percent=" + percent + " charging=" + charging + " len=" + samples.length());
            } catch (Exception ignored) {}
        }
    }

    private void updateNotification() {
        // The foreground-service notification is deliberately static. Live values belong in the app and overlay.
    }

    private Notification buildNotification(String content) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pending = PendingIntent.getActivity(this, 5120, intent, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder.setSmallIcon(R.drawable.ic_stat_monitor)
            .setLargeIcon(BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher))
            .setContentTitle("U50 Pro")
            .setContentText("后台监测服务运行中")
            .setContentIntent(pending)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setPriority(Notification.PRIORITY_LOW)
            .build();
    }

    private boolean isAppForeground() {
        return appForeground;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "U50 Pro 后台服务", NotificationManager.IMPORTANCE_MIN);
        channel.setDescription("后台数据采样服务");
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        notificationManager.createNotificationChannel(channel);
    }

    private void acquireLocks() {
        try {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "U50Pro:BackgroundMonitor");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        } catch (Exception ignored) {}
        try {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
            wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "U50Pro:BackgroundMonitor");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        } catch (Exception ignored) {}
    }

    private void releaseLocks() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) {}
    }

    private static JSONArray pruneHistory(JSONArray source, long now) {
        List<JSONObject> values = new ArrayList<>();
        long cutoff = now - BATTERY_WINDOW_MS;
        for (int index = 0; index < source.length(); index++) {
            JSONObject item = source.optJSONObject(index);
            if (item != null && item.optLong("timestamp", 0) >= cutoff) values.add(item);
        }
        int start = Math.max(0, values.size() - BATTERY_MAX_POINTS);
        JSONArray output = new JSONArray();
        for (int index = start; index < values.size(); index++) output.put(values.get(index));
        return output;
    }

    private static double number(JSONObject object, String key) {
        if (object == null || !object.has(key) || object.isNull(key)) return Double.NaN;
        try { return Double.parseDouble(String.valueOf(object.get(key)).trim()); } catch (Exception ignored) { return Double.NaN; }
    }

    private static String formatNumber(double value) {
        if (!Double.isFinite(value)) return "未知";
        return Math.abs(value - Math.rint(value)) < 0.05 ? String.valueOf((long) Math.rint(value)) : String.format(Locale.US, "%.1f", value);
    }

    private static String formatRate(double value) {
        if (!Double.isFinite(value) || value < 0) return "0 B/s";
        if (value >= 1024 * 1024) return String.format(Locale.US, "%.1f MB/s", value / (1024 * 1024));
        if (value >= 1024) return String.format(Locale.US, "%.1f KB/s", value / 1024);
        return formatNumber(value) + " B/s";
    }

    private static String sha256(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder output = new StringBuilder();
        for (byte item : digest) output.append(String.format(Locale.US, "%02X", item));
        return output.toString();
    }

    private static String form(String... values) throws Exception {
        StringBuilder output = new StringBuilder();
        for (int index = 0; index + 1 < values.length; index += 2) {
            if (output.length() > 0) output.append('&');
            output.append(URLEncoder.encode(values[index], "UTF-8"));
            output.append('=').append(URLEncoder.encode(values[index + 1], "UTF-8"));
        }
        return output.toString();
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

    private static File historyFile(Context context) {
        return new File(context.getFilesDir(), "battery_history.json");
    }

    private static byte[] readFileBytes(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int count;
            while ((count = input.read(chunk)) != -1) buffer.write(chunk, 0, count);
            return buffer.toByteArray();
        }
    }

    private static void writeFileBytes(File file, byte[] data) throws Exception {
        File temp = new File(file.getParentFile(), file.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temp)) {
            output.write(data);
            output.flush();
            output.getFD().sync();
        }
        if (!temp.renameTo(file)) {
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(data);
                output.flush();
            }
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
        }
    }

    private static final class SharedHistory {
        private final Context context;
        SharedHistory(Context context) { this.context = context.getApplicationContext(); }
        JSONArray loadUnlocked() {
            try {
                File file = historyFile(context);
                if (!file.exists()) return new JSONArray();
                return new JSONArray(new String(readFileBytes(file), StandardCharsets.UTF_8));
            } catch (Exception ignored) { return new JSONArray(); }
        }
        void saveUnlocked(JSONArray value) {
            try {
                writeFileBytes(historyFile(context), value.toString().getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {}
        }
    }
}
