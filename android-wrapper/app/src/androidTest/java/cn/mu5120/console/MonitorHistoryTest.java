package cn.mu5120.console;

import android.test.AndroidTestCase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.lang.reflect.Method;

/** Real on-device persistence tests; no WebView, network mocks or wall-clock sleeps. */
public final class MonitorHistoryTest extends AndroidTestCase {
    private File directory;
    private Class<?> storeType;
    private Object store;
    private static final long T = 1800000000000L;

    @Override protected void setUp() throws Exception {
        super.setUp();
        directory = new File(getContext().getCacheDir(), "monitor-test-" + System.nanoTime());
        assertTrue(directory.mkdirs());
        try { storeType = Class.forName("cn.mu5120.console.MonitorHistoryStore"); }
        catch (ClassNotFoundException error) { fail("Full background history persistence is not implemented"); }
        store = storeType.getDeclaredConstructor(File.class).newInstance(directory);
    }

    private Object call(String name, Class<?>[] types, Object... args) throws Exception {
        Method method = storeType.getDeclaredMethod(name, types);
        return method.invoke(store, args);
    }

    private void record(JSONObject snapshot, long now) throws Exception {
        call("record", new Class<?>[] { JSONObject.class, long.class }, snapshot, now);
    }

    private JSONObject read(long now) throws Exception {
        return (JSONObject) call("read", new Class<?>[] { long.class }, now);
    }

    private JSONObject sample(long time, int rsrp) throws Exception {
        return new JSONObject()
            .put("timestamp", time)
            .put("status", new JSONObject().put("loginfo", "ok").put("battery_vol_percent", "0")
                .put("realtime_rx_thrpt", "2048").put("realtime_tx_thrpt", "512").put("monthly_rx_bytes", "987654"))
            .put("signal", new JSONObject().put("Z5g_rsrp", "").put("lte_rsrp", rsrp).put("Z5g_SINR", "17").put("lte_rsrq", "-9").put("nr5g_pci", "42"))
            .put("temperature", new JSONObject().put("battery_temp", "33").put("wifi_chip_temp", "41").put("cpu_temp", ""))
            .put("resources", new JSONObject().put("cpu_usage", "12"))
            .put("locks", new JSONObject().put("lte_band_lock", "0x4"))
            .put("features", new JSONObject().put("data_volume_limit_switch", "1"))
            .put("neighbors", new JSONObject().put("lte_ngbr_cell_info_ext", "neighbor-data"))
            .put("stations", new JSONArray().put(new JSONObject().put("hostname", "phone")))
            .put("cableStations", new JSONArray().put(new JSONObject().put("hostname", "pc")));
    }

    public void testAllGroupsSurviveRestartAndBackfillCharts() throws Exception {
        record(sample(T + 1000, -93), T + 1000);
        record(sample(T + 62000, -91), T + 62000);
        store = storeType.getDeclaredConstructor(File.class).newInstance(directory);
        JSONObject result = read(T + 63000);
        assertEquals(2, result.getJSONArray("snapshots").length());
        JSONObject saved = result.getJSONArray("snapshots").getJSONObject(1);
        assertEquals("12", saved.getJSONObject("resources").getString("cpu_usage"));
        assertEquals("42", saved.getJSONObject("signal").getString("nr5g_pci"));
        assertEquals("987654", saved.getJSONObject("status").getString("monthly_rx_bytes"));
        assertEquals("0x4", saved.getJSONObject("locks").getString("lte_band_lock"));
        assertEquals("1", saved.getJSONObject("features").getString("data_volume_limit_switch"));
        assertEquals("neighbor-data", saved.getJSONObject("neighbors").getString("lte_ngbr_cell_info_ext"));
        assertEquals("phone", saved.getJSONArray("stations").getJSONObject(0).getString("hostname"));
        assertEquals("pc", saved.getJSONArray("cableStations").getJSONObject(0).getString("hostname"));
        JSONObject chart = result.getJSONObject("chart");
        assertEquals(-93, chart.getJSONArray("rsrp").getJSONArray(0).getInt(1));
        assertEquals(T + 60000, chart.getJSONArray("rsrp").getJSONArray(1).getLong(0));
        assertEquals(17, chart.getJSONArray("sinr").getJSONArray(0).getInt(1));
        assertEquals(2048, chart.getJSONArray("down").getJSONArray(0).getInt(1));
        assertEquals(41, chart.getJSONObject("temperatures").getJSONArray("wifi_chip_temp").getJSONArray(0).getInt(1));
        assertFalse(chart.getJSONObject("temperatures").has("cpu_temp"));
        assertEquals(0, result.getJSONArray("battery").getJSONObject(0).getInt("percent"));
    }

    public void testStaleAndFailedSamplesNeverFillAnOfflineGap() throws Exception {
        record(sample(T + 1000, -93), T + 1000);
        record(sample(T + 62000, -91).put("stale", true), T + 62000);
        JSONObject failed = sample(T + 121000, -90);
        failed.getJSONObject("status").put("loginfo", "no");
        record(failed, T + 121000);
        assertEquals(1, read(T + 122000).getJSONArray("snapshots").length());
    }

    public void testSourcesSurviveRestartAndDoNotRelabelAnExistingMinute() throws Exception {
        String[] sources = { "foreground", "background", "overlay", "screenOff" };
        for (int i = 0; i < sources.length; i++) {
            long timestamp = T + i * 60000 + 1000;
            record(sample(timestamp, -93).put("source", sources[i]), timestamp);
            record(sample(timestamp + 1000, -90).put("source", "foreground"), timestamp + 1000);
        }
        record(sample(T + 241000, -89), T + 241000);
        store = storeType.getDeclaredConstructor(File.class).newInstance(directory);
        JSONObject result = read(T + 242000);
        for (int i = 0; i < sources.length; i++) {
            assertEquals(sources[i], result.getJSONArray("snapshots").getJSONObject(i).getString("source"));
            assertEquals(sources[i], result.getJSONObject("chart").getJSONArray("rsrp").getJSONArray(i).getString(2));
            assertEquals(sources[i], result.getJSONArray("battery").getJSONObject(i).getString("source"));
            assertEquals(1, result.getJSONObject("sourceCounts").getInt(sources[i]));
        }
        assertEquals("unknown", result.getJSONObject("chart").getJSONArray("rsrp").getJSONArray(4).getString(2));
    }

    public void testMinuteDedupRetentionAndCorruptRecordRecovery() throws Exception {
        record(sample(T - 86460000, -100), T - 86460000);
        record(sample(T + 1000, -93), T + 1000);
        record(sample(T + 2000, -80), T + 2000);
        JSONObject result = read(T + 3000);
        assertEquals(1, result.getJSONArray("snapshots").length());
        assertEquals(T + 1000, result.getJSONArray("snapshots").getJSONObject(0).getLong("timestamp"));
        File corrupt = new File(directory, "monitor-snapshots/30000001.json");
        try (java.io.FileOutputStream output = new java.io.FileOutputStream(corrupt)) { output.write("{broken".getBytes("UTF-8")); }
        record(sample(T + 121000, -89), T + 121000);
        assertEquals(2, read(T + 122000).getJSONArray("snapshots").length());
    }

    public void testSmsRawContentSurvivesRestart() throws Exception {
        JSONObject sms = new JSONObject().put("timestamp", T)
            .put("messages", new JSONArray().put(new JSONObject().put("id", "7").put("content", "AB").put("rawContent", "00410042")))
            .put("capacity", new JSONObject().put("sms_nv_total", "500"));
        call("recordSms", new Class<?>[] { JSONObject.class, long.class }, sms, T);
        store = storeType.getDeclaredConstructor(File.class).newInstance(directory);
        JSONObject saved = read(T + 1000).getJSONObject("sms");
        assertEquals("00410042", saved.getJSONArray("messages").getJSONObject(0).getString("rawContent"));
        assertEquals("500", saved.getJSONObject("capacity").getString("sms_nv_total"));
    }

    @Override protected void tearDown() throws Exception {
        remove(directory);
        super.tearDown();
    }

    private void remove(File file) {
        if (file == null) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        file.delete();
    }
}
