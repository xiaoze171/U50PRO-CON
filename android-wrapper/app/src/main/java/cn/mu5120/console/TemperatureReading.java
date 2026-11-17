package cn.mu5120.console;

import org.json.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Celsius sensor semantics shared by native archive derivation and live display. */
final class TemperatureReading {
    private static final Set<String> FIELDS = new HashSet<>(Arrays.asList(
        "battery_temp", "wifi_chip_temp", "wifi_temp_level_1", "wifi_temp_level_2",
        "pm_sensor_pa1", "pm_sensor_mdm", "pm_modem_5g", "cpu_temp", "cpu_temperature",
        "soc_temp", "board_temp", "modem_temp"
    ));
    private static final Pattern DECIMAL = Pattern.compile("^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?$");
    final double value;
    final String state;
    final String raw;

    private TemperatureReading(double value, String state, String raw) {
        this.value = value;
        this.state = state;
        this.raw = raw;
    }

    static TemperatureReading read(String key, Object input) {
        String raw = input == null || input == JSONObject.NULL ? "" : String.valueOf(input);
        if (!FIELDS.contains(key)) return new TemperatureReading(Double.NaN, "invalid", raw);
        if (input == null || input == JSONObject.NULL || (input instanceof String && raw.trim().isEmpty())) {
            return new TemperatureReading(Double.NaN, "missing", raw);
        }
        double value = Double.NaN;
        if ((input instanceof String || input instanceof Number) && DECIMAL.matcher(raw.trim()).matches()) {
            try { value = Double.parseDouble(raw.trim()); } catch (NumberFormatException ignored) { }
        }
        // Plausibility guard only: this does not identify a firmware sentinel or operating rating.
        boolean valid = Double.isFinite(value) && value >= -40 && value <= 150;
        return new TemperatureReading(valid ? value : Double.NaN, valid ? "valid" : "invalid", raw);
    }

    static TemperatureReading battery(JSONObject temperatures, JSONObject status) {
        TemperatureReading reading = read("battery_temp", temperatures == null ? null : temperatures.opt("battery_temp"));
        return "missing".equals(reading.state)
            ? read("battery_temp", status == null ? null : status.opt("battery_temp")) : reading;
    }

    String display() {
        if ("invalid".equals(state)) return "读数异常";
        if (!"valid".equals(state)) return "未知";
        String number = Math.abs(value - Math.rint(value)) < 0.05
            ? String.valueOf((long) Math.rint(value)) : String.format(Locale.US, "%.1f", value);
        return number + "°C";
    }
}
