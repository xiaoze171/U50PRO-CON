package cn.mu5120.console;

import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.test.AndroidTestCase;
import android.app.Service;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Constructor;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/** Reproduces different UI/service preference caches without starting a collector. */
public final class MonitorOverlayStateTest extends AndroidTestCase {
    private static final String ACTION = "cn.mu5120.console.monitor.OVERLAY";
    private SharedPreferences preferences;
    private RecordingContext context;
    private File directory;
    private volatile Thread blockedRefresh;
    private CountDownLatch refreshCaptured;
    private CountDownLatch releaseRefresh;

    private final class RecordingContext extends ContextWrapper {
        Intent command;
        Intent broadcast;
        int starts;
        int stops;
        RecordingContext(Context base) { super(base); }
        @Override public Context getApplicationContext() {
            if (Thread.currentThread() == blockedRefresh) {
                refreshCaptured.countDown();
                try { if (!releaseRefresh.await(5, TimeUnit.SECONDS)) throw new AssertionError("refresh dispatch not released"); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new AssertionError(error); }
            }
            return this;
        }
        @Override public SharedPreferences getSharedPreferences(String name, int mode) { return preferences; }
        @Override public ComponentName startForegroundService(Intent intent) { starts++; command = intent; return intent.getComponent(); }
        @Override public ComponentName startService(Intent intent) { starts++; command = intent; return intent.getComponent(); }
        @Override public boolean stopService(Intent intent) { stops++; return true; }
        @Override public void sendBroadcast(Intent intent) { broadcast = intent; }
        @Override public File getFilesDir() { return directory; }
        @Override public Object getSystemService(String name) {
            if (Context.ALARM_SERVICE.equals(name)) return null;
            return super.getSystemService(name);
        }
    }

    @Override protected void setUp() throws Exception {
        super.setUp();
        preferences = getContext().getSharedPreferences("overlay-test-" + System.nanoTime(), Context.MODE_PRIVATE);
        context = new RecordingContext(getContext());
        directory = new File(getContext().getCacheDir(), "overlay-state-" + System.nanoTime());
        assertTrue(directory.mkdirs());
    }

    @Override protected void tearDown() throws Exception {
        preferences.edit().clear().commit();
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) file.delete();
        directory.delete();
        super.tearDown();
    }

    public void testResumeCarriesTheUiPreferenceInsteadOfConsultingTheServiceCache() {
        preferences.edit().putBoolean("overlayEnabled", false).commit();
        BackgroundMonitorService.refreshOverlay(context);
        Intent selection = "gauge88-csv".equals(BatteryProfile.mode()) ? context.broadcast : context.command;
        assertNotNull(selection);
        assertTrue("resume must carry the UI's current choice", selection.hasExtra("enabled"));
        assertFalse(selection.getBooleanExtra("enabled", true));
        preferences.edit().putBoolean("overlayEnabled", true).commit();
        BackgroundMonitorService.refreshOverlay(context);
        assertTrue(context.command.getBooleanExtra("enabled", false));
    }

    private BackgroundMonitorService service(boolean enabled) throws Exception {
        BackgroundMonitorService service = new BackgroundMonitorService();
        Method attach = ContextWrapper.class.getDeclaredMethod("attachBaseContext", Context.class);
        attach.setAccessible(true);
        attach.invoke(service, context);
        Field value = BackgroundMonitorService.class.getDeclaredField("overlayEnabled");
        value.setAccessible(true);
        value.setBoolean(service, enabled);
        Field running = BackgroundMonitorService.class.getDeclaredField("running");
        running.setAccessible(true);
        running.setBoolean(service, true);
        return service;
    }

    public void testExplicitChoiceUpdatesTheServiceCacheForLaterConfigurationWrites() throws Exception {
        preferences.edit().putBoolean("overlayEnabled", true).commit();
        BackgroundMonitorService service = service(true);
        service.onStartCommand(new Intent(ACTION).putExtra("enabled", false), 0, 1);
        assertFalse("service cache cannot retain the previous enabled value", preferences.getBoolean("overlayEnabled", true));
        Field value = BackgroundMonitorService.class.getDeclaredField("overlayEnabled");
        value.setAccessible(true);
        assertFalse(value.getBoolean(service));
    }

    public void testRefreshWithoutAChoiceDoesNotRestoreStaleCachedPreferences() throws Exception {
        preferences.edit().putBoolean("overlayEnabled", true).commit();
        BackgroundMonitorService service = service(false);
        service.onStartCommand(new Intent(ACTION), 0, 1);
        Field value = BackgroundMonitorService.class.getDeclaredField("overlayEnabled");
        value.setAccessible(true);
        assertFalse("legacy refresh must keep the accepted current value", value.getBoolean(service));
    }

    public void testAnOldEnableCommandCannotOverrideANewerDisableChoice() throws Exception {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        preferences.edit().putBoolean("overlayEnabled", false).putLong("overlayRevision", 2).commit();
        BackgroundMonitorService service = service(true);
        service.onStartCommand(new Intent(ACTION).putExtra("enabled", true).putExtra("overlayRevision", 1L), 0, 1);
        assertFalse("late enable command cannot revive the overlay", preferences.getBoolean("overlayEnabled", true));
        Field enabled = BackgroundMonitorService.class.getDeclaredField("overlayEnabled");
        enabled.setAccessible(true);
        assertFalse(enabled.getBoolean(service));
    }

    public void testRefreshCapturedBeforeDisableCannotBorrowItsNewRevisionAndStartAService() throws Exception {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        preferences.edit().putBoolean("overlayEnabled", true).putLong("overlayRevision", 1).commit();
        BackgroundMonitorService service = service(true);
        refreshCaptured = new CountDownLatch(1); releaseRefresh = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        blockedRefresh = new Thread(() -> { try { BackgroundMonitorService.refreshOverlay(context); } catch (Throwable error) { failure.set(error); } }, "held-overlay-refresh");
        blockedRefresh.start();
        try {
            assertTrue("old refresh captured its choice before dispatch", refreshCaptured.await(5, TimeUnit.SECONDS));
            BackgroundMonitorService.setOverlayEnabled(context, false);
            service.onStartCommand(context.broadcast, 0, 1);
            releaseRefresh.countDown(); blockedRefresh.join(5000);
            assertFalse("refresh must complete", blockedRefresh.isAlive());
            if (failure.get() != null) throw new AssertionError(failure.get());
            assertEquals("stale refresh cannot start an optional service", 0, context.starts);
            assertFalse(preferences.getBoolean("overlayEnabled", true));
            assertEquals(2L, preferences.getLong("overlayRevision", 0));
            service.onStartCommand(context.broadcast, 0, 2);
            Field running = BackgroundMonitorService.class.getDeclaredField("running"); running.setAccessible(true);
            assertFalse("optional runtime remains stopped", running.getBoolean(service));
        } finally { releaseRefresh.countDown(); blockedRefresh.join(5000); blockedRefresh = null; }
    }

    public void testServiceAcceptingStampedChoiceCannotOverwriteANewerUiDisable() throws Exception {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        SharedPreferences real = preferences;
        real.edit().putBoolean("overlayEnabled", true).putLong("overlayRevision", 1).commit();
        preferences = (SharedPreferences) Proxy.newProxyInstance(SharedPreferences.class.getClassLoader(), new Class<?>[] { SharedPreferences.class }, (proxy, method, arguments) -> {
            Object value;
            try { value = method.invoke(real, arguments); }
            catch (InvocationTargetException error) { throw error.getCause(); }
            if (method.getName().equals("getLong") && "overlayRevision".equals(arguments[0])
                || method.getName().equals("getAll")) {
                real.edit().putBoolean("overlayEnabled", false).putLong("overlayRevision", 2).commit();
            }
            return value;
        });
        try {
            BackgroundMonitorService service = service(true);
            Intent oldChoice = new Intent(ACTION).putExtra("enabled", true).putExtra("overlayRevision", 1L);
            Method accept = BackgroundMonitorService.class.getDeclaredMethod("acceptOverlayChoice", Intent.class); accept.setAccessible(true);
            accept.invoke(service, oldChoice);
            assertFalse("service cannot write an accepted old value over the newer persisted choice", real.getBoolean("overlayEnabled", true));
            assertEquals(2L, real.getLong("overlayRevision", 0));
            service.onStartCommand(oldChoice, 0, 1);
            Field running = BackgroundMonitorService.class.getDeclaredField("running"); running.setAccessible(true);
            assertFalse("fresh preference check prevents a service restart", running.getBoolean(service));
        } finally { preferences = real; }
    }

    private SharedPreferences independentPreferences(File file) throws Exception {
        Constructor<?> constructor = Class.forName("android.app.SharedPreferencesImpl").getDeclaredConstructor(File.class, int.class);
        constructor.setAccessible(true);
        return (SharedPreferences) constructor.newInstance(file, Context.MODE_PRIVATE);
    }

    private void finishPreferenceWrites(SharedPreferences cached) {
        // A no-op synchronous commit is queued after apply's pending disk write
        // and waits for its written-to-disk latch, without changing any key.
        assertTrue("pending preference writes finish", cached.edit().commit());
    }

    private void releaseDrag(SharedPreferences servicePreferences, int action) throws Exception {
        SharedPreferences previous = preferences;
        preferences = servicePreferences;
        MotionEvent event = MotionEvent.obtain(0, 1, action, 37, 91, 0);
        try {
            MonitorOverlay overlay = new MonitorOverlay(context);
            WindowManager.LayoutParams position = new WindowManager.LayoutParams(); position.x = 37; position.y = 91;
            Field layout = MonitorOverlay.class.getDeclaredField("layoutParams"); layout.setAccessible(true); layout.set(overlay, position);
            Constructor<?> constructor = Class.forName("cn.mu5120.console.MonitorOverlay$DragListener").getDeclaredConstructor(MonitorOverlay.class);
            constructor.setAccessible(true);
            View.OnTouchListener listener = (View.OnTouchListener) constructor.newInstance(overlay);
            assertTrue("actual drag release consumes the event", listener.onTouch(null, event));
            finishPreferenceWrites(servicePreferences);
        } finally { event.recycle(); preferences = previous; }
    }

    public void testDeviceDragReleaseCannotPersistCachedEnableOverANewerDisable() throws Exception {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        for (int action : new int[] { MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL }) {
            File file = new File(directory, "drag-preferences-" + action + ".xml");
            SharedPreferences ui = independentPreferences(file);
            assertTrue(ui.edit().putBoolean("overlayEnabled", true).putLong("overlayRevision", 1L).putInt("overlayX", 0).putInt("overlayY", 0).commit());
            SharedPreferences service = independentPreferences(file);
            assertTrue("service starts with its own enabled cache", service.getBoolean("overlayEnabled", false));
            assertTrue(ui.edit().putBoolean("overlayEnabled", false).putLong("overlayRevision", 2L).commit());
            assertTrue("service preference cache is deliberately independent", service.getBoolean("overlayEnabled", false));
            releaseDrag(service, action);
            SharedPreferences reloaded = independentPreferences(file);
            assertFalse("drag position write cannot restore a cached enable on disk", reloaded.getBoolean("overlayEnabled", true));
            assertEquals(2L, reloaded.getLong("overlayRevision", 0));
        }
    }

    public void testFactoryDragReleaseStillPersistsItsPosition() throws Exception {
        if (!"factory".equals(BatteryProfile.mode())) return;
        File file = new File(directory, "factory-drag-preferences.xml");
        SharedPreferences factory = independentPreferences(file);
        assertTrue(factory.edit().putInt("overlayX", 0).putInt("overlayY", 0).commit());
        releaseDrag(factory, MotionEvent.ACTION_UP);
        SharedPreferences reloaded = independentPreferences(file);
        assertEquals(37, reloaded.getInt("overlayX", -1));
        assertEquals(91, reloaded.getInt("overlayY", -1));
    }

    public void testStaleServiceConfigurationCannotPersistCachedEnableAfterItsStartGate() throws Exception {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        File file = new File(directory, "config-preferences.xml");
        SharedPreferences ui = independentPreferences(file);
        assertTrue(ui.edit().putBoolean("overlayEnabled", true).putLong("overlayRevision", 1L).putString("routerUrl", "http://192.168.0.2").commit());
        SharedPreferences cached = independentPreferences(file);
        assertTrue(cached.getBoolean("overlayEnabled", false));
        SharedPreferences previous = preferences; preferences = cached;
        try {
            BackgroundMonitorService service = service(true);
            Intent lateConfiguration = new Intent("cn.mu5120.console.monitor.CONFIGURE") {
                boolean disabled;
                @Override public String getStringExtra(String name) {
                    if ("routerUrl".equals(name) && !disabled) {
                        disabled = true;
                        assertTrue("UI disable occurs after the service start gate", ui.edit().putBoolean("overlayEnabled", false).putLong("overlayRevision", 2L).commit());
                    }
                    return super.getStringExtra(name);
                }
            };
            lateConfiguration.putExtra("routerUrl", "http://192.168.0.1").putExtra("password", "fixture")
                .putExtra("batterySource", "gauge").putExtra("batteryHost", "").putExtra("batteryPort", 88)
                .putExtra("overlayEnabled", true).putExtra("overlayRevision", 1L);
            service.onStartCommand(lateConfiguration, 0, 1);
            finishPreferenceWrites(cached);
            SharedPreferences reloaded = independentPreferences(file);
            assertFalse("stale service config cannot write its cached enabled map to disk", reloaded.getBoolean("overlayEnabled", true));
            assertEquals(2L, reloaded.getLong("overlayRevision", 0));
            assertEquals("http://192.168.0.2", reloaded.getString("routerUrl", ""));
        } finally { preferences = previous; }
    }

    public void testDeviceHistoryCommandsNeverStartAServiceWhileOverlayIsDisabled() {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        preferences.edit().putBoolean("overlayEnabled", false).commit();
        BackgroundMonitorService.start(context);
        BackgroundMonitorService.setAppForeground(context, true);
        BackgroundMonitorService.configure(context, "http://192.168.0.1", "111111", "{}");
        BackgroundMonitorService.acceptSession(context, "stok=fixture");
        BackgroundMonitorService.clearSession(context);
        BackgroundMonitorService.acceptSnapshot(context, "{}");
        BackgroundMonitorService.acceptSms(context, "{}");
        BackgroundMonitorService.refreshOverlay(context);
        BackgroundMonitorService.setOverlayEnabled(context, false);
        assertEquals("heartbeat/config/session/snapshot cannot create a collector", 0, context.starts);
        assertEquals("each entry point stops an existing optional service", 9, context.stops);
        new MonitorTickReceiver().onReceive(context, new Intent("cn.mu5120.console.monitor.POLL"));
        new BootReceiver().onReceive(context, new Intent(Intent.ACTION_BOOT_COMPLETED));
        new BootReceiver().onReceive(context, new Intent(Intent.ACTION_MY_PACKAGE_REPLACED));
        assertEquals("old alarm, boot and package replacement cannot restore a collector", 0, context.starts);
    }

    public void testDisablingStopsTheRuntimeAndUpdatesItsCache() throws Exception {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        BackgroundMonitorService service = service(true);
        Field running = BackgroundMonitorService.class.getDeclaredField("running");
        running.setAccessible(true);
        running.setBoolean(service, true);
        int result = service.onStartCommand(new Intent(ACTION).putExtra("enabled", false), 0, 1);
        assertEquals(Service.START_NOT_STICKY, result);
        assertFalse(running.getBoolean(service));
        assertFalse(preferences.getBoolean("overlayEnabled", true));
        JSONObject state = new JSONObject(BackgroundMonitorService.readMonitorState(context));
        assertFalse(state.getBoolean("running"));
        assertFalse(state.getBoolean("wakeLockHeld"));
        assertFalse(state.getBoolean("wifiLockHeld"));
        assertEquals("device-csv", state.getString("historySource"));
    }

    public void testEnabledOverlayAcceptsLiveSnapshotsWithoutArchivingAndRejectsLateOnes() throws Exception {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        preferences.edit().putBoolean("overlayEnabled", true).commit();
        BackgroundMonitorService service = service(true);
        Field running = BackgroundMonitorService.class.getDeclaredField("running");
        running.setAccessible(true); running.setBoolean(service, true);
        Field success = BackgroundMonitorService.class.getDeclaredField("lastSuccessAt");
        success.setAccessible(true);
        JSONObject raw = new JSONObject().put("soc", 50).put("data_quality", "ok").put("status", "Discharging");
        JSONObject status = new JSONObject().put("loginfo", "ok").put("realtime_rx_thrpt", "2048")
            .put("battery_gauge", BatteryGaugeReading.read(raw, "0", "http://192.168.0.1:88/state.json", System.currentTimeMillis()));
        JSONObject snapshot = new JSONObject().put("status", status).put("timestamp", System.currentTimeMillis());
        Method apply = BackgroundMonitorService.class.getDeclaredMethod("applySnapshotPayload", String.class, String.class);
        apply.setAccessible(true);
        apply.invoke(service, snapshot.toString(), "foreground");
        long received = success.getLong(service);
        assertTrue("live overlay values still accept foreground dashboard snapshots", received > 0);
        assertFalse(new File(directory, "battery_history.json").exists());
        assertFalse(new File(directory, "monitor-live.json").exists());
        assertFalse(new File(directory, "monitor-snapshots").exists());
        service.onStartCommand(new Intent(ACTION).putExtra("enabled", false), 0, 1);
        apply.invoke(service, snapshot.toString(), "foreground");
        Method nativeApply = BackgroundMonitorService.class.getDeclaredMethod("applySnapshotPayload", String.class, String.class, long.class);
        nativeApply.setAccessible(true);
        nativeApply.invoke(service, snapshot.toString(), "overlay", 0L);
        assertEquals("queued UI and in-flight native results cannot update disabled overlay", received, success.getLong(service));
        assertFalse(new File(directory, "battery_history.json").exists());
        assertFalse(new File(directory, "monitor-live.json").exists());
    }

    public void testOldPhoneHistoriesAreIgnoredAndPreservedInDeviceMode() throws Exception {
        if (!"gauge88-csv".equals(BatteryProfile.mode())) return;
        File battery = new File(directory, "battery_history.json");
        MonitorHistoryStore.writeJson(new File(directory, "monitor-live.json"), new JSONObject().put("timestamp", System.currentTimeMillis())
            .put("status", new JSONObject().put("loginfo", "ok").put("battery_vol_percent", "99")));
        java.io.FileOutputStream output = new java.io.FileOutputStream(battery);
        output.write("[{\"percent\":99}]".getBytes("UTF-8")); output.close();
        assertEquals("[]", BackgroundMonitorService.readBatteryHistory(context));
        assertEquals("{}", BackgroundMonitorService.readMonitorHistory(context));
        assertTrue("migration leaves old phone files intact", battery.exists());
        assertTrue(new File(directory, "monitor-live.json").exists());
    }
}
