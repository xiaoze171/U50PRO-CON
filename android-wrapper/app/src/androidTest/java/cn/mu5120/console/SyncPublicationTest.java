package cn.mu5120.console;

import android.test.AndroidTestCase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/** Verify the native cache contract used by the smaller WebView publications. */
public final class SyncPublicationTest extends AndroidTestCase {
    public void testLiveOnlyUpdatesRetainHistoryAndSupportLegacyViewers() throws Exception {
        Class<?> type = Class.forName("cn.mu5120.console.SyncServer");
        Constructor<?> constructor = type.getDeclaredConstructor();
        constructor.setAccessible(true);
        Object server = constructor.newInstance();
        Method publish = type.getDeclaredMethod("publish", String.class);
        publish.setAccessible(true);
        Method liveSnapshot;
        try { liveSnapshot = type.getDeclaredMethod("liveSnapshot", boolean.class); }
        catch (NoSuchMethodException error) { fail("Live publication needs a compact and legacy-compatible response"); return; }
        liveSnapshot.setAccessible(true);
        Method history = type.getDeclaredMethod("sliceSince", long.class);
        history.setAccessible(true);

        JSONObject sample = new JSONObject().put("timestamp", 1800000000000L).put("percent", 48).put("source", "screenOff");
        JSONObject live = new JSONObject().put("timestamp", 1800000000000L).put("battery", new JSONObject().put("percent", 48));
        publish.invoke(server, new JSONObject().put("live", live)
            .put("chart", new JSONObject().put("rsrp", new JSONArray().put(new JSONArray().put(1800000000000L).put(-95).put("screenOff"))))
            .put("battery", new JSONArray().put(sample)).toString());
        live.getJSONObject("battery").put("percent", 47);
        publish.invoke(server, new JSONObject().put("live", live).toString());

        JSONObject compact = (JSONObject) liveSnapshot.invoke(server, false);
        assertEquals(47, compact.getJSONObject("battery").getInt("percent"));
        assertFalse(compact.getJSONObject("battery").has("samples"));
        JSONObject legacy = (JSONObject) liveSnapshot.invoke(server, true);
        assertEquals("screenOff", legacy.getJSONObject("battery").getJSONArray("samples").getJSONObject(0).getString("source"));
        assertFalse(((JSONObject) liveSnapshot.invoke(server, false)).getJSONObject("battery").has("samples"));
        JSONObject saved = (JSONObject) history.invoke(server, 0L);
        assertEquals(1, saved.getJSONArray("battery").length());
        assertEquals(-95, saved.getJSONObject("chart").getJSONArray("rsrp").getJSONArray(0).getInt(1));
    }
}
