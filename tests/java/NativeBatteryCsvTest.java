package cn.mu5120.console;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.lang.reflect.Method;
import java.lang.reflect.InvocationTargetException;
import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONObject;

public final class NativeBatteryCsvTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        Class<?> model;
        try { model = Class.forName("cn.mu5120.console.BatteryCsv"); }
        catch (ClassNotFoundException error) { throw new AssertionError("native device CSV estimator is required", error); }
        Method parse = model.getDeclaredMethod("parse", String.class);
        Method estimate = model.getDeclaredMethod("estimate", JSONObject.class, JSONObject.class, Double.class, long.class);
        StringBuilder csv = new StringBuilder("ts,ts_iso,soc,voltage_mv,current_ma,power_w,temp_c,status\n");
        long deviceNow = 1800000000;
        for (int i = 0; i <= 60; i++) csv.append(deviceNow - 3600 + i * 60).append(",unused,")
            .append(55 - i / 12.0).append(",3800,-500,-1.9,25,Discharging\n");
        JSONObject measurement = new JSONObject().put("schemaVersion", 2).put("rawSoc", 50).put("mode", "discharging")
            .put("percentageSource", "gauge88").put("netCurrentMa", -500).put("usableCapacityMah", 8000);
        JSONObject parsed = (JSONObject) parse.invoke(null, csv.toString());
        JSONObject actual = (JSONObject) estimate.invoke(null, parsed, measurement, Double.valueOf(deviceNow), 1000000L);
        check(Math.abs(actual.getJSONObject("runtime").getDouble("minutes") - 600) < 1e-8,
            "pre-existing device CSV yields 600 minutes despite phone clock offset");
        check(actual.getJSONObject("runtime").getInt("targetPercent") == 0, "runtime targets zero");
        check("ready".equals(actual.getJSONObject("csvAnalysis").getString("state")), "CSV ready provenance");
        JSONObject stale = (JSONObject) estimate.invoke(null, parsed, measurement, Double.valueOf(deviceNow + 121), 1000000L);
        check(stale.getJSONObject("runtime").isNull("minutes"), "stale device CSV has no fallback number");
        if (args.length > 2) {
            JSONObject fixtures = new JSONObject(new String(Files.readAllBytes(Paths.get(args[2])), StandardCharsets.UTF_8));
            JSONArray parsers = fixtures.getJSONArray("parserCases");
            for (int i = 0; i < parsers.length(); i++) {
                JSONObject test = parsers.getJSONObject(i);
                try {
                    JSONObject result = (JSONObject) parse.invoke(null, test.getString("csv"));
                    check(!test.optBoolean("error"), test.optString("name") + " must throw");
                    JSONObject normalized = new JSONObject().put("rows", result.getJSONArray("rows").length())
                        .put("invalidRows", result.getInt("invalidRows")).put("firstRow", result.getJSONArray("rows").opt(0));
                    if (test.has("expected")) compare(test.getJSONObject("expected"), normalized, test.optString("name"));
                } catch (InvocationTargetException error) { check(test.optBoolean("error"), test.optString("name") + ": " + error.getCause()); }
            }
            JSONArray estimates = fixtures.getJSONArray("estimateCases");
            for (int i = 0; i < estimates.length(); i++) {
                JSONObject test = estimates.getJSONObject(i);
                JSONObject result = (JSONObject) estimate.invoke(null, test.isNull("csv") ? null : parse.invoke(null, test.getString("csv")),
                    test.optJSONObject("measurement"), test.isNull("deviceNowSeconds") ? null : Double.valueOf(test.getDouble("deviceNowSeconds")), test.getLong("calculatedAt"));
                compare(test.getJSONObject("expected"), result, test.optString("name"));
            }
            System.out.println("PASS native shared CSV fixtures=" + (parsers.length() + estimates.length()));
        }
        System.out.println("PASS native device CSV 600-minute model, clock offset, stale/no-fallback");
    }
    private static void compare(JSONObject expected, JSONObject actual, String name) throws Exception {
        Iterator<String> keys = expected.keys();
        while (keys.hasNext()) {
            String key = keys.next(); Object want = expected.get(key), got = actual.opt(key);
            if (want instanceof JSONObject) { check(got instanceof JSONObject, name + ": object " + key); compare((JSONObject) want, (JSONObject) got, name + "." + key); }
            else if (want instanceof Number && got instanceof Number) check(Math.abs(((Number) want).doubleValue() - ((Number) got).doubleValue()) < 1e-7, name + "." + key + " expected=" + want + " actual=" + got);
            else check(want.equals(got), name + "." + key + " expected=" + want + " actual=" + got);
        }
    }
}
