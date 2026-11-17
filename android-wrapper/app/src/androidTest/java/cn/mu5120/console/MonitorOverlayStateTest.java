package cn.mu5120.console;

import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.test.AndroidTestCase;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

/** Reproduces different UI/service preference caches without starting a collector. */
public final class MonitorOverlayStateTest extends AndroidTestCase {
    private static final String ACTION = "cn.mu5120.console.monitor.OVERLAY";
    private SharedPreferences preferences;
    private RecordingContext context;

    private final class RecordingContext extends ContextWrapper {
        Intent command;
        RecordingContext(Context base) { super(base); }
        @Override public Context getApplicationContext() { return this; }
        @Override public SharedPreferences getSharedPreferences(String name, int mode) { return preferences; }
        @Override public ComponentName startForegroundService(Intent intent) { command = intent; return intent.getComponent(); }
        @Override public ComponentName startService(Intent intent) { command = intent; return intent.getComponent(); }
    }

    @Override protected void setUp() throws Exception {
        super.setUp();
        preferences = getContext().getSharedPreferences("overlay-test-" + System.nanoTime(), Context.MODE_PRIVATE);
        context = new RecordingContext(getContext());
    }

    @Override protected void tearDown() throws Exception {
        preferences.edit().clear().commit();
        super.tearDown();
    }

    public void testResumeCarriesTheUiPreferenceInsteadOfConsultingTheServiceCache() {
        preferences.edit().putBoolean("overlayEnabled", false).commit();
        BackgroundMonitorService.refreshOverlay(context);
        assertNotNull(context.command);
        assertTrue("resume must carry the UI's current choice", context.command.hasExtra("enabled"));
        assertFalse(context.command.getBooleanExtra("enabled", true));
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
}
