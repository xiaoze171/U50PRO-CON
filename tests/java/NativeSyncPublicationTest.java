package cn.mu5120.console;

import java.lang.reflect.Method;
import org.json.JSONArray;
import org.json.JSONObject;

/** Run the real native publication cache without starting a LAN listener. */
public final class NativeSyncPublicationTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        long time = 1800000060000L;
        SyncServer server = new SyncServer();
        Method liveSnapshot = SyncServer.class.getDeclaredMethod("liveSnapshot", boolean.class);
        Method history = SyncServer.class.getDeclaredMethod("sliceSince", long.class);
        liveSnapshot.setAccessible(true); history.setAccessible(true);
        JSONObject measurement = new JSONObject().put("schemaVersion", 2).put("rawSoc", 50.001)
            .put("mode", "discharging").put("netCurrentMa", -400).put("usableCapacityMah", 8000)
            .put("percentageSource", "gauge88").put("endpoint", "http://fixture.invalid:88/state.json")
            .put("bootId", "fixture-boot").put("capacityBasis", "fixture").put("anchorIdentity", "fixture-anchor");
        JSONObject block = new JSONObject().put("segmentId", "fixture-native").put("blockId", "fixture-native:1800000000000")
            .put("revision", 2).put("startAt", time - 60000).put("endAt", time).put("integralMaMs", -24000000)
            .put("observedDurationMs", 60000).put("sampleCount", 3).put("identity", BatteryCurrentWindow.identity(measurement, null));
        JSONObject archived = new JSONObject().put("timestamp", time).put("percent", 50).put("source", "screenOff")
            .put("measurement", measurement).put("currentStats", block);
        JSONObject battery = new JSONObject().put("percent", 50).put("measurement", measurement).put("currentStats", new JSONArray().put(block))
            .put("timeToFull", new JSONObject().put("minutes", JSONObject.NULL).put("state", "not-applicable"))
            .put("runtime", new JSONObject().put("minutes", 600).put("state", "estimated").put("method", "net-current"))
            .put("calculatedAt", time).put("windowSeconds", 60);
        JSONObject live = new JSONObject().put("timestamp", time).put("battery", battery);
        server.publish(new JSONObject().put("live", live).put("battery", new JSONArray().put(archived)).toString());
        battery.put("percent", 49.99);
        server.publish(new JSONObject().put("live", live).toString());
        JSONObject compact = ((JSONObject) liveSnapshot.invoke(server, false)).getJSONObject("battery");
        check(!compact.has("samples") && compact.getDouble("percent") == 49.99, "live-only update remains compact");
        check(compact.getJSONObject("timeToFull").isNull("minutes") && compact.getJSONObject("runtime").getInt("minutes") == 600,
            "independent time results pass through unchanged");
        check(compact.getLong("calculatedAt") == time && compact.getInt("windowSeconds") == 60, "collector calculation basis preserved");
        check(compact.getJSONObject("measurement").getDouble("rawSoc") == 50.001
            && compact.getJSONArray("currentStats").getJSONObject(0).getLong("integralMaMs") == -24000000,
            "raw measurement and current block preserved");
        JSONObject saved = ((JSONObject) history.invoke(server, 0L)).getJSONArray("battery").getJSONObject(0);
        check(saved.getJSONObject("currentStats").getInt("revision") == 2 && "screenOff".equals(saved.getString("source")),
            "live-only publications retain archived current statistics");
        check(((JSONObject) liveSnapshot.invoke(server, true)).getJSONObject("battery").getJSONArray("samples").length() == 1,
            "legacy viewer receives its separate history");
        server.publish(new JSONObject().put("live", new JSONObject().put("battery", new JSONObject().put("percent", 49))).toString());
        compact = ((JSONObject) liveSnapshot.invoke(server, false)).getJSONObject("battery");
        check(!compact.has("measurement") && !compact.has("runtime") && !compact.has("currentStats"), "old publication replaces new atomic payload");
        System.out.println("PASS native sync compact independent estimates, calculation time, raw measurement, current stats and legacy replacement");
    }
}
