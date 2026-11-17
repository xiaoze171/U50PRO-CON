package cn.mu5120.console;

import org.json.JSONObject;
import org.json.JSONArray;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import java.lang.reflect.Method;
import java.util.Iterator;

/** Gauge freshness, authoritative selection and endpoint regression tests. */
public final class NativeBatteryGaugeTest {
    private static final long NOW = 1800000000000L;
    private static final String URL = "http://192.168.0.1:88/state.json";

    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static JSONObject raw(double soc) throws Exception {
        return new JSONObject().put("soc", soc).put("ts", NOW / 1000 + 28800)
            .put("status", "Discharging").put("data_quality", "ok");
    }

    public static void main(String[] args) throws Exception {
        JSONObject marker = BatteryGaugeReading.read(raw(21.126), "0", URL, NOW);
        check(marker.optLong("capturedAt") == NOW && marker.optLong("validUntil") == NOW + 5000, "marker records its original capture freshness deadline");
        JSONObject aging = BatteryGaugeReading.read(raw(50), "4.5", URL, NOW);
        check(aging.getLong("validUntil") == NOW + 500, "header age reduces remaining valid lifetime");
        check("valid".equals(BatteryGaugeReading.freshAt(aging, NOW + 500).getString("state")), "exact five-second boundary stays valid");
        check("stale".equals(BatteryGaugeReading.freshAt(aging, NOW + 501).getString("state")) && "valid".equals(aging.getString("state")), "delayed processing expires without mutating captured marker");
        JSONObject delayedSnapshot = new JSONObject().put("timestamp", NOW + 501).put("status", new JSONObject().put("battery_gauge", aging));
        BackgroundMonitorService.prepareBatterySnapshot(delayedSnapshot, new BatteryCurrentWindow(), true, URL);
        check(delayedSnapshot.getJSONObject("battery").isNull("measurement"), "delayed native dashboard never normalizes expired capture");
        check(marker.getDouble("percent") == 21.13, "fresh header overrides router clock skew");
        check(marker.getJSONObject("raw").getDouble("soc") == 21.126, "raw SOC retained");
        JSONObject status = new JSONObject().put("battery_vol_percent", "50").put("battery_gauge", marker);
        check(BatteryGaugeReading.percent(status) == 21.13, "gauge replaces factory 50");
        check("gauge88".equals(BatteryGaugeReading.source(status)), "gauge provenance");
        check(URL.equals(BatteryGaugeReading.endpoint(status)), "endpoint provenance");
        for (String age : new String[] { "6", "-1", "", "NaN" }) {
            JSONObject stale = BatteryGaugeReading.read(raw(21), age, URL, NOW);
            check("stale".equals(stale.getString("state")), "invalid or old header rejected: " + age);
            status.put("battery_gauge", stale);
            check(BatteryGaugeReading.percent(status) == null, "stale gauge never falls back to factory");
        }
        check(BatteryGaugeReading.read(raw(0), "5", URL, NOW).getDouble("percent") == 0, "zero and age boundary retained");
        check("valid".equals(BatteryGaugeReading.read(raw(21).put("ts", NOW / 1000 - 4), null, URL, NOW).getString("state")), "absent header uses timestamp");
        check(BatteryGaugeReading.read(raw(21).put("ts", NOW / 1000.0 - 4), "", URL, NOW).getLong("validUntil") == NOW + 1000,
            "empty header uses timestamp fallback and keeps exact expiry");
        check("stale".equals(BatteryGaugeReading.read(raw(21), null, URL, NOW).getString("state")), "future timestamp rejected without header");
        check(BatteryGaugeReading.read(raw(99.999), "1", URL, NOW).getDouble("percent") == 99.99, "rounding cannot fabricate full charge");
        check(BatteryGaugeReading.read(raw(100).put("status", "Charging").put("full_confirmed", false), "1", URL, NOW).getDouble("percent") == 99.99, "unconfirmed charging full capped");
        check(BatteryGaugeReading.read(raw(100).put("status", "Full").put("full_confirmed", false), "1", URL, NOW).getDouble("percent") == 99.99, "unconfirmed Full capped");
        check(BatteryGaugeReading.read(raw(100).put("full_confirmed", true), "1", URL, NOW).getDouble("percent") == 100, "confirmed full retained");
        for (Object soc : new Object[] { "21", true, -1, 101, JSONObject.NULL }) {
            check("invalid".equals(BatteryGaugeReading.read(raw(21).put("soc", soc), "0", URL, NOW).getString("state")), "invalid SOC rejected");
        }
        check("invalid".equals(BatteryGaugeReading.read(raw(21).put("data_quality", "bad"), "0", URL, NOW).getString("state")), "poor data rejected");
        status.put("battery_gauge", JSONObject.NULL);
        check(BatteryGaugeReading.percent(status) == null, "malformed marker never falls back");
        status.remove("battery_gauge");
        status.put("battery_vol_percent", "0");
        check(BatteryGaugeReading.percent(status) == 0, "legacy factory zero retained");
        check("router".equals(BatteryGaugeReading.source(status)) && BatteryGaugeReading.endpoint(status).isEmpty(), "legacy provenance");
        BatteryGaugeConfig defaults = BatteryGaugeConfig.fromJson(new JSONObject());
        check(URL.equals(defaults.endpoint("http://192.168.0.1:8080/old?query=1")), "default host follows router with independent port/path");
        BatteryGaugeConfig custom = BatteryGaugeConfig.fromJson(new JSONObject().put("batterySource", "gauge").put("batteryHost", "192.168.8.1").put("batteryPort", 188));
        check("https://192.168.8.1:188/state.json".equals(custom.endpoint("https://192.168.0.1")), "custom endpoint preserves router protocol");
        check(!custom.matches(status, "http://192.168.0.1"), "factory snapshot cannot enter gauge config");
        status.put("battery_gauge", marker);
        check(defaults.matches(status, "http://192.168.0.1"), "matching gauge endpoint accepted");
        check(!custom.matches(status, "http://192.168.0.1"), "old gauge endpoint rejected");
        check("http://[::1]:88/state.json".equals(new BatteryGaugeConfig("gauge", "::1", 88).endpoint("http://192.168.0.1")), "IPv6 endpoint is bracketed");
        Method normalize;
        try { normalize = BatteryGaugeReading.class.getDeclaredMethod("normalizeBatteryMeasurement", JSONObject.class); }
        catch (NoSuchMethodException error) { throw new AssertionError("native measurement normalization is required", error); }
        JSONObject fixtures = new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8));
        JSONArray cases = fixtures.getJSONArray("measurementCases");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject test = cases.getJSONObject(i);
            JSONObject actual = (JSONObject) normalize.invoke(null, test.getJSONObject("status"));
            JSONObject expected = test.optJSONObject("expected");
            if (expected == null) { check(actual == null, test.optString("name") + " must have no measurement"); continue; }
            check(actual != null, test.optString("name") + " must normalize");
            Iterator<String> keys = expected.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object want = expected.get(key), got = actual.opt(key);
                check(want instanceof Number && got instanceof Number
                    ? Math.abs(((Number) want).doubleValue() - ((Number) got).doubleValue()) < 1e-9
                    : want.equals(got), test.optString("name") + ": " + key + " expected=" + want + " actual=" + got);
            }
        }
        JSONObject factory = new JSONObject().put("battery_vol_percent", "0x1p4");
        check(BatteryGaugeReading.normalizeBatteryMeasurement(factory) == null, "factory normalization accepts decimal strings only");
        factory.put("battery_vol_percent", "5e1").put("battery_charging", 0.0)
            .put("percentEndpoint", "HTTP://Fixture.invalid:80/router/?x=1#fragment");
        JSONObject normalized = BatteryGaugeReading.normalizeBatteryMeasurement(factory);
        check("discharging".equals(normalized.getString("mode")), "floating-point numeric factory zero is disabled");
        check("http://fixture.invalid/router".equals(normalized.getString("endpoint")), "factory normalized measurement retains endpoint");
        JSONObject identityStrings = raw(50).put("boot_id", " boot ").put("capacity_basis", " basis ");
        normalized = BatteryGaugeReading.normalizeBatteryMeasurement(new JSONObject().put("battery_gauge", BatteryGaugeReading.read(identityStrings, "0", URL, NOW)));
        check(" boot ".equals(normalized.getString("bootId")) && " basis ".equals(normalized.getString("capacityBasis")), "nonempty identity strings preserve exact identity");
        check(MonitorHistoryStore.sanitizeMeasurement(new JSONObject(normalized.toString()).put("schemaVersion", "2")) == null, "schema version must be numeric");
        check("unknown".equals(MonitorHistoryStore.sanitizeMeasurement(new JSONObject(normalized.toString()).put("mode", "unexpected")).getString("mode")), "unknown serialized modes stay unknown");
        System.out.println("PASS native gauge freshness, precision, source isolation and shared measurement fixtures=" + cases.length());
    }
}
