package cn.mu5120.console;

import org.json.JSONObject;

public final class NativeBatteryProfileTest {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    public static void main(String[] args) throws Exception {
        BatteryGaugeConfig migrated = BatteryGaugeConfig.fromJson(new JSONObject()
            .put("batterySource", "gauge").put("batteryHost", "192.168.8.1").put("batteryPort", 188));
        check(migrated.port == 88, "saved gauge port must migrate to fixed 88");
        String profile = args[1];
        check(("factory".equals(profile) ? "factory" : "gauge").equals(migrated.source),
            "saved source cannot override branch profile");
        check("http://192.168.8.1:88/state.json".equals(migrated.endpoint("http://192.168.0.1")), "host retained");
        long now = 1800000000000L;
        JSONObject raw = new JSONObject().put("data_quality", "ok").put("ts", 1800000000)
            .put("soc", 50).put("status", "Discharging").put("current_ma", -500);
        JSONObject summary = new JSONObject().put("timeToFull", new JSONObject().put("state", "not-applicable"))
            .put("runtime", new JSONObject().put("minutes", 600).put("state", "estimated"))
            .put("calculatedAt", now).put("windowSeconds", 3600)
            .put("csvAnalysis", new JSONObject().put("state", "ready").put("source", "device-csv"));
        JSONObject snapshot = new JSONObject().put("timestamp", now).put("status", new JSONObject()
            .put("battery_gauge", BatteryGaugeReading.read(raw, "0", "http://192.168.0.1:88/state.json", now)))
            .put("battery", summary);
        BackgroundMonitorService.prepareBatterySnapshot(snapshot, new BatteryCurrentWindow(), true, "http://192.168.0.1");
        JSONObject preserved = snapshot.getJSONObject("battery");
        check(preserved.getJSONObject("runtime").getInt("minutes") == 600, "native preparation retains collector CSV estimate");
        check("device-csv".equals(preserved.getJSONObject("csvAnalysis").getString("source")), "compact summary retains CSV provenance");
        check(preserved.getLong("calculatedAt") == now, "collector calculation timestamp retained");
        check("gauge88".equals(preserved.getString("percentSource")) && "http://192.168.0.1:88/state.json".equals(preserved.getString("percentEndpoint")), "native common summary exposes gauge source and endpoint");
        check(Boolean.FALSE.equals(preserved.opt("charging")), "native gauge discharging summary exposes charging false");
        JSONObject compact = MonitorHistoryStore.compactBattery(preserved);
        check("gauge88".equals(compact.getString("percentSource")) && Boolean.FALSE.equals(compact.opt("charging")), "history compact summary retains source and charging fields");
        snapshot.put("timestamp", now + 5001);
        BackgroundMonitorService.prepareBatterySnapshot(snapshot, new BatteryCurrentWindow(), true, "http://192.168.0.1");
        check(snapshot.getJSONObject("battery").getJSONObject("runtime").isNull("minutes"), "expired live marker clears an earlier collector numeric estimate");
        check("gauge88".equals(snapshot.getJSONObject("battery").getString("percentSource"))
            && "http://192.168.0.1:88/state.json".equals(snapshot.getJSONObject("battery").getString("percentEndpoint"))
            && snapshot.getJSONObject("battery").isNull("charging"), "unavailable gauge summary retains source endpoint and unknown charging");
        JSONObject factory = new JSONObject().put("timestamp", now).put("status", new JSONObject().put("loginfo", "ok")
            .put("battery_vol_percent", "50").put("battery_charging", "").put("external_charging_flag", ""));
        BackgroundMonitorService.prepareBatterySnapshot(factory, new BatteryCurrentWindow(), true, "HTTP://Router.invalid:80/");
        JSONObject factorySummary = MonitorHistoryStore.compactBattery(factory.getJSONObject("battery"));
        check("router".equals(factorySummary.getString("percentSource")) && "http://router.invalid".equals(factorySummary.getString("percentEndpoint"))
            && Boolean.FALSE.equals(factorySummary.opt("charging")), "native factory common summary uses normalized endpoint and original empty-flag discharging semantics");
        System.out.println("PASS native branch profile migration and collector provenance");
    }
}
