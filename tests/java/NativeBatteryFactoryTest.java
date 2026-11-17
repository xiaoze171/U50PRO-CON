package cn.mu5120.console;

import java.lang.reflect.Method;
import org.json.JSONArray;
import org.json.JSONObject;

public final class NativeBatteryFactoryTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        Class<?> model;
        try { model = Class.forName("cn.mu5120.console.BatteryFactory"); }
        catch (ClassNotFoundException error) { throw new AssertionError("original native factory SOC slope is required", error); }
        Method estimate = model.getDeclaredMethod("estimate", JSONObject.class, JSONArray.class, long.class, String.class);
        long now = 1800000000000L;
        JSONObject status = new JSONObject().put("battery_vol_percent", "50").put("battery_charging", "0");
        JSONArray history = new JSONArray().put(new JSONObject().put("timestamp", now - 3600000).put("percent", 55).put("charging", false))
            .put(new JSONObject().put("timestamp", now - 1800000).put("percent", 90).put("charging", true).put("percentSource", "gauge88"))
            .put(new JSONObject().put("timestamp", now).put("percent", 50).put("charging", false));
        JSONObject result = (JSONObject) estimate.invoke(null, status, history, now, "http://192.168.0.1");
        check(result.getJSONObject("runtime").getDouble("minutes") == 600, "factory slope uses hour history and excludes gauge history");
        status.put("external_charging_flag", "1");
        history = new JSONArray().put(new JSONObject().put("timestamp", now - 540000).put("percent", 48).put("charging", true))
            .put(new JSONObject().put("timestamp", now).put("percent", 50).put("charging", true));
        result = (JSONObject) estimate.invoke(null, status, history, now, "http://192.168.0.1");
        check(result.getJSONObject("timeToFull").getDouble("minutes") == 225, "external power retains legacy charging at 0.15h boundary");
        history.getJSONObject(0).put("timestamp", now - 539999);
        result = (JSONObject) estimate.invoke(null, status, history, now, "http://192.168.0.1");
        check(result.getJSONObject("timeToFull").isNull("minutes"), "shorter than 0.15h collects");
        status.put("battery_charging", "0").put("external_charging_flag", "0");
        history = new JSONArray().put(new JSONObject().put("timestamp", now - 3600000).put("percent", 55).put("charging", false))
            .put(new JSONObject().put("timestamp", now - 1800000).put("percent", 53).put("charging", JSONObject.NULL))
            .put(new JSONObject().put("timestamp", now).put("percent", 50).put("charging", false));
        result = (JSONObject) estimate.invoke(null, status, history, now, "http://192.168.0.1");
        check(result.getJSONObject("runtime").isNull("minutes"), "unknown charge sample is a factory continuity boundary");
        testRawFactorySamples(now);
        System.out.println("PASS native original factory 24h endpoint slope, gauge exclusion and external power");
    }
    private static void testRawFactorySamples(long now) throws Exception {
        JSONArray samples = new JSONArray();
        JSONObject latest = null;
        for (int i = 0; i < 2; i++) {
            latest = new JSONObject().put("loginfo", "ok").put("battery_vol_percent", i == 0 ? "55" : "50")
                .put("battery_charging", "").put("external_charging_flag", "");
            JSONObject snapshot = new JSONObject().put("timestamp", now - (1 - i) * 3600000L).put("status", latest).put("source", "background");
            BackgroundMonitorService.prepareBatterySnapshot(snapshot, new BatteryCurrentWindow(), true, "http://192.168.0.1");
            JSONObject sample = MonitorHistoryStore.batterySample(snapshot, null);
            check(Boolean.FALSE.equals(sample.opt("charging")), "raw factory empty flags become approved discharging samples");
            samples.put(sample);
        }
        JSONObject estimate = BatteryFactory.estimate(latest, samples, now, "http://192.168.0.1");
        check(estimate.getJSONObject("runtime").getDouble("minutes") == 600, "actual raw factory sample history supports original >=0.15h runtime slope");
        JSONObject unknown = new JSONObject().put("soc", 50).put("status", "Unknown").put("data_quality", "ok").put("current_ma", 0);
        JSONObject gaugeSnapshot = new JSONObject().put("timestamp", now).put("status", new JSONObject().put("loginfo", "ok")
            .put("battery_gauge", BatteryGaugeReading.read(unknown, "0", "http://192.168.0.1:88/state.json", now)));
        BackgroundMonitorService.prepareBatterySnapshot(gaugeSnapshot, new BatteryCurrentWindow(), true, "http://192.168.0.1");
        check(MonitorHistoryStore.batterySample(gaugeSnapshot, null).isNull("charging"), "gauge unknown mode retains unknown charging");
        check(MonitorHistoryStore.chargingValue(new JSONObject()).equals(JSONObject.NULL), "generic legacy missing flags remain unknown");
    }
}
