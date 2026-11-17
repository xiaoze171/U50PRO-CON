package cn.mu5120.console;

import java.lang.reflect.Method;
import java.lang.reflect.Field;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import android.content.Context;
import android.content.ContextWrapper;
import org.json.JSONArray;
import org.json.JSONObject;

/** Exercises the actual legacy battery-history read transform without starting an Android service. */
public final class NativeBatteryHistoryTest {
    private static final long T = 1800000000000L;

    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        Method prune = Class.forName("cn.mu5120.console.BackgroundMonitorService")
            .getDeclaredMethod("pruneHistory", JSONArray.class, long.class);
        prune.setAccessible(true);
        JSONArray old = new JSONArray()
            .put(new JSONObject().put("timestamp", T - 90000000).put("percent", 60).put("temperature", 33))
            .put(new JSONObject().put("timestamp", T).put("percent", 50).put("temperature", -80).put("source", "screenOff"))
            .put(new JSONObject().put("timestamp", T + 60000).put("percent", 49).put("temperature", "0").put("charging", false));
        JSONArray clean = (JSONArray) prune.invoke(null, old, T + 120000);
        check(clean.length() == 2, "legacy read retains only the last day");
        check(clean.getJSONObject(0).isNull("temperature"), "legacy battery read must reject -80");
        check(clean.getJSONObject(0).isNull("charging"), "legacy unknown charging stays unknown");
        check("screenOff".equals(clean.getJSONObject(0).getString("source")), "legacy read keeps source");
        check(clean.getJSONObject(1).getDouble("temperature") == 0, "legacy zero temperature survives");
        check(Boolean.FALSE.equals(clean.getJSONObject(1).opt("charging")), "known discharging survives");
        check(clean.getJSONObject(0).has("measurement") && clean.getJSONObject(0).isNull("measurement")
            && clean.getJSONObject(0).has("currentStats") && clean.getJSONObject(0).isNull("currentStats"), "legacy record explicitly clears atomic battery fields");
        testCollectionOwnership();
        testRecordBatteryMinuteDedup(false);
        testRecordBatteryMinuteDedup(true);
        System.out.println("PASS native legacy sanitation, atomic fields and frontend/native collection ownership");
    }

    /** Only the Android Context boundary is supplied; actual recordBattery/file persistence runs. */
    private static final class FileContext extends ContextWrapper {
        private File directory;
        private FileContext() { super(null); }
        @Override public Context getApplicationContext() { return this; }
        @Override public File getFilesDir() { return directory; }
    }

    private static void testRecordBatteryMinuteDedup(boolean gaugeUnknown) throws Exception {
        File directory = Files.createTempDirectory(gaugeUnknown ? "native-record-gauge-" : "native-record-factory-").toFile();
        File history = new File(directory, "battery_history.json");
        try {
            // Android SDK Context constructors are deliberate JVM stubs. Bypass only that
            // constructor so the real service code can use this temporary files directory.
            Class<?> allocator = Class.forName("sun.misc.Unsafe");
            Field field = allocator.getDeclaredField("theUnsafe"); field.setAccessible(true);
            FileContext context = (FileContext) allocator.getMethod("allocateInstance", Class.class).invoke(field.get(null), FileContext.class);
            context.directory = directory;
            Method record = BackgroundMonitorService.class.getDeclaredMethod("recordBattery", Context.class, JSONObject.class,
                JSONObject.class, String.class, long.class, JSONObject.class); record.setAccessible(true);
            long start = System.currentTimeMillis();
            for (long elapsed : new long[] { 0, 1000, 30000, 60000 }) {
                JSONObject status = new JSONObject().put("loginfo", "ok").put("battery_vol_percent", "50")
                    .put("battery_charging", "").put("external_charging_flag", "");
                if (gaugeUnknown) status.put("battery_gauge", BatteryGaugeReading.read(new JSONObject().put("soc", 50)
                    .put("data_quality", "ok").put("status", "Unknown").put("current_ma", 0), "0", "http://fixture.invalid:88/state.json", start + elapsed));
                JSONObject snapshot = new JSONObject().put("timestamp", start + elapsed).put("status", status).put("source", "background");
                BackgroundMonitorService.prepareBatterySnapshot(snapshot, new BatteryCurrentWindow(), true, "http://fixture.invalid");
                record.invoke(null, context, status, new JSONObject(), "background", start + elapsed, snapshot.getJSONObject("battery"));
                JSONArray stored = new JSONArray(new String(Files.readAllBytes(history.toPath()), StandardCharsets.UTF_8));
                check(stored.length() == (elapsed < 60000 ? 1 : 2), (gaugeUnknown ? "unknown gauge" : "empty-flag factory") + " actual recordBattery retains one point per minute");
                check(gaugeUnknown ? stored.getJSONObject(0).isNull("charging") : Boolean.FALSE.equals(stored.getJSONObject(0).opt("charging")),
                    "recordBattery dedup compares the actual serialized nullable charging state");
            }
        } finally {
            Files.deleteIfExists(new File(directory, "battery_history.json.tmp").toPath());
            Files.deleteIfExists(history.toPath()); Files.deleteIfExists(directory.toPath());
        }
    }

    private static void testCollectionOwnership() throws Exception {
        Method prepare;
        try { prepare = Class.forName("cn.mu5120.console.BackgroundMonitorService").getDeclaredMethod("prepareBatterySnapshot", JSONObject.class, BatteryCurrentWindow.class, boolean.class, String.class); }
        catch (NoSuchMethodException error) { throw new AssertionError("collection ownership must distinguish frontend summaries from native integration", error); }
        prepare.setAccessible(true);
        JSONObject raw = new JSONObject().put("soc", 50).put("data_quality", "ok").put("status", "Discharging")
            .put("current_ma", -400).put("capacity_mah_used", 8000).put("boot_id", "fixture-boot");
        JSONObject status = new JSONObject().put("loginfo", "ok").put("battery_charging", "1")
            .put("battery_gauge", BatteryGaugeReading.read(raw, "0", "http://fixture.invalid:88/state.json", T));
        BatteryCurrentWindow window = new BatteryCurrentWindow();
        for (int i = 0; i < 3; i++) {
            raw.put("sample_mono_s", i * 30);
            status.put("battery_gauge", BatteryGaugeReading.read(raw, "0", "http://fixture.invalid:88/state.json", T + i * 30000));
            JSONObject sample = new JSONObject().put("timestamp", T + i * 30000).put("status", status);
            prepare.invoke(null, sample, window, true, "http://fixture.invalid");
            JSONArray updates = sample.getJSONObject("battery").optJSONArray("currentStatsUpdates");
            check(updates != null && updates.length() == (i == 0 ? 0 : 1), "only actual native integration marks updated blocks");
            if (i > 0) {
                JSONObject block = sample.getJSONObject("battery").getJSONArray("currentStats").getJSONObject(0);
                check(block.getString("blockId").equals(updates.getJSONObject(0).getString("blockId"))
                    && block.getLong("revision") == updates.getJSONObject(0).getLong("revision"), "native ownership marks the exact block revision");
            }
        }
        check(window.snapshot().getLong("observedDurationMs") == 60000, "native owner integrates actual sampling intervals");
        JSONObject stats = window.snapshot();
        JSONObject duplicate = new JSONObject().put("timestamp", T + 65000).put("status", status);
        prepare.invoke(null, duplicate, window, true, "http://fixture.invalid");
        check(duplicate.getJSONObject("battery").getJSONArray("currentStatsUpdates").length() == 0,
            "duplicate monotonic readings cannot relabel unchanged historical blocks");
        JSONObject frontend = new JSONObject().put("timestamp", T + 70000).put("status", status)
            .put("battery", new JSONObject().put("measurement", BatteryGaugeReading.normalizeBatteryMeasurement(status))
                .put("currentStats", stats.getJSONArray("currentStats")).put("samples", new JSONArray().put(1)));
        prepare.invoke(null, frontend, window, false, "http://fixture.invalid");
        check(window.snapshot().getLong("observedDurationMs") == 0, "frontend summaries never enter native integrator");
        check(frontend.getJSONObject("battery").getJSONArray("currentStats").getJSONObject(0).getLong("observedDurationMs") == 60000,
            "frontend stats persist without reintegration");
        check(!frontend.getJSONObject("battery").has("samples"), "foreground summary stays compact");
        check(frontend.getJSONObject("battery").getJSONArray("currentStatsUpdates").length() == 0,
            "frontend restore without updates never claims native archival ownership");
        raw.put("sample_mono_s", 90);
        status.put("battery_gauge", BatteryGaugeReading.read(raw, "0", "http://fixture.invalid:88/state.json", T + 90000));
        JSONObject resumed = new JSONObject().put("timestamp", T + 90000).put("status", status);
        prepare.invoke(null, resumed, window, true, "http://fixture.invalid");
        check(window.snapshot().getLong("observedDurationMs") == 0, "native resumes in a fresh collection segment");
    }
}
