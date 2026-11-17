package cn.mu5120.console;

import org.json.JSONArray;
import org.json.JSONObject;

/** Preserve the original continuous 24-hour factory SOC endpoint slope. */
final class BatteryFactory {
    private BatteryFactory() { }
    static boolean charging(JSONObject status) {
        return status != null && ("1".equals(String.valueOf(status.opt("battery_charging"))) || Boolean.TRUE.equals(status.opt("battery_charging"))
            || "1".equals(String.valueOf(status.opt("external_charging_flag"))) || Boolean.TRUE.equals(status.opt("external_charging_flag")));
    }
    static JSONObject estimate(JSONObject status, JSONArray samples, long now, String endpoint) throws Exception {
        Double percent = BatteryGaugeReading.percent(status);
        boolean charge = status != null && charging(status);
        JSONObject out = new JSONObject().put("timeToFull", BatteryCsv.time("unavailable", "待刷新", 100, null, null))
            .put("runtime", BatteryCsv.time("unavailable", "待刷新", 0, null, null)).put("calculatedAt", now).put("windowSeconds", 0).put("ratePerHour", JSONObject.NULL);
        String key = charge ? "timeToFull" : "runtime"; int target = charge ? 100 : 0;
        if (percent == null || status.has("battery_gauge")) return out;
        out.put(charge ? "runtime" : "timeToFull", BatteryCsv.time("not-applicable", charge ? "充电中" : "未在充电", charge ? 0 : 100, null, null));
        out.put(key, BatteryCsv.time(percent == null ? "unavailable" : "collecting", percent == null ? "待刷新" : "采集中", target, null, null));
        JSONObject first = null, last = null;
        String normalizedEndpoint = BatteryGaugeReading.normalizeBatteryEndpoint(endpoint);
        for (int i = samples == null ? -1 : samples.length() - 1; i >= 0; i--) {
            JSONObject sample = samples.optJSONObject(i); if (sample == null) continue;
            JSONObject measurement = sample.optJSONObject("measurement");
            String source = sample.optString("percentSource", measurement == null ? "router" : measurement.optString("percentageSource", "router"));
            if (!"router".equals(source)) continue;
            String sampleEndpoint = BatteryGaugeReading.normalizeBatteryEndpoint(sample.optString("percentEndpoint", measurement == null ? "" : measurement.optString("endpoint", "")));
            if (!sampleEndpoint.isEmpty() && !sampleEndpoint.equals(normalizedEndpoint)) continue;
            long time = sample.optLong("timestamp", 0); if (time > now) continue;
            if (time < now - 24L * 3600000 || !(sample.opt("charging") instanceof Boolean) || Boolean.TRUE.equals(sample.opt("charging")) != charge) break;
            if (last == null) last = sample; first = sample;
        }
        if (first != null && last != null) {
            long span = last.getLong("timestamp") - first.getLong("timestamp"); double hours = span / 3600000.0;
            double delta = (last.getDouble("percent") - first.getDouble("percent")) * (charge ? 1 : -1);
            if (hours >= 0.15 && delta > 0) {
                double minutes = (charge ? 100 - percent : percent) / (delta / hours) * 60;
                if (Double.isFinite(minutes)) out.put(key, BatteryCsv.time("estimated", "", target, minutes, "soc-slope"))
                    .put("windowSeconds", span / 1000.0).put("ratePerHour", delta / hours);
            }
        }
        return out;
    }
}
