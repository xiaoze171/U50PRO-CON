package cn.mu5120.console;

import org.json.JSONObject;
import org.json.JSONArray;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;

/** Shared analytical fixtures exercise real signed-current integration. */
public final class NativeBatteryCurrentWindowTest {
    private static final long T = 1800000000000L;
    private static Class<?> type;
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static Object window() throws Exception { return type.getDeclaredConstructor().newInstance(); }
    private static JSONObject measurement(double current, double mono) throws Exception {
        return new JSONObject().put("schemaVersion", 2).put("rawSoc", 50).put("mode", "discharging")
            .put("percentageSource", "gauge88").put("endpoint", "http://fixture.invalid:88/state.json")
            .put("netCurrentMa", current).put("usableCapacityMah", 8000).put("capacityBasis", "fixture")
            .put("bootId", "fixture-boot").put("anchorIdentity", "fixture-anchor").put("sampleMonoSeconds", mono);
    }
    private static JSONObject ingest(Object w, long time, JSONObject m) throws Exception {
        return (JSONObject) type.getDeclaredMethod("ingest", long.class, String.class, JSONObject.class)
            .invoke(w, time, m.optString("endpoint"), m);
    }
    private static JSONObject snapshot(Object w) throws Exception { return (JSONObject) type.getDeclaredMethod("snapshot").invoke(w); }
    public static void main(String[] args) throws Exception {
        try { type = Class.forName("cn.mu5120.console.BatteryCurrentWindow"); }
        catch (ClassNotFoundException error) { throw new AssertionError("native actual-interval current window is required", error); }
        JSONObject fixtures = new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8));
        JSONArray cases = fixtures.getJSONArray("windowCases");
        for (int n = 0; n < cases.length(); n++) {
            JSONObject test = cases.getJSONObject(n); Object w = window();
            JSONArray times = test.getJSONArray("timesSeconds"), currents = test.getJSONArray("currentsMa");
            for (int i = 0; i < times.length(); i++) ingest(w, T + times.getLong(i) * 1000, measurement(currents.getDouble(i), times.getDouble(i)));
            JSONObject actual = snapshot(w);
            check(Math.abs(actual.getDouble("meanCurrentMa") - test.getDouble("meanCurrentMa")) < 1e-9, test.optString("name") + " mean");
            check(actual.getLong("observedDurationMs") == test.getLong("observedDurationMs"), "actual coverage");
            check(actual.getInt("sampleCount") == test.getInt("sampleCount"), "distinct real samples");
            JSONArray blocks = actual.getJSONArray("currentStats");
            double integral = 0, duration = 0; int count = 0;
            for (int i = 0; i < blocks.length(); i++) {
                JSONObject b = blocks.getJSONObject(i); integral += b.getDouble("integralMaMs"); duration += b.getDouble("observedDurationMs"); count += b.getInt("sampleCount");
                check(!b.getJSONObject("identity").has("segmentId"), "logical identity excludes collection segment");
                check(b.getLong("endAt") - b.getLong("startAt") <= 60000, "blocks split at minute boundaries");
            }
            check(Math.abs(integral / duration - actual.getDouble("meanCurrentMa")) < 1e-9 && count == actual.getInt("sampleCount"), "blocks preserve integral and real count");
            Object restored = window();
            JSONArray duplicate = new JSONArray(blocks.toString());
            for (int i = 0; i < blocks.length(); i++) duplicate.put(blocks.getJSONObject(i));
            type.getDeclaredMethod("restore", JSONArray.class, long.class, JSONObject.class).invoke(restored, duplicate, T + times.getLong(times.length() - 1) * 1000, actual.getJSONObject("identity"));
            check(snapshot(restored).getLong("observedDurationMs") == duration, "live + archive duplicate counted once");
        }
        Object w = window(); ingest(w, T, measurement(-400, 0)); ingest(w, T + 30000, measurement(-400, 30));
        String segment = snapshot(w).getJSONArray("currentStats").getJSONObject(0).getString("segmentId");
        ingest(w, T + 31000, measurement(-400, 30)); ingest(w, T + 32000, measurement(-400, 29));
        check(snapshot(w).getLong("observedDurationMs") == 30000, "duplicate and reversed mono rejected");
        ingest(w, T + 180000, measurement(-400, 180));
        check(snapshot(w).getLong("observedDurationMs") == 0, "gap over 120s never filled");
        ingest(w, T + 210000, measurement(-400, 210));
        check(!segment.equals(snapshot(w).getJSONArray("currentStats").getJSONObject(0).getString("segmentId")), "gap creates unique segment");
        ingest(w, T + 220000, measurement(-400, 220).put("capacityBasis", "changed"));
        check(snapshot(w).getLong("observedDurationMs") == 0, "capacity basis change resets");
        Object other = window(); ingest(other, T, measurement(-400, 0)); ingest(other, T + 30000, measurement(-400, 30));
        check(!segment.equals(snapshot(other).getJSONArray("currentStats").getJSONObject(0).getString("segmentId")), "native instances have globally unique segments");
        testRestoredBoundaries();
        System.out.println("PASS native shared integration fixtures=" + cases.length() + ", minute blocks, restoration, duplicate mono, gaps and identity boundaries");
    }

    private static JSONObject block(String id, long from, long to, int revision) throws Exception {
        return new JSONObject().put("segmentId", id).put("blockId", id + ":" + from / 60000 * 60000).put("revision", revision)
            .put("startAt", from).put("endAt", to).put("integralMaMs", -400 * (to - from)).put("observedDurationMs", to - from)
            .put("sampleCount", 3).put("identity", BatteryCurrentWindow.identity(measurement(-400, 0), "http://fixture.invalid:88/state.json"));
    }
    private static void testRestoredBoundaries() throws Exception {
        JSONObject identity = BatteryCurrentWindow.identity(measurement(-400, 0), "http://fixture.invalid:88/state.json");
        BatteryCurrentWindow w = new BatteryCurrentWindow();
        w.restore(new JSONArray().put(block("old", T, T + 30000, 1)).put(block("new", T + 210000, T + 240000, 1)), T + 240000, identity);
        check(w.snapshot().getLong("observedDurationMs") == 30000, "restoration excludes prior segment across over-120-second gap");
        w.reset(); w.restore(new JSONArray().put(block("stale", T, T + 30000, 1)), T + 180001, identity);
        check(w.snapshot().getLong("observedDurationMs") == 0, "recent-window stats older than gap threshold are not current coverage");
        w.reset();
        w.restore(new JSONArray().put(block("a", T, T + 10000, 1)).put(block("b", T + 20000, T + 30000, 1))
            .put(block("c", T + 40000, T + 50000, 1)), T + 50000, identity);
        check(w.snapshot().getLong("observedDurationMs") == 30000, "distinct same-minute collection blocks all retained");
        w.restore(new JSONArray().put(block("a", T, T + 15000, 2)), T + 50000, identity);
        check(w.snapshot().getLong("observedDurationMs") == 35000, "restore incrementally merges higher revisions without discarding other blocks");
        JSONObject malformed = block("bad", T + 51000, T + 52000, 1); malformed.getJSONObject("identity").put("percentageSource", "invalid");
        check(BatteryCurrentWindow.validateStats(malformed) == null, "invalid source identity rejected");
        malformed = block("bad", T + 51000, T + 52000, 1).put("sampleCount", "3");
        check(BatteryCurrentWindow.validateStats(malformed) == null, "string counts rejected");
        w.reset(); w.ingest(T, identity.getString("endpoint"), measurement(-400, 0)); w.ingest(T + 10000, identity.getString("endpoint"), measurement(-400, 10));
        w.restore(new JSONArray().put(block("background", T + 20000, T + 40000, 1)), T + 40000, identity);
        check(w.snapshot().getLong("observedDurationMs") == 30000, "restore preserves prior nonoverlapping foreground coverage");
        w.ingest(T + 50000, identity.getString("endpoint"), measurement(-400, 50));
        check(w.snapshot().getLong("observedDurationMs") == 30000, "first sample after handoff never bridges another collector interval");
        w.ingest(T + 60000, identity.getString("endpoint"), measurement(-400, 60));
        check(w.snapshot().getLong("observedDurationMs") == 40000, "subsequent owned interval adds actual coverage");
        w.reset(); w.restore(new JSONArray().put(block("background", T, T + 30000, 1)), T + 30000, identity);
        w.ingest(T + 30000, identity.getString("endpoint"), measurement(-400, 30));
        w.ingest(T + 60000, identity.getString("endpoint"), measurement(-400, 60));
        check(w.snapshot().getInt("sampleCount") == 4, "shared restoration boundary sample not counted twice");
        for (String key : new String[] { "mode", "bootId", "usableCapacityMah", "capacityBasis", "anchorIdentity" }) {
            JSONObject changed = block("boundary-" + key, T + 20000, T + 30000, 1);
            changed.getJSONObject("identity").put(key, key.equals("usableCapacityMah") ? 9000 : key.equals("mode") ? "charging" : "changed");
            w.reset();
            w.restore(new JSONArray().put(block("before", T, T + 10000, 1)).put(changed)
                .put(block("after", T + 40000, T + 50000, 1)), T + 50000, identity);
            check(w.snapshot().getLong("observedDurationMs") == 10000, "restoration retains identity roundtrip boundary: " + key);
            w.restore(new JSONArray().put(block("before", T, T + 10000, 1)), T + 50000, identity);
            check(w.snapshot().getLong("observedDurationMs") == 10000, "later backfill cannot undo identity boundary: " + key);
        }
        w.reset();
        w.restore(new JSONArray().put(block("overlap-old", T, T + 30000, 9)).put(block("overlap-new", T + 20000, T + 50000, 1)), T + 50000, identity);
        check(w.snapshot().getLong("observedDurationMs") == 30000, "overlaps select whole newer block without prorating unknown integral");
        w.reset();
        for (int second = 0; second <= 330; second += 30) w.ingest(T + second * 1000, identity.getString("endpoint"), measurement(-400, second));
        check(w.snapshot().getLong("observedDurationMs") == 300000 && w.snapshot().getInt("sampleCount") == 11,
            "known local intervals clip exactly at five-minute boundary");
        w.ingest(T + 331000, "http://other.invalid:88/state.json", measurement(-400, 331));
        check(w.snapshot().getLong("observedDurationMs") == 0, "endpoint change resets actual coverage");
        w.ingest(T + 332000, identity.getString("endpoint"), null);
        check(w.snapshot().getLong("observedDurationMs") == 0 && w.snapshot().isNull("identity"), "invalid measurement resets safely");
    }
}
