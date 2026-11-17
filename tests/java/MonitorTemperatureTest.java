package cn.mu5120.console;

import java.io.File;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real native persistence regression: old raw records must be safe on read after an upgrade. */
public final class MonitorTemperatureTest {
    private static final long T = 1800000000000L;

    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("u50-temperature-test-").toFile();
        try {
            MonitorHistoryStore store = new MonitorHistoryStore(root);
            String[] inputs = { "-80", "37broken", "", "-40", "150", "151", "0", "40°C", "0x20" };
            for (int i = 0; i < inputs.length; i++) {
                long timestamp = T + i * 60000 + 1000;
                JSONObject snapshot = new JSONObject().put("timestamp", timestamp).put("source", "screenOff")
                    .put("status", new JSONObject().put("loginfo", "ok").put("battery_vol_percent", "50"))
                    .put("signal", new JSONObject().put("lte_rsrp", "-93"))
                    .put("temperature", new JSONObject().put("wifi_chip_temp", inputs[i]).put("battery_temp", inputs[i])
                        .put("wifi_temp_level_1", "37.5").put("wifi_temp_level_2", "38").put("pm_modem_5g", "42")
                        .put("therm_pa_level", "1").put("unexpected_temp", "32"));
                check(store.record(snapshot, timestamp), "snapshot saved");
                // Windows renameTo cannot replace a live cache; preserve and exercise the archive itself.
                new File(root, "monitor-live.json").delete();
            }
            JSONObject output = new MonitorHistoryStore(root).read(T + 10 * 60000);
            JSONObject temperatures = output.getJSONObject("chart").getJSONObject("temperatures");
            JSONArray chip = temperatures.getJSONArray("wifi_chip_temp");
            check(chip.length() == 3, "suspect, malformed and missing temperatures must not enter native charts");
            check(chip.getJSONArray(0).getDouble(1) == -40, "plausible negative temperature retained");
            check(chip.getJSONArray(1).getDouble(1) == 150, "upper plausibility boundary retained");
            check(chip.getJSONArray(2).getDouble(1) == 0, "zero temperature retained");
            check("screenOff".equals(chip.getJSONArray(0).getString(2)), "source retained");
            check(temperatures.getJSONArray("wifi_temp_level_1").length() == inputs.length, "independent Wi-Fi sensor 1 retained");
            check(temperatures.getJSONArray("wifi_temp_level_2").length() == inputs.length, "independent Wi-Fi sensor 2 retained");
            check(temperatures.getJSONArray("pm_modem_5g").length() == inputs.length, "5G modem sensor retained");
            check(!temperatures.has("therm_pa_level") && !temperatures.has("unexpected_temp"), "non-sensors excluded");
            check(output.getJSONObject("chart").getJSONArray("rsrp").getJSONArray(0).getInt(1) == -93, "negative signal retained");
            JSONObject battery = output.getJSONArray("battery").getJSONObject(0);
            check(battery.isNull("temperature"), "suspect battery temperature must not enter derived history");
            check(battery.isNull("charging"), "missing charging must not turn into false");
            check("-80".equals(output.getJSONArray("snapshots").getJSONObject(0).getJSONObject("temperature").getString("wifi_chip_temp")), "raw diagnostic value retained");
            TemperatureReading invalid = TemperatureReading.read("battery_temp", " -80 ");
            check("invalid".equals(invalid.state) && " -80 ".equals(invalid.raw), "invalid state retains exact raw text");
            check("读数异常".equals(invalid.display()), "overlay must not display a suspect temperature as Celsius");
            check("未知".equals(TemperatureReading.read("battery_temp", " ").display()), "missing temperature stays unknown");
            check("37.5°C".equals(TemperatureReading.read("battery_temp", "37.5").display()), "valid overlay Celsius formatting");
            check("invalid".equals(TemperatureReading.read("battery_temp", true).state), "boolean is not Celsius");
            check(TemperatureReading.battery(new JSONObject(), new JSONObject().put("battery_temp", "34")).value == 34, "missing battery group may use the same field from status");
            check("invalid".equals(TemperatureReading.battery(new JSONObject().put("battery_temp", "-80"), new JSONObject().put("battery_temp", "34")).state), "a suspect primary reading is not silently replaced");
            check(Boolean.FALSE.equals(MonitorHistoryStore.chargingValue(new JSONObject().put("battery_charging", "0"))), "known charging-off remains false");
            check(Boolean.FALSE.equals(MonitorHistoryStore.chargingValue(new JSONObject().put("battery_charging", "0").put("external_charging_flag", "1"))), "external power does not override known charging-off");
            System.out.println("PASS native temperature validation, history migration, independent sensors, raw preservation and unknown charging");
        } finally {
            remove(root);
        }
    }

    private static void remove(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        file.delete();
    }
}
