package cn.mu5120.console;

import java.io.File;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;

/** Runs the production native store on a JVM with the real org.json implementation. */
public final class MonitorSourceTest {
    private static final long T = 1800000000000L;

    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("u50-source-test-").toFile();
        try {
            MonitorHistoryStore store = new MonitorHistoryStore(root);
            String[] sources = { "foreground", "background", "overlay", "screenOff", "unknown" };
            for (int i = 0; i < sources.length; i++) {
                long timestamp = T + i * 60000 + 1000;
                JSONObject sample = new JSONObject().put("timestamp", timestamp)
                    .put("status", new JSONObject().put("loginfo", "ok").put("battery_vol_percent", "0").put("realtime_rx_thrpt", "12"))
                    .put("signal", new JSONObject().put("lte_rsrp", "-93"))
                    .put("temperature", new JSONObject().put("battery_temp", "33"));
                if (i < 4) sample.put("source", sources[i]);
                check(store.record(sample, timestamp), "one record per new minute");
                check(!store.record(new JSONObject(sample.toString()).put("source", "foreground"), timestamp + 1), "duplicate must not relabel the stored minute");
                // Windows File.renameTo cannot replace an existing file; Android can.
                // Remove only the live cache here so this JVM test exercises the archive.
                new File(root, "monitor-live.json").delete();
            }
            JSONObject result = new MonitorHistoryStore(root).read(T + 301000);
            for (int i = 0; i < sources.length; i++) {
                JSONArray point = result.getJSONObject("chart").getJSONArray("rsrp").getJSONArray(i);
                check(sources[i].equals(point.optString(2)), "chart lost source " + sources[i]);
                check(sources[i].equals(result.getJSONArray("battery").getJSONObject(i).optString("source")), "battery lost source");
                check(sources[i].equals(result.getJSONObject("chart").getJSONObject("temperatures").getJSONArray("battery_temp").getJSONArray(i).optString(2)), "temperature lost source");
                check(result.getJSONObject("sourceCounts").getInt(sources[i]) == 1, "incorrect per-minute count");
            }
            Class<?> type = Class.forName("cn.mu5120.console.CollectionSource");
            java.lang.reflect.Method resolve = type.getDeclaredMethod("resolve", boolean.class, boolean.class, boolean.class);
            check("foreground".equals(resolve.invoke(null, true, false, true)), "delayed page snapshot changed source");
            check("screenOff".equals(resolve.invoke(null, false, false, true)), "screen off must take precedence over overlay");
            check("overlay".equals(resolve.invoke(null, false, true, true)), "visible overlay not recognized");
            check("background".equals(resolve.invoke(null, false, true, false)), "background not recognized");
            System.out.println("PASS native source classification, minute deduplication, restart, chart/battery backfill and counts");
        } finally {
            remove(root);
        }
    }

    private static void remove(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        file.delete();
    }
}
