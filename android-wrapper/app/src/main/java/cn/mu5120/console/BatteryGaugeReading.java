package cn.mu5120.console;

import org.json.JSONObject;
import org.json.JSONArray;
import java.net.URI;
import java.util.Locale;

/** The gauge marker is authoritative even when its reading is unavailable. */
final class BatteryGaugeReading {
    private BatteryGaugeReading() {}

    static JSONObject read(JSONObject raw, String ageHeader, String url, long nowMs) throws Exception {
        JSONObject result = new JSONObject().put("percent", JSONObject.NULL).put("state", "invalid")
            .put("url", url == null ? "" : url).put("raw", raw == null ? JSONObject.NULL : raw)
            .put("capturedAt", nowMs).put("validUntil", JSONObject.NULL);
        if (raw == null) return result;
        Double age;
        boolean hasAgeHeader = ageHeader != null && !ageHeader.trim().isEmpty();
        if (hasAgeHeader) {
            age = number(ageHeader);
        } else {
            Double timestamp = numeric(raw.opt("ts"));
            age = timestamp == null ? null : nowMs / 1000.0 - timestamp;
        }
        if (age == null || age < 0 || age > 5) return result.put("state", "stale");
        result.put("validUntil", hasAgeHeader ? nowMs + (5 - age) * 1000 : numeric(raw.opt("ts")) * 1000 + 5000);
        Double soc = numeric(raw.opt("soc"));
        if (!"ok".equals(raw.optString("data_quality")) || soc == null || soc < 0 || soc > 100) return result;
        String status = raw.optString("status");
        boolean pendingFull = ("Charging".equals(status) || "Full".equals(status))
            && Boolean.FALSE.equals(raw.opt("full_confirmed"));
        double percent = Math.min(Math.round(soc * 100.0) / 100.0, soc < 100 || pendingFull ? 99.99 : 100.0);
        return result.put("percent", percent).put("state", "valid");
    }

    static JSONObject freshAt(JSONObject marker, long nowMs) throws Exception {
        if (marker == null || !"valid".equals(marker.optString("state"))) return marker;
        Double captured = numeric(marker.opt("capturedAt")), deadline = numeric(marker.opt("validUntil"));
        if (deadline == null) return marker; // Old payloads use the enclosing snapshot's freshness gate.
        if (nowMs > deadline || captured != null && nowMs < captured)
            return new JSONObject(marker.toString()).put("state", "stale").put("percent", JSONObject.NULL);
        return marker;
    }

    static void refreshStatus(JSONObject status, long nowMs) throws Exception {
        if (status != null && status.has("battery_gauge"))
            status.put("battery_gauge", orNull(freshAt(status.optJSONObject("battery_gauge"), nowMs)));
    }

    static Double percent(JSONObject status) {
        if (status == null) return null;
        if (status.has("battery_gauge")) {
            JSONObject marker = status.optJSONObject("battery_gauge");
            if (marker == null || !"valid".equals(marker.optString("state"))) return null;
            Double value = numeric(marker.opt("percent"));
            return value != null && value >= 0 && value <= 100 ? value : null;
        }
        Double value = number(status.opt("battery_vol_percent"));
        return value != null ? value : number(status.opt("battery_value"));
    }

    static String source(JSONObject status) {
        return status != null && status.has("battery_gauge") ? "gauge88" : "router";
    }

    static String endpoint(JSONObject status) {
        JSONObject marker = status == null ? null : status.optJSONObject("battery_gauge");
        return marker == null ? "" : marker.optString("url", "");
    }

    static JSONObject normalizeBatteryMeasurement(JSONObject status) throws Exception {
        if (status == null) return null;
        boolean gauge = status.has("battery_gauge");
        JSONObject marker = status.optJSONObject("battery_gauge");
        JSONObject raw = marker == null ? null : marker.optJSONObject("raw");
        Double soc;
        if (gauge) {
            if (marker == null || !"valid".equals(marker.optString("state")) || raw == null
                || !"ok".equals(raw.optString("data_quality"))) return null;
            soc = numeric(raw.opt("soc"));
        } else {
            soc = factoryNumber(status.opt("battery_vol_percent"));
            if (soc == null) soc = factoryNumber(status.opt("battery_value"));
        }
        if (soc == null || soc < 0 || soc > 100) return null;
        Double current = gauge ? numeric(raw.opt("current_ma")) : null;
        Double capacity = gauge ? numeric(raw.opt("capacity_mah_used")) : null;
        if (capacity != null && capacity <= 0) capacity = null;
        boolean external = gauge ? one(raw.opt("usb_online"), false) || Boolean.TRUE.equals(raw.opt("direct_supply"))
            : one(status.opt("external_charging_flag"), true);
        boolean confirmed = gauge && Boolean.TRUE.equals(raw.opt("full_confirmed"));
        boolean anchored = gauge && Boolean.TRUE.equals(raw.opt("full_anchor_valid"));
        String mode = "unknown";
        if (gauge) {
            String state = raw.optString("status");
            if ("Charging".equals(state)) mode = current != null && current <= -50 ? "unknown" : "charging";
            else if ("Discharging".equals(state)) mode = current != null && current >= 50 ? "unknown" : "discharging";
            else if ("Full".equals(state)) mode = current != null && current <= -50 ? "unknown" : confirmed ? "full" : "confirming";
            else if ("Not charging".equals(state)) {
                mode = current != null && current <= -50 ? "discharging"
                    : current != null && current >= 50 ? "unknown" : external ? "external" : "unknown";
            }
        } else {
            Object charging = status.opt("battery_charging");
            if (one(charging, true)) mode = "charging";
            else if (Boolean.FALSE.equals(charging) || charging instanceof Number && ((Number) charging).doubleValue() == 0 || "0".equals(charging)) mode = external ? "external" : "discharging";
            else if (external) mode = "external";
        }
        String anchor = gauge ? new JSONArray().put(anchored).put(orNull(numeric(raw.opt("full_anchor_ts"))))
            .put(orNull(numeric(raw.opt("full_anchor_voltage_mv")))).toString() : null;
        return new JSONObject().put("schemaVersion", 2).put("rawSoc", soc).put("mode", mode)
            .put("netCurrentMa", orNull(current)).put("voltageMv", orNull(gauge ? numeric(raw.opt("voltage_mv")) : null))
            .put("netPowerW", orNull(gauge ? numeric(raw.opt("power_w")) : null)).put("usableCapacityMah", orNull(capacity))
            .put("capacityBasis", orNull(gauge ? text(raw.opt("capacity_basis")) : null)).put("externalPower", external)
            .put("fullConfirmed", confirmed).put("fullAnchorValid", anchored)
            .put("fullStableSeconds", orNull(gauge ? nonnegative(raw.opt("full_stable_s")) : null))
            .put("eodImminent", gauge && Boolean.TRUE.equals(raw.opt("eod_imminent")))
            .put("eodClamp", gauge && Boolean.TRUE.equals(raw.opt("eod_clamp")))
            .put("bootId", orNull(gauge ? text(raw.opt("boot_id")) : null))
            .put("sampleMonoSeconds", orNull(gauge ? nonnegative(raw.opt("sample_mono_s")) : null))
            .put("anchorIdentity", orNull(anchor)).put("percentageSource", source(status))
            .put("endpoint", normalizeBatteryEndpoint(gauge ? endpoint(status) : text(status.opt("percentEndpoint"))));
    }

    static String normalizeBatteryEndpoint(String value) {
        String input = value == null ? "" : value.trim();
        try {
            URI uri = new URI(input).normalize();
            if (uri.getScheme() == null || uri.getHost() == null) return input.replaceAll("/+$", "");
            String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            if (host.contains(":") && !host.startsWith("[")) host = "[" + host + "]";
            int port = uri.getPort();
            if (("http".equals(scheme) && port == 80) || ("https".equals(scheme) && port == 443)) port = -1;
            return scheme + "://" + host + (port < 0 ? "" : ":" + port) + uri.getRawPath().replaceAll("/+$", "");
        } catch (Exception ignored) { return input.replaceAll("/+$", ""); }
    }

    static TemperatureReading temperature(JSONObject temperatures, JSONObject status) {
        if (status != null && status.has("battery_gauge")) {
            JSONObject marker = status.optJSONObject("battery_gauge");
            JSONObject raw = marker == null || !"valid".equals(marker.optString("state")) ? null : marker.optJSONObject("raw");
            return TemperatureReading.read("battery_temp", raw == null ? null : raw.opt("temp_c"));
        }
        return TemperatureReading.battery(temperatures, status);
    }

    static Object orNull(Object value) { return value == null ? JSONObject.NULL : value; }
    private static boolean one(Object value, boolean strings) {
        return Boolean.TRUE.equals(value) || value instanceof Number && ((Number) value).doubleValue() == 1
            || strings && "1".equals(value);
    }
    private static String text(Object value) { return value instanceof String && !((String) value).trim().isEmpty() ? (String) value : null; }
    private static Double nonnegative(Object value) { Double n = numeric(value); return n != null && n >= 0 ? n : null; }

    static Double numeric(Object value) {
        if (!(value instanceof Number)) return null;
        double number = ((Number) value).doubleValue();
        return Double.isNaN(number) || Double.isInfinite(number) ? null : number;
    }

    private static Double factoryNumber(Object value) {
        if (value instanceof Number) return numeric(value);
        if (!(value instanceof String) || !((String) value).trim().matches("(?i)[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?")) return null;
        return number(value);
    }

    private static Double number(Object value) {
        if (value == null || value == JSONObject.NULL || value instanceof Boolean) return null;
        if (value instanceof Number) return numeric(value);
        try {
            double number = Double.parseDouble(String.valueOf(value).trim());
            return Double.isNaN(number) || Double.isInfinite(number) ? null : number;
        } catch (NumberFormatException ignored) { return null; }
    }
}
