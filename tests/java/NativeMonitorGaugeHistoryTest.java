package cn.mu5120.console;

import java.io.File;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;

public final class NativeMonitorGaugeHistoryTest {
    private static final long T = 1800000000000L;
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    private static JSONObject sample(long time, String endpoint, boolean valid) throws Exception {
        JSONObject status = new JSONObject().put("loginfo", "ok").put("battery_vol_percent", "50");
        if (endpoint != null) status.put("battery_gauge", new JSONObject().put("url", endpoint)
            .put("state", valid ? "valid" : "unavailable").put("percent", valid ? 20.91 : JSONObject.NULL));
        return new JSONObject().put("timestamp", time).put("status", status).put("source", "background");
    }
    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("u50-gauge-history-").toFile();
        try {
            MonitorHistoryStore store = new MonitorHistoryStore(root);
            String first = "http://192.168.0.1:88/state.json";
            String second = "http://192.168.0.1:89/state.json";
            check(store.record(sample(T + 1000, first, true), T + 1000), "first gauge saved");
            new File(root, "monitor-live.json").delete(); // Windows rename cannot replace a file; Android can.
            check(store.record(sample(T + 1100, null, true), T + 1100), "same-minute factory transition must survive");
            new File(root, "monitor-live.json").delete();
            check(store.record(sample(T + 1200, second, false), T + 1200), "endpoint transition must survive");
            JSONObject live = MonitorHistoryStore.readJson(new File(root, "monitor-live.json"));
            check(second.equals(BatteryGaugeReading.endpoint(live.optJSONObject("status"))), "transition forces live refresh");
            MonitorHistoryStore restarted = new MonitorHistoryStore(root);
            new File(root, "monitor-live.json").delete();
            check(!restarted.record(sample(T + 1300, second, false), T + 1300), "restart must not duplicate same source");
            JSONObject history = restarted.read(T + 1400);
            JSONArray battery = history.getJSONArray("battery");
            check(history.getInt("snapshotCount") == 3, "three transitions archived in order");
            check(battery.length() == 2, "unavailable gauge must not fall back to factory");
            check(battery.getJSONObject(0).getDouble("percent") == 20.91, "archive reconstructs gauge percent");
            check("gauge88".equals(battery.getJSONObject(0).getString("percentSource")), "gauge source retained");
            check(first.equals(battery.getJSONObject(0).getString("percentEndpoint")), "gauge endpoint retained");
            check("router".equals(battery.getJSONObject(1).getString("percentSource")), "factory source retained");
            check(battery.getJSONObject(1).getDouble("percent") == 50, "factory reconstructs original percent");
            testBatteryBlocks();
            testFactoryEndpointBoundary();
            testUnownedRelayedBlocks();
            testOwnedBlockReadingTimestamp();
            System.out.println("PASS native gauge archive, source/address transitions, restart, compact summaries and minute blocks");
        } finally { remove(root); }
    }

    private static JSONObject withBattery(long start, long end, String segment, String state, int revision) throws Exception {
        String endpoint = "http://fixture.invalid:88/state.json";
        JSONObject raw = new JSONObject().put("data_quality", "ok").put("soc", 50).put("status", state)
            .put("current_ma", state.equals("Charging") ? 1000 : 0).put("capacity_mah_used", 8000)
            .put("temp_c", -80).put("voltage_mv", 4000).put("capacity_basis", "fixture").put("usb_online", 1);
        JSONObject status = new JSONObject().put("loginfo", "ok").put("battery_charging", "1").put("battery_temp", "35")
            .put("battery_current", "9999").put("battery_capacity", "9800").put("battery_voltage", "9999")
            .put("battery_gauge", BatteryGaugeReading.read(raw, "0", endpoint, end));
        JSONObject measurement = BatteryGaugeReading.normalizeBatteryMeasurement(status);
        JSONObject block = new JSONObject().put("segmentId", segment).put("blockId", segment + ":" + T)
            .put("revision", revision).put("startAt", start).put("endAt", end).put("integralMaMs", (end - start) * raw.getDouble("current_ma"))
            .put("observedDurationMs", end - start).put("sampleCount", 3).put("identity", BatteryCurrentWindow.identity(measurement, endpoint));
        return new JSONObject().put("timestamp", end).put("status", status).put("source", segment.contains("native") ? "background" : "foreground")
            .put("battery", new JSONObject().put("measurement", measurement).put("mode", measurement.getString("mode"))
                .put("currentStats", new JSONArray().put(block)).put("samples", new JSONArray().put(new JSONObject().put("huge", true)))
                .put("currentStatsUpdates", new JSONArray().put(new JSONObject().put("blockId", block.getString("blockId")).put("revision", revision)))
                .put("timeToFull", new JSONObject().put("minutes", 240).put("state", "estimated"))
                .put("runtime", new JSONObject().put("minutes", 600).put("state", "estimated"))
                .put("calculatedAt", end).put("windowSeconds", 60)
                .put("csvAnalysis", new JSONObject().put("state", "ready").put("source", "device-csv")
                    .put("endpoint", "http://fixture.invalid:88/backup/battery-log.csv")));
    }

    private static void testFactoryEndpointBoundary() throws Exception {
        File root = Files.createTempDirectory("u50-factory-boundary-").toFile();
        try {
            MonitorHistoryStore store = new MonitorHistoryStore(root);
            for (int i = 0; i < 2; i++) {
                JSONObject sample = sample(T + 1000 + i * 1000, null, true);
                JSONObject measurement = BatteryGaugeReading.normalizeBatteryMeasurement(sample.getJSONObject("status"));
                measurement.put("endpoint", "http://fixture-" + i + ".invalid");
                sample.put("battery", new JSONObject().put("measurement", measurement));
                check(store.record(sample, T + 1000 + i * 1000), "factory router endpoint changes retain same-minute boundary");
            }
            JSONArray archived = store.read(T + 3000).getJSONArray("battery");
            check(archived.length() == 2 && "http://fixture-1.invalid".equals(archived.getJSONObject(1).getString("percentEndpoint")),
                "factory archived provenance uses measurement endpoint");
        } finally { remove(root); }
    }

    private static int blockCount(JSONObject history) throws Exception {
        int count = 0;
        JSONArray samples = history.getJSONArray("battery");
        for (int i = 0; i < samples.length(); i++) if (samples.getJSONObject(i).optJSONObject("currentStats") != null) count++;
        return count;
    }

    private static void testUnownedRelayedBlocks() throws Exception {
        File root = Files.createTempDirectory("u50-first-relayed-reading-").toFile();
        try {
            MonitorHistoryStore store = new MonitorHistoryStore(root);
            JSONObject relayed = withBattery(T, T + 60000, "remote-original", "Charging", 2).put("timestamp", T + 90000);
            JSONObject battery = relayed.getJSONObject("battery");
            battery.remove("currentStatsUpdates");
            battery.getJSONObject("measurement").put("rawSoc", 49);
            store.record(relayed, T + 90000);
            check(blockCount(store.read(T + 91000)) == 0, "first-seen relay cannot bind historical stats to the receiver's current SOC/source");
            JSONObject live = MonitorHistoryStore.readJson(new File(root, "monitor-live.json")).getJSONObject("battery");
            check(live.getJSONArray("currentStats").length() == 1, "unowned stats remain available in the live estimation window");
            check(live.getJSONArray("currentStatsUpdates").length() == 0, "legacy summaries do not gain collection ownership");
            store = new MonitorHistoryStore(root);
            check(blockCount(store.read(T + 92000)) == 0, "restart and live fallback cannot manufacture relay archives");
            JSONObject block = battery.getJSONArray("currentStats").getJSONObject(0);
            for (Object revision : new Object[] { 1, "2" }) {
                battery.put("currentStatsUpdates", new JSONArray().put(new JSONObject().put("blockId", block.getString("blockId")).put("revision", revision)));
                relayed.put("timestamp", relayed.getLong("timestamp") + 10000);
                store.record(relayed, relayed.getLong("timestamp"));
                check(blockCount(store.read(relayed.getLong("timestamp") + 1000)) == 0, "only an exact numeric block revision may authorize archival");
            }
        } finally { remove(root); }
    }

    private static void testOwnedBlockReadingTimestamp() throws Exception {
        File root = Files.createTempDirectory("u50-relayed-reading-").toFile();
        try {
            MonitorHistoryStore store = new MonitorHistoryStore(root);
            JSONObject relayed = withBattery(T, T + 10000, "relayed", "Charging", 1).put("timestamp", T + 30000);
            store.record(relayed, T + 30000);
            JSONObject later = new JSONObject(relayed.toString()).put("timestamp", T + 40000);
            later.getJSONObject("battery").getJSONObject("measurement").put("rawSoc", 60);
            later.put("source", "background");
            later.getJSONObject("battery").put("currentStatsUpdates", new JSONArray());
            later.getJSONObject("battery").getJSONArray("currentStats").getJSONObject(0).put("revision", 2);
            store.record(later, T + 40000);
            JSONArray samples = new MonitorHistoryStore(root).read(T + 41000).getJSONArray("battery");
            boolean found = false;
            for (int i = 0; i < samples.length(); i++) {
                JSONObject sample = samples.getJSONObject(i), stats = sample.optJSONObject("currentStats");
                if (stats == null) continue;
                found = true;
                check(sample.getLong("timestamp") == T + 30000 && stats.getLong("endAt") == T + 10000,
                    "owned aggregate retains independent coverage and actual measurement reception time");
                check(sample.getJSONObject("measurement").getInt("rawSoc") == 50 && "foreground".equals(sample.getString("source")),
                    "unowned higher revision never rewrites the original bound measurement or source");
                check(stats.getInt("revision") == 1, "relay revisions remain live without replacing owned history");
            }
            check(found, "owned aggregate retained");
        } finally { remove(root); }
    }

    private static void testBatteryBlocks() throws Exception {
        File root = Files.createTempDirectory("u50-battery-blocks-").toFile();
        try {
            MonitorHistoryStore store = new MonitorHistoryStore(root);
            JSONObject first = withBattery(T + 1000, T + 10000, "front-a", "Charging", 1);
            store.record(first, T + 10000);
            JSONObject live = MonitorHistoryStore.readJson(new File(root, "monitor-live.json"));
            check(live.has("battery"), "compact battery summary must survive native archive");
            check(!live.getJSONObject("battery").has("samples"), "per-second battery summary excludes full history");
            check(live.getJSONObject("battery").getLong("calculatedAt") == T + 10000, "collector calculation timestamp is preserved");
            check(live.getJSONObject("battery").getJSONObject("timeToFull").getInt("minutes") == 240
                && live.getJSONObject("battery").getJSONObject("runtime").getInt("minutes") == 600,
                "local compact summary preserves independent charging and runtime results");
            check(live.getJSONObject("battery").getInt("windowSeconds") == 60
                && "device-csv".equals(live.getJSONObject("battery").getJSONObject("csvAnalysis").getString("source"))
                && "http://fixture.invalid:88/backup/battery-log.csv".equals(
                    live.getJSONObject("battery").getJSONObject("csvAnalysis").getString("endpoint")),
                "local recovery retains calculation coverage and the device CSV provenance");
            MonitorHistoryStore restarted = new MonitorHistoryStore(root);
            JSONObject restored = restarted.read(T + 10000).getJSONObject("live").getJSONObject("battery");
            check(restored.getJSONObject("runtime").getInt("minutes") == 600
                && restored.getLong("calculatedAt") == T + 10000,
                "independent estimate and calculation timestamp survive local service restart");
            store.record(withBattery(T + 1000, T + 15000, "front-a", "Charging", 2), T + 15000);
            store.record(withBattery(T + 20000, T + 30000, "native-b", "Charging", 1), T + 30000);
            store.record(withBattery(T + 40000, T + 50000, "front-c", "Charging", 1), T + 50000);
            JSONObject all = store.read(T + 51000);
            JSONArray samples = all.getJSONArray("battery"); int blockCount = 0; long coverage = 0;
            for (int i = 0; i < samples.length(); i++) {
                JSONObject item = samples.getJSONObject(i), block = item.optJSONObject("currentStats");
                if (block == null) continue;
                blockCount++; coverage += block.getLong("observedDurationMs");
                check(item.getJSONObject("measurement").getDouble("netCurrentMa") == 1000, "current remains same-source");
                check(item.isNull("temperature"), "invalid software temperature cannot borrow factory temperature");
                check(item.getDouble("capacity") == 8000 && item.getDouble("voltage") == 4000, "software capacity and voltage remain same-source");
                if (block.getString("segmentId").equals("front-a")) check(block.getInt("revision") == 2, "higher block revision replaces");
            }
            check(blockCount == 3 && coverage == 34000, "front/background/front keeps three non-overlapping blocks without duplicate integrals");
            store.record(withBattery(T + 52000, T + 53000, "front-full", "Full", 1), T + 53000);
            store.record(withBattery(T + 54000, T + 55000, "front-external", "Not charging", 1), T + 55000);
            all = store.read(T + 56000);
            boolean confirming = false, external = false;
            for (int i = 0; i < all.getJSONArray("battery").length(); i++) {
                JSONObject m = all.getJSONArray("battery").getJSONObject(i).optJSONObject("measurement");
                if (m != null) { confirming |= m.optString("mode").equals("confirming"); external |= m.optString("mode").equals("external"); }
            }
            check(confirming && external, "same-minute Full and external state boundaries retained");
            JSONObject old = withBattery(T + 54000, T + 56000, "front-external", "Not charging", 2); old.remove("battery");
            store.record(old, T + 61000);
            live = MonitorHistoryStore.readJson(new File(root, "monitor-live.json"));
            check(live.getJSONObject("battery").isNull("measurement") && live.getJSONObject("battery").isNull("currentStats"), "old payload clears new atomic fields");
        } finally { remove(root); }
    }
    private static void remove(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        file.delete();
    }
}
