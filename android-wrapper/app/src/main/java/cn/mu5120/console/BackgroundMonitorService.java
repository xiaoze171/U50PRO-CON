package cn.mu5120.console;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.AlarmManager;
import android.app.ActivityManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.BroadcastReceiver;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.graphics.BitmapFactory;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
    private static final String KEY_BATTERY_SOURCE = "batterySource";
    private static final String KEY_BATTERY_HOST = "batteryHost";
    private static final String KEY_BATTERY_PORT = "batteryPort";
    private static final String KEY_FOREGROUND_UNTIL = "appForegroundUntil";
    private static final String KEY_OVERLAY_ENABLED = "overlayEnabled";
    private static final String KEY_OVERLAY_REVISION = "overlayRevision";
    private static final String ACTION_FOREGROUND = "cn.mu5120.console.monitor.FOREGROUND";
    private static final String ACTION_CONFIGURE = "cn.mu5120.console.monitor.CONFIGURE";
    private static final String ACTION_SNAPSHOT = "cn.mu5120.console.monitor.SNAPSHOT";
    private static final String ACTION_SMS = "cn.mu5120.console.monitor.SMS";
    private static final String ACTION_SESSION = "cn.mu5120.console.monitor.SESSION";
    private static final String ACTION_CLEAR_SESSION = "cn.mu5120.console.monitor.CLEAR_SESSION";
    private static final String ACTION_OVERLAY = "cn.mu5120.console.monitor.OVERLAY";
    static final String ACTION_POLL = "cn.mu5120.console.monitor.POLL";
    private static final long BATTERY_WINDOW_MS = 24L * 60L * 60L * 1000L;
    private static final int BATTERY_MAX_POINTS = 1445;
    private static final Object HISTORY_LOCK = new Object();
    private static final Object CONFIG_LOCK = new Object();
    private static final Object OVERLAY_CHOICE_LOCK = new Object();
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
    private volatile long foregroundUntil;
    private volatile String routerUrl = "http://192.168.0.1";
    private volatile String password = "111111";
    private volatile BatteryGaugeConfig batteryConfig = new BatteryGaugeConfig("gauge", "", 88);
    private volatile long configGeneration;
    private MonitorHistoryStore historyStore;
    private final BatteryCurrentWindow batteryCurrentWindow = new BatteryCurrentWindow();
    private MonitorRouterClient routerClient;
    private String clientUrl = "";
    private String clientPassword = "";
    private BatteryGaugeConfig clientBatteryConfig;
    private long lastSmsPoll;
    private long lastWatchdog;
    private long lastStateWrite;
    private long lastSavedAt;
    private String lastCollectionError = "";
    private String lastSpeedDown = "0 B/s";
    private String lastSpeedUp = "0 B/s";
    private String lastBattery = "未知";
    private String lastTemperature = "未知";
    private String lastError = "";
    private volatile long lastSuccessAt;
    private volatile boolean overlayEnabled;
    private boolean receiverRegistered;
    private final BroadcastReceiver runtimeReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            if (ACTION_OVERLAY.equals(intent.getAction())) {
                acceptOverlayChoice(intent);
                if (!MonitorRuntimePolicy.shouldRun(deviceHistoryProfile(), currentOverlaySelection())) stopOptionalRuntime();
                else updateOverlay();
            } else if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                synchronized (CONFIG_LOCK) { configGeneration += 2; }
                stopFastPolling();
                if (routerClient != null) routerClient.cancelPendingRequests();
                batteryCurrentWindow.reset();
                updateOverlay();
                writeMonitorState(true);
            } else if (Intent.ACTION_SCREEN_ON.equals(intent.getAction())) {
                startFastPolling();
                updateOverlay();
            }
        }
    };

    private static boolean deviceHistoryProfile() { return "gauge88-csv".equals(BatteryProfile.mode()); }

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

    public static void configure(Context context, String routerUrl, String password, String batterySettings) {
        String url = routerUrl == null || routerUrl.trim().isEmpty() ? "http://192.168.0.1" : routerUrl.trim().replaceAll("/+$", "");
        String nextPassword = password == null ? "" : password;
        android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        BatteryGaugeConfig config;
        try { config = BatteryGaugeConfig.fromJson(new JSONObject(batterySettings == null ? "{}" : batterySettings)); }
        catch (Exception error) { Log.w(TAG, "invalid battery configuration", error); return; }
        boolean changed = !url.equals(preferences.getString(KEY_URL, "http://192.168.0.1"))
            || !nextPassword.equals(preferences.getString(KEY_PASSWORD, "111111"));
        preferences.edit()
            .putString(KEY_URL, url)
            .putString(KEY_PASSWORD, nextPassword)
            .putString(KEY_BATTERY_SOURCE, config.source)
            .putString(KEY_BATTERY_HOST, config.host)
            .putInt(KEY_BATTERY_PORT, config.port)
            .commit();
        Intent intent = new Intent(context, BackgroundMonitorService.class)
            .setAction(ACTION_CONFIGURE)
            .putExtra(KEY_URL, url)
            .putExtra(KEY_PASSWORD, nextPassword)
            .putExtra(KEY_BATTERY_SOURCE, config.source)
            .putExtra(KEY_BATTERY_HOST, config.host)
            .putExtra(KEY_BATTERY_PORT, config.port)
            .putExtra("changed", changed);
        sendCommand(context, intent);
    }

    public static String readBatteryHistory(Context context) {
        if (!MonitorRuntimePolicy.shouldArchive(deviceHistoryProfile())) return "[]";
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

    public static void acceptSms(Context context, String payload) {
        sendCommand(context, new Intent(context, BackgroundMonitorService.class)
            .setAction(ACTION_SMS).putExtra("payload", payload));
    }

    public static String readMonitorHistory(Context context) {
        if (!MonitorRuntimePolicy.shouldArchive(deviceHistoryProfile())) return "{}";
        try { return new MonitorHistoryStore(context.getFilesDir()).read(System.currentTimeMillis(), false).toString(); }
        catch (Exception error) {
            Log.e(TAG, "read history failed", error);
            return "{}";
        }
    }

    public static String readMonitorState(Context context) {
        JSONObject state = MonitorHistoryStore.readJson(new File(context.getFilesDir(), "monitor-state.json"));
        if (deviceHistoryProfile()) {
            try {
                boolean enabled = isOverlayEnabled(context);
                boolean active = enabled && isServiceRunning(context);
                state.put("historySource", "device-csv").put("source", "device").put("lastSavedAt", 0)
                    .put("overlayEnabled", enabled).put("running", active)
                    .put("polling", active && state.optBoolean("polling"))
                    .put("wakeLockHeld", false).put("wifiLockHeld", false);
                if (!active) state.put("background", false).put("lastError", "").put("collectionError", "");
            } catch (Exception ignored) { }
        }
        return state.toString();
    }

    @SuppressWarnings("deprecation")
    private static boolean isServiceRunning(Context context) {
        try {
            ActivityManager manager = (ActivityManager) context.getSystemService(ACTIVITY_SERVICE);
            if (manager == null) return false;
            for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(100)) {
                if (BackgroundMonitorService.class.getName().equals(service.service.getClassName()) && service.started) return true;
            }
        } catch (RuntimeException ignored) { }
        return false;
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

    @SuppressWarnings("deprecation")
    public static boolean isOverlayEnabled(Context context) {
        // Reload the selection at cross-process entry points; explicit intents still update the service cache.
        return context.getSharedPreferences(PREFS, MODE_PRIVATE | MODE_MULTI_PROCESS)
            .getBoolean(KEY_OVERLAY_ENABLED, false);
    }

    public static void setOverlayEnabled(Context context, boolean enabled) {
        synchronized (OVERLAY_CHOICE_LOCK) {
        android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        preferences.edit().putBoolean(KEY_OVERLAY_ENABLED, enabled)
            .putLong(KEY_OVERLAY_REVISION, preferences.getLong(KEY_OVERLAY_REVISION, 0) + 1).commit();
        Intent intent = new Intent(context, BackgroundMonitorService.class)
            .setAction(ACTION_OVERLAY)
            .putExtra("enabled", enabled);
        sendCommand(context, intent);
        }
    }

    public static void refreshOverlay(Context context) {
        // The UI and :monitor have separate SharedPreferences caches.
        sendCommand(context, new Intent(context, BackgroundMonitorService.class)
            .setAction(ACTION_OVERLAY).putExtra("enabled", isOverlayEnabled(context)));
    }

    private static void sendCommand(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        try {
            synchronized (OVERLAY_CHOICE_LOCK) {
            if (deviceHistoryProfile()) {
                android.content.SharedPreferences preferences = app.getSharedPreferences(PREFS, MODE_PRIVATE | MODE_MULTI_PROCESS);
                // getAll is one preference snapshot: a captured old value cannot borrow
                // a later choice's revision. UI updates and dispatch share this lock.
                Map<String, ?> selection = preferences.getAll();
                boolean enabled = Boolean.TRUE.equals(selection.get(KEY_OVERLAY_ENABLED));
                Object revisionValue = selection.get(KEY_OVERLAY_REVISION);
                long revision = revisionValue instanceof Long ? (Long) revisionValue : 0;
                if (ACTION_OVERLAY.equals(intent.getAction())) intent.putExtra("enabled", enabled);
                intent.putExtra(KEY_OVERLAY_ENABLED, enabled)
                    .putExtra(KEY_OVERLAY_REVISION, revision);
                if (!MonitorRuntimePolicy.shouldRun(true, enabled)) {
                    // A broadcast updates an existing service's preference cache without creating one.
                    app.sendBroadcast(new Intent(ACTION_OVERLAY).setPackage(app.getPackageName())
                        .putExtra("enabled", false).putExtra(KEY_OVERLAY_REVISION, revision));
                    app.stopService(new Intent(app, BackgroundMonitorService.class));
                    cancelWatchdog(app);
                    return;
                }
            }
            if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(intent);
            else app.startService(intent);
            }
        } catch (RuntimeException error) {
            Log.e(TAG, "无法启动后台监测，请打开应用并允许后台运行", error);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        android.content.SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        routerUrl = preferences.getString(KEY_URL, "http://192.168.0.1");
        password = preferences.getString(KEY_PASSWORD, "111111");
        batteryConfig = new BatteryGaugeConfig(preferences.getString(KEY_BATTERY_SOURCE, "gauge"),
            preferences.getString(KEY_BATTERY_HOST, ""), preferences.getInt(KEY_BATTERY_PORT, 88));
        overlayEnabled = preferences.getBoolean(KEY_OVERLAY_ENABLED, false);
        appForeground = preferences.getLong(KEY_FOREGROUND_UNTIL, 0) > System.currentTimeMillis();
        foregroundUntil = appForeground ? SystemClock.elapsedRealtime() + 15000 : 0;
        Log.w(TAG, "service created foreground=" + appForeground);
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        alarmManager = (AlarmManager) getSystemService(ALARM_SERVICE);
    }

    private void startRuntime() {
        if (running) return;
        running = true;
        overlay = new MonitorOverlay(this);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification("正在启动后台监测…"));
        updateOverlay();
        acquireLocks();
        if (MonitorRuntimePolicy.shouldArchive(deviceHistoryProfile())) {
            historyStore = new MonitorHistoryStore(getFilesDir());
            JSONObject savedState = MonitorHistoryStore.readJson(new File(getFilesDir(), "monitor-state.json"));
            lastSavedAt = savedState.optLong("lastSavedAt");
        } else {
            cancelWatchdog();
            IntentFilter filter = new IntentFilter(ACTION_OVERLAY);
            filter.addAction(Intent.ACTION_SCREEN_ON);
            filter.addAction(Intent.ACTION_SCREEN_OFF);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(runtimeReceiver, filter, 4 /* RECEIVER_NOT_EXPORTED */);
            else registerReceiver(runtimeReceiver, filter);
            receiverRegistered = true;
        }
        executor = Executors.newSingleThreadScheduledExecutor();
        // Keep a low-cost ticker alive even in the foreground. If the UI process disappears
        // without onPause, its heartbeat expires and native collection takes over.
        startFastPolling();
        scheduleWatchdog();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (deviceHistoryProfile()) {
            if (intent != null) acceptOverlayChoice(intent);
            if (!MonitorRuntimePolicy.shouldRun(true, currentOverlaySelection())) {
                stopOptionalRuntime();
                return START_NOT_STICKY;
            }
        }
        startRuntime();
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_FOREGROUND.equals(action)) {
                boolean foreground = intent.getBooleanExtra("foreground", false);
                if (foreground != appForeground) {
                    batteryCurrentWindow.reset();
                    Log.w(TAG, foreground ? "[FG] 应用切换到前台" : "[BG] 应用切换到后台");
                }
                appForeground = foreground;
                foregroundUntil = foreground ? SystemClock.elapsedRealtime() + 15000 : 0;
                if (!foreground) scheduleWatchdog();
            } else if (ACTION_CONFIGURE.equals(action)) {
                synchronized (CONFIG_LOCK) {
                configGeneration++;
                routerUrl = intent.getStringExtra(KEY_URL);
                password = intent.getStringExtra(KEY_PASSWORD);
                if (routerUrl == null || routerUrl.isEmpty()) routerUrl = "http://192.168.0.1";
                if (password == null) password = "";
                batteryConfig = new BatteryGaugeConfig(intent.getStringExtra(KEY_BATTERY_SOURCE),
                    intent.getStringExtra(KEY_BATTERY_HOST), intent.getIntExtra(KEY_BATTERY_PORT, 88));
                // configure() already persists the UI-owned settings. A monitor
                // cache must not write its stale full preference map in device mode.
                if (!deviceHistoryProfile()) {
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putString(KEY_URL, routerUrl)
                        .putString(KEY_PASSWORD, password)
                        .putString(KEY_BATTERY_SOURCE, batteryConfig.source)
                        .putString(KEY_BATTERY_HOST, batteryConfig.host)
                        .putInt(KEY_BATTERY_PORT, batteryConfig.port)
                        .apply();
                }
                configGeneration++;
                if (intent.getBooleanExtra("changed", false)) RouterSession.clear();
                if (routerClient != null) routerClient.invalidateBatteryCsv();
                }
            } else if (ACTION_SESSION.equals(action)) {
                RouterSession.replace(intent.getStringExtra("cookies"));
            } else if (ACTION_CLEAR_SESSION.equals(action)) {
                RouterSession.clear();
            } else if (ACTION_OVERLAY.equals(action)) {
                acceptOverlayChoice(intent);
                updateOverlay();
            } else if (ACTION_SNAPSHOT.equals(action)) {
                String payload = intent.getStringExtra("payload");
                executor.execute(() -> applySnapshotPayload(payload, "foreground"));
            } else if (ACTION_SMS.equals(action)) {
                if (!MonitorRuntimePolicy.shouldArchive(deviceHistoryProfile())) return START_NOT_STICKY;
                String payload = intent.getStringExtra("payload");
                executor.execute(() -> {
                    try { historyStore.recordSms(new JSONObject(payload).put("source", "foreground"), System.currentTimeMillis()); }
                    catch (Exception error) { Log.e(TAG, "save SMS failed", error); }
                });
            } else if (ACTION_POLL.equals(action)) {
                startFastPolling();
            }
        }
        return deviceHistoryProfile() ? START_NOT_STICKY : START_STICKY;
    }

    private void acceptOverlayChoice(Intent intent) {
        boolean explicit = intent.hasExtra("enabled") || intent.hasExtra(KEY_OVERLAY_ENABLED);
        if (!explicit) return;
        android.content.SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE | MODE_MULTI_PROCESS);
        if (deviceHistoryProfile() && intent.hasExtra(KEY_OVERLAY_REVISION)) {
            // The UI owns the persisted choice. Never write a stamped service command
            // back: another process may disable it immediately after this snapshot.
            overlayEnabled = Boolean.TRUE.equals(preferences.getAll().get(KEY_OVERLAY_ENABLED));
            return;
        }
        boolean enabled = intent.hasExtra("enabled") ? intent.getBooleanExtra("enabled", false)
            : intent.getBooleanExtra(KEY_OVERLAY_ENABLED, false);
        if (intent.hasExtra(KEY_OVERLAY_REVISION)
            && intent.getLongExtra(KEY_OVERLAY_REVISION, 0) != preferences.getLong(KEY_OVERLAY_REVISION, 0)) {
            enabled = preferences.getBoolean(KEY_OVERLAY_ENABLED, false);
        }
        overlayEnabled = enabled;
        // Keep this process's cache current before overlay position/configuration writes.
        preferences.edit().putBoolean(KEY_OVERLAY_ENABLED, enabled).commit();
    }

    private void stopOptionalRuntime() {
        synchronized (CONFIG_LOCK) { running = false; configGeneration += 2; }
        stopFastPolling();
        if (routerClient != null) routerClient.cancelPendingRequests();
        cancelWatchdog();
        releaseLocks();
        batteryCurrentWindow.reset();
        if (executor != null) executor.shutdownNow();
        if (overlay != null) overlay.remove();
        writeMonitorState(true);
        if (instance == this) {
            stopForeground(true);
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "service destroyed");
        synchronized (CONFIG_LOCK) { running = false; configGeneration += 2; }
        stopFastPolling();
        if (routerClient != null) routerClient.cancelPendingRequests();
        cancelWatchdog();
        if (executor != null) executor.shutdownNow();
        releaseLocks();
        if (overlay != null) overlay.remove();
        if (receiverRegistered) {
            unregisterReceiver(runtimeReceiver);
            receiverRegistered = false;
        }
        writeMonitorState(true);
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollRouter() {
        if (!running) return;
        if (!MonitorRuntimePolicy.shouldPoll(deviceHistoryProfile(), currentOverlaySelection(),
            isAppForeground(), isScreenInteractive())) {
            batteryCurrentWindow.reset(); writeMonitorState(false); return;
        }
        String url = routerUrl;
        String secret = password;
        BatteryGaugeConfig selectedBattery = batteryConfig;
        long generation = configGeneration;
        if ((generation & 1) != 0) return;
        try {
            if (routerClient == null || !url.equals(clientUrl) || !secret.equals(clientPassword)
                || clientBatteryConfig == null || !selectedBattery.source.equals(clientBatteryConfig.source)
                || !selectedBattery.host.equals(clientBatteryConfig.host) || selectedBattery.port != clientBatteryConfig.port) {
                if (routerClient != null) routerClient.invalidateBatteryCsv();
                routerClient = new MonitorRouterClient(this, url, secret, selectedBattery);
                clientUrl = url;
                clientPassword = secret;
                clientBatteryConfig = selectedBattery;
            }
            String source = nativeCollectionSource();
            JSONObject snapshot = routerClient.dashboard(() -> running && generation == configGeneration && canAcceptSnapshot(true));
            if (generation != configGeneration || !url.equals(routerUrl) || !secret.equals(password)
                || !canAcceptSnapshot(true)) return;
            if ("factory".equals(selectedBattery.source)) {
                JSONArray factoryHistory;
                synchronized (HISTORY_LOCK) { factoryHistory = new SharedHistory(this).loadUnlocked(); }
                snapshot.put("battery", BatteryFactory.estimate(snapshot.optJSONObject("status"), factoryHistory, snapshot.optLong("timestamp"), url));
            }
            applySnapshotPayload(snapshot.toString(), source, generation);
            if (generation != configGeneration || !canAcceptSnapshot(true)) return;
            long now = System.currentTimeMillis();
            if (MonitorRuntimePolicy.shouldPollSms(deviceHistoryProfile()) && now - lastSmsPoll >= 5000) {
                lastSmsPoll = now;
                try {
                    String smsSource = nativeCollectionSource();
                    historyStore.recordSms(routerClient.sms().put("source", smsSource), System.currentTimeMillis());
                }
                catch (Exception error) {
                    lastCollectionError = "短信：" + MonitorRouterClient.message(error);
                    Log.w(TAG, lastCollectionError);
                }
            }
            lastError = "";
        } catch (Throwable error) {
            if (generation != configGeneration || !canAcceptSnapshot(true)) return;
            lastError = error.getMessage() == null ? "等待路由器连接" : error.getMessage();
            Log.e(TAG, "poll failed", error);
            updateNotification();
            updateOverlay();
        } finally {
            if (running && (!deviceHistoryProfile() || currentOverlaySelection())) {
                writeMonitorState(false); scheduleWatchdog();
            }
        }
    }

    private void startFastPolling() {
        if (!running || !MonitorRuntimePolicy.shouldTick(deviceHistoryProfile(), currentOverlaySelection(), isScreenInteractive())) return;
        ScheduledExecutorService current = executor;
        if (current == null || current.isShutdown()) return;
        if (fastPollTask != null && !fastPollTask.isDone()) return;
        fastPollTask = current.scheduleWithFixedDelay(this::pollRouter, 0, 1000, TimeUnit.MILLISECONDS);
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
        if (!running || !MonitorRuntimePolicy.shouldWake(deviceHistoryProfile())) return;
        if (alarmManager == null) return;
        long now = SystemClock.elapsedRealtime();
        if (now - lastWatchdog < 30000) return;
        lastWatchdog = now;
        long triggerAt = now + 60000;
        PendingIntent pending = watchdogPendingIntent();
        try {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
        } catch (SecurityException error) {
            // Exact alarm access can be revoked; collection must not crash with it.
            alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
        } catch (RuntimeException error) {
            Log.w(TAG, "watchdog unavailable", error);
        }
    }

    private void cancelWatchdog() {
        if (alarmManager != null) alarmManager.cancel(watchdogPendingIntent());
    }

    private static void cancelWatchdog(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(ALARM_SERVICE);
        if (alarms != null) alarms.cancel(watchdogPendingIntent(context));
    }

    private PendingIntent watchdogPendingIntent() {
        return watchdogPendingIntent(this);
    }

    private static PendingIntent watchdogPendingIntent(Context context) {
        Intent intent = new Intent(context, MonitorTickReceiver.class).setAction(ACTION_POLL);
        int flags = Build.VERSION.SDK_INT >= 23
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getBroadcast(context, 5121, intent, flags);
    }

    private void applySnapshotPayload(String payload, String source) {
        applySnapshotPayload(payload, source, -1);
    }

    private void applySnapshotPayload(String payload, String source, long expectedGeneration) {
        synchronized (CONFIG_LOCK) {
        try {
            if (!canAcceptSnapshot(expectedGeneration >= 0)) return;
            if (expectedGeneration >= 0 && expectedGeneration != configGeneration) return;
            if (expectedGeneration >= 0 && isAppForeground()) return;
            JSONObject input = new JSONObject(payload == null ? "{}" : payload);
            if (input.optBoolean("stale")) return;
            JSONObject status = input.optJSONObject("status");
            if (status == null || !"ok".equals(status.optString("loginfo"))) return;
            if (!batteryConfig.matches(status, routerUrl)) return;
            if (expectedGeneration >= 0) BatteryGaugeReading.refreshStatus(status, System.currentTimeMillis());
            input.put("source", CollectionSource.normalize(source));
            prepareBatterySnapshot(input, batteryCurrentWindow, expectedGeneration >= 0, routerUrl);
            JSONObject temperature = input.optJSONObject("temperature");
            applySnapshot(status, temperature, source, input.optLong("timestamp", System.currentTimeMillis()), input.optJSONObject("battery"));
            JSONObject errors = input.optJSONObject("errors");
            lastCollectionError = errors == null ? "" : errors.toString();
            boolean saved = MonitorRuntimePolicy.shouldArchive(deviceHistoryProfile())
                && historyStore.record(input, System.currentTimeMillis());
            if (saved) {
                lastSavedAt = input.optLong("timestamp");
                Log.i(TAG, "full snapshot saved timestamp=" + lastSavedAt + " background=" + !isAppForeground()
                    + " source=" + source + " groups=" + input.length() + " partial=" + (errors != null));
            }
            writeMonitorState(saved);
        } catch (Exception error) {
            if (!canAcceptSnapshot(expectedGeneration >= 0)) return;
            lastCollectionError = "保存数据失败：" + MonitorRouterClient.message(error);
            Log.e(TAG, lastCollectionError, error);
        }
        }
    }

    private void writeMonitorState(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastStateWrite < 5000) return;
        lastStateWrite = now;
        try {
            JSONObject state = new JSONObject().put("checkedAt", now).put("lastSuccessAt", lastSuccessAt)
                .put("lastSavedAt", lastSavedAt).put("background", !isAppForeground())
                .put("source", isAppForeground() ? "foreground" : nativeCollectionSource())
                .put("running", running).put("overlayEnabled", overlayEnabled)
                .put("polling", running && MonitorRuntimePolicy.shouldPoll(deviceHistoryProfile(), currentOverlaySelection(),
                    isAppForeground(), isScreenInteractive()))
                .put("lastError", lastError).put("collectionError", lastCollectionError)
                .put("wakeLockHeld", wakeLock != null && wakeLock.isHeld())
                .put("wifiLockHeld", wifiLock != null && wifiLock.isHeld());
            if (deviceHistoryProfile()) state.put("source", "device").put("historySource", "device-csv").put("lastSavedAt", 0);
            MonitorHistoryStore.writeJson(new File(getFilesDir(), "monitor-state.json"), state);
        } catch (Exception error) { Log.e(TAG, "save monitor state failed", error); }
    }

    static void prepareBatterySnapshot(JSONObject input, BatteryCurrentWindow window, boolean ownsCollection, String routerEndpoint) throws Exception {
        if (!ownsCollection) {
            window.reset();
            input.put("battery", MonitorHistoryStore.compactBattery(input.optJSONObject("battery")));
            return;
        }
        JSONObject status = input.optJSONObject("status");
        BatteryGaugeReading.refreshStatus(status, input.optLong("timestamp"));
        JSONObject measurement = BatteryGaugeReading.normalizeBatteryMeasurement(status);
        String endpoint = "router".equals(BatteryGaugeReading.source(status)) ? routerEndpoint : BatteryGaugeReading.endpoint(status);
        if (measurement != null) measurement.put("endpoint", BatteryGaugeReading.normalizeBatteryEndpoint(endpoint));
        if (measurement != null && "router".equals(BatteryGaugeReading.source(status)))
            measurement.put("mode", BatteryFactory.charging(status) ? "charging" : "discharging");
        JSONObject previousRevisions = new JSONObject();
        JSONArray previousStats = window.snapshot().getJSONArray("currentStats");
        for (int i = 0; i < previousStats.length(); i++) {
            JSONObject block = previousStats.getJSONObject(i);
            previousRevisions.put(block.getString("blockId"), block.getLong("revision"));
        }
        JSONObject current = window.ingest(input.optLong("timestamp"), endpoint, measurement);
        JSONArray stats = current.getJSONArray("currentStats"); current.remove("currentStats");
        JSONArray updates = new JSONArray();
        for (int i = 0; i < stats.length(); i++) {
            JSONObject block = stats.getJSONObject(i);
            if (block.getLong("revision") > previousRevisions.optLong(block.getString("blockId")))
                updates.put(new JSONObject().put("blockId", block.getString("blockId")).put("revision", block.getLong("revision")));
        }
        JSONObject summary = input.optJSONObject("battery");
        if (summary == null) summary = new JSONObject();
        if (measurement == null) {
            summary.put("timeToFull", BatteryCsv.time("unavailable", "实时电量不可用", 100, null, null))
                .put("runtime", BatteryCsv.time("unavailable", "实时电量不可用", 0, null, null));
            JSONObject csvAnalysis = summary.optJSONObject("csvAnalysis");
            if (csvAnalysis != null) csvAnalysis.put("state", "unavailable").put("reason", "live-measurement");
        }
        summary.put("percent", BatteryGaugeReading.orNull(BatteryGaugeReading.percent(status)))
            .put("percentSource", BatteryGaugeReading.source(status))
            .put("percentEndpoint", BatteryGaugeReading.normalizeBatteryEndpoint(endpoint))
            .put("charging", measurement == null || !"charging".equals(measurement.optString("mode")) && !"discharging".equals(measurement.optString("mode"))
                ? JSONObject.NULL : "charging".equals(measurement.optString("mode")))
            .put("externalPower", measurement != null && measurement.optBoolean("externalPower"))
            .put("measurement", BatteryGaugeReading.orNull(measurement)).put("mode", measurement == null ? "unknown" : measurement.optString("mode"))
            .put("currentStats", stats).put("currentStatsUpdates", updates).put("currentWindow", current);
        input.put("battery", MonitorHistoryStore.compactBattery(summary));
    }

    private void applySnapshot(JSONObject status, JSONObject temperatures, String source, long timestamp, JSONObject summary) {
        double down = number(status, "realtime_rx_thrpt");
        double up = number(status, "realtime_tx_thrpt");
        Double percent = BatteryGaugeReading.percent(status);
        TemperatureReading temperature = BatteryGaugeReading.temperature(temperatures, status);
        lastSpeedDown = formatRate(down);
        lastSpeedUp = formatRate(up);
        lastBattery = percent != null ? formatNumber(percent) + "%" : "—";
        lastTemperature = temperature.display();
        lastError = "";
        lastSuccessAt = System.currentTimeMillis();
        if (MonitorRuntimePolicy.shouldArchive(deviceHistoryProfile()))
            recordBattery(this, status, temperatures, source, timestamp, summary);
        updateNotification();
        updateOverlay();
    }

    private void updateOverlay() {
        mainHandler.post(() -> {
            if (overlay == null) return;
            if (!overlayEnabled || !running || deviceHistoryProfile()
                && (!currentOverlaySelection() || !isScreenInteractive())) {
                overlay.remove();
                return;
            }
            overlay.update(lastSpeedDown, lastSpeedUp, lastBattery, lastTemperature, lastError);
        });
    }

    private static void recordBattery(Context context, JSONObject status, JSONObject temperatureObject, String source, long timestamp, JSONObject summary) {
        if (status == null) return;
        synchronized (HISTORY_LOCK) {
            Double percent = BatteryGaugeReading.percent(status);
            if (percent == null) {
                Log.w(TAG, "recordBattery skipped: percent unavailable");
                return;
            }
            long now = System.currentTimeMillis();
            SharedHistory history = new SharedHistory(context);
            JSONArray samples = history.loadUnlocked();
            JSONObject previous = samples.length() == 0 ? null : samples.optJSONObject(samples.length() - 1);
            String percentSource = BatteryGaugeReading.source(status);
            String percentEndpoint = BatteryGaugeReading.endpoint(status);
            try {
                JSONObject snapshot = new JSONObject().put("timestamp", timestamp).put("status", status).put("temperature", temperatureObject)
                    .put("source", source).put("battery", summary);
                // Completed current blocks are persisted separately by MonitorHistoryStore. This legacy file stays minute-sized.
                JSONObject sample = MonitorHistoryStore.batterySample(snapshot, null);
                Object charging = sample.opt("charging");
                if (charging == null) charging = JSONObject.NULL;
                percentEndpoint = sample.optString("percentEndpoint", percentEndpoint);
                JSONObject currentMeasurement = sample.optJSONObject("measurement"), previousMeasurement = previous == null ? null : previous.optJSONObject("measurement");
                boolean sameMeasurement = currentMeasurement == null && previousMeasurement == null
                    || BatteryCurrentWindow.sameIdentity(BatteryCurrentWindow.identity(currentMeasurement, percentEndpoint),
                        BatteryCurrentWindow.identity(previousMeasurement, previous == null ? "" : previous.optString("percentEndpoint")));
                if (previous != null && timestamp - previous.optLong("timestamp", 0) < 60000 && charging.equals(previous.opt("charging"))
                    && percentSource.equals(previous.optString("percentSource", "router")) && percentEndpoint.equals(previous.optString("percentEndpoint", ""))
                    && sameMeasurement && source.equals(previous.optString("source"))) return;
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
            .setContentText(deviceHistoryProfile() ? "实时悬浮窗运行中 · 历史由设备保存" : "后台监测服务运行中")
            .setContentIntent(pending)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setPriority(Notification.PRIORITY_LOW)
            .build();
    }

    private boolean isAppForeground() {
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        return appForeground && SystemClock.elapsedRealtime() < foregroundUntil && power != null && power.isInteractive();
    }

    private boolean isScreenInteractive() {
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        return power == null || power.isInteractive();
    }

    private boolean currentOverlaySelection() {
        return overlayEnabled && (!deviceHistoryProfile() || isOverlayEnabled(this));
    }

    private boolean canAcceptSnapshot(boolean nativeCollection) {
        return running && MonitorRuntimePolicy.shouldAcceptSnapshot(deviceHistoryProfile(), currentOverlaySelection(),
            nativeCollection, isAppForeground(), isScreenInteractive());
    }

    private String nativeCollectionSource() {
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        return CollectionSource.resolve(false, power == null || power.isInteractive(),
            overlayEnabled && overlay != null && overlay.isShowing());
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "U50 Pro 后台服务", NotificationManager.IMPORTANCE_MIN);
        channel.setDescription(deviceHistoryProfile() ? "可选实时悬浮窗；历史由设备保存" : "后台数据采样服务");
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        notificationManager.createNotificationChannel(channel);
    }

    private void acquireLocks() {
        if (!MonitorRuntimePolicy.shouldWake(deviceHistoryProfile())) return;
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
            if (item != null && item.optLong("timestamp", 0) >= cutoff) {
                try {
                    double temperature = TemperatureReading.read("battery_temp", item.opt("temperature")).value;
                    item.put("temperature", Double.isFinite(temperature) ? temperature : JSONObject.NULL);
                    if (!(item.opt("charging") instanceof Boolean)) item.put("charging", JSONObject.NULL);
                    JSONObject measurement = MonitorHistoryStore.sanitizeMeasurement(item.optJSONObject("measurement"));
                    JSONObject stats = BatteryCurrentWindow.validateStats(item.optJSONObject("currentStats"));
                    if (measurement == null || stats != null && !BatteryCurrentWindow.sameIdentity(stats.optJSONObject("identity"), BatteryCurrentWindow.identity(measurement, measurement.optString("endpoint")))) stats = null;
                    item.put("measurement", BatteryGaugeReading.orNull(measurement)).put("currentStats", BatteryGaugeReading.orNull(stats));
                    values.add(item);
                } catch (Exception ignored) { }
            }
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
        return value == Math.rint(value) ? String.valueOf((long) value) : String.format(Locale.US, "%.2f", value);
    }

    private static String formatRate(double value) {
        if (!Double.isFinite(value) || value < 0) return "0 B/s";
        if (value >= 1024 * 1024) return String.format(Locale.US, "%.1f MB/s", value / (1024 * 1024));
        if (value >= 1024) return String.format(Locale.US, "%.1f KB/s", value / 1024);
        return formatNumber(value) + " B/s";
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
