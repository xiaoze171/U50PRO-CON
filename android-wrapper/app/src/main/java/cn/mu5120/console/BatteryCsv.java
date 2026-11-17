package cn.mu5120.console;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Pure device-log model; local app history is deliberately not an input. */
final class BatteryCsv {
    static final int MAX_BYTES = 4 * 1024 * 1024;
    static final int MAX_RECORDS = 50000;
    private static final List<String> REQUIRED = Arrays.asList("ts", "soc", "voltage_mv", "current_ma", "power_w", "temp_c", "status");
    private static final List<String> OPTIONAL = Arrays.asList("ts_iso", "usb_online", "input_voltage_mv", "input_current_ma", "input_power_w");
    private static final List<String> NUMERIC = Arrays.asList("ts", "soc", "voltage_mv", "current_ma", "power_w", "temp_c");
    private BatteryCsv() { }

    static JSONObject parse(String text) throws Exception {
        if (text == null) throw new IllegalArgumentException("Battery CSV must be text");
        if (text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("Battery CSV byte limit exceeded");
        if (text.startsWith("\ufeff")) text = text.substring(1);
        List<String> headers = null, cells = new ArrayList<>();
        JSONArray rows = new JSONArray(); int invalid = 0;
        StringBuilder field = new StringBuilder(); boolean quoted = false, closed = false, fieldStart = true;
        for (int index = 0; index <= text.length(); index++) {
            boolean eof = index == text.length(); char c = eof ? '\0' : text.charAt(index);
            if (quoted) {
                if (eof) throw new IllegalArgumentException("Battery CSV unterminated quoted field");
                if (c == '"') {
                    if (index + 1 < text.length() && text.charAt(index + 1) == '"') { field.append('"'); index++; }
                    else { quoted = false; closed = true; }
                } else field.append(c);
                continue;
            }
            if (!eof && c == '"') {
                if (!fieldStart || closed) throw new IllegalArgumentException("Battery CSV malformed quote");
                quoted = true; fieldStart = false; continue;
            }
            boolean delimiter = eof || c == ',' || c == '\r' || c == '\n';
            if (closed && !delimiter) throw new IllegalArgumentException("Battery CSV characters after quoted field");
            if (!delimiter) { field.append(c); fieldStart = false; continue; }
            if (eof && fieldStart && cells.isEmpty() && !closed) break;
            cells.add(field.toString()); field.setLength(0); closed = false; fieldStart = true;
            if (!eof && c == ',') continue;
            if (headers == null) {
                headers = new ArrayList<>(); for (String value : cells) headers.add(value.trim());
                for (String name : REQUIRED) if (count(headers, name) != 1) throw new IllegalArgumentException("Battery CSV missing or duplicate required header");
                for (String name : OPTIONAL) if (count(headers, name) > 1) throw new IllegalArgumentException("Battery CSV duplicate header");
            } else {
                if (rows.length() >= MAX_RECORDS) throw new IllegalArgumentException("Battery CSV record limit exceeded");
                JSONObject row = record(cells, headers); if (row == null) invalid++;
                rows.put(BatteryGaugeReading.orNull(row));
            }
            cells.clear();
            if (!eof && c == '\r' && index + 1 < text.length() && text.charAt(index + 1) == '\n') index++;
        }
        if (headers == null) throw new IllegalArgumentException("Battery CSV missing header");
        return new JSONObject().put("rows", rows).put("invalidRows", invalid);
    }

    private static int count(List<String> values, String name) { int result = 0; for (String value : values) if (name.equals(value)) result++; return result; }
    private static Double decimal(String value) {
        String text = value.trim();
        if (!text.matches("(?i)[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?")) return null;
        try { double n = Double.parseDouble(text); return Double.isFinite(n) ? n : null; } catch (NumberFormatException error) { return null; }
    }
    private static JSONObject record(List<String> cells, List<String> headers) throws Exception {
        if (cells.size() > headers.size()) return null;
        JSONObject row = new JSONObject();
        for (int i = 0; i < headers.size(); i++) {
            String name = headers.get(i), original = i < cells.size() ? cells.get(i) : "", value = original.trim();
            if (!REQUIRED.contains(name) && !OPTIONAL.contains(name)) continue;
            if (NUMERIC.contains(name)) { Double n = decimal(value); if (n == null) return null; row.put(name, n); }
            else if ("status".equals(name)) { if (value.isEmpty()) return null; row.put(name, value); }
            else if ("ts_iso".equals(name)) row.put(name, original);
            else {
                Double n = value.isEmpty() ? null : decimal(value);
                if (!value.isEmpty() && n == null || "usb_online".equals(name) && n != null && n != 0 && n != 1) return null;
                row.put(name, BatteryGaugeReading.orNull(n));
            }
        }
        double ts = row.getDouble("ts"), soc = row.getDouble("soc");
        if (ts < 0 || ts > 9007199254740991d || ts != Math.floor(ts) || soc < 0 || soc > 100 || row.getDouble("voltage_mv") <= 0) return null;
        for (String name : OPTIONAL) if (!row.has(name)) row.put(name, JSONObject.NULL);
        return row;
    }

    private static boolean compatible(JSONObject row, String mode, int sign) {
        if (row == null) return false;
        double current = row.optDouble("current_ma", Double.NaN), power = row.optDouble("power_w", Double.NaN);
        String status = row.optString("status"), recordMode = "unknown";
        if ("Charging".equals(status) && current > -50) recordMode = "charging";
        else if ("Discharging".equals(status) && current < 50 || "Not charging".equals(status) && current <= -50) recordMode = "discharging";
        return mode.equals(recordMode) && Double.isFinite(current) && Double.isFinite(power) && current * sign > -50 && power * sign >= 0;
    }
    private static boolean correction(double fromSoc, double toSoc, double fromCurrent, double toCurrent, double seconds, Double capacity, int sign) {
        double expected = capacity != null && capacity > 0 ? Math.abs((fromCurrent / 2 + toCurrent / 2) * seconds / 3600 / capacity * 100) : 0;
        double delta = toSoc - fromSoc;
        return Math.abs(delta) > Math.max(0.5, 3 * expected + 0.15) || delta * sign < -0.15;
    }
    private static JSONObject analysisState(JSONObject analysis, String state, String reason) throws Exception { return analysis.put("state", state).put("reason", reason); }
    static JSONObject analyze(JSONObject csv, JSONObject rawMeasurement, Double deviceNow) throws Exception {
        JSONObject m = MonitorHistoryStore.sanitizeMeasurement(rawMeasurement);
        JSONObject a = new JSONObject().put("state", "unavailable").put("reason", "missing").put("points", 0).put("windowSeconds", 0)
            .put("invalidRows", csv == null ? 0 : csv.optInt("invalidRows", 0)).put("lastTimestampSeconds", JSONObject.NULL).put("socMovement", 0).put("energyWh", 0);
        if (m == null) return analysisState(a, "unavailable", "live-measurement");
        JSONArray rows = csv == null ? null : csv.optJSONArray("rows");
        if (rows == null || rows.length() == 0) return a;
        JSONObject last = rows.optJSONObject(rows.length() - 1);
        if (last == null) return analysisState(a, "unavailable", "invalid-latest");
        double lastTs = last.getDouble("ts"); a.put("lastTimestampSeconds", lastTs);
        if (deviceNow == null || !Double.isFinite(deviceNow) || deviceNow < 0 || deviceNow < lastTs) return analysisState(a, "unavailable", "device-time");
        double age = deviceNow - lastTs;
        if (age > 120) return analysisState(a, "unavailable", "stale");
        Double current = BatteryGaugeReading.numeric(m.opt("netCurrentMa")), power = BatteryGaugeReading.numeric(m.opt("netPowerW"));
        if (current == null) return analysisState(a, "unavailable", "live-current");
        String mode = m.optString("mode"); int sign = "charging".equals(mode) ? 1 : -1;
        if (!"charging".equals(mode) && !"discharging".equals(mode)) return analysisState(a, "collecting", "inactive");
        Double uptime = BatteryGaugeReading.numeric(m.opt("sampleMonoSeconds")), capacity = BatteryGaugeReading.numeric(m.opt("usableCapacityMah"));
        double bootStart = uptime == null ? Double.NEGATIVE_INFINITY : deviceNow - uptime;
        if (lastTs < bootStart) return analysisState(a, "collecting", "reboot");
        double lastCurrent = last.getDouble("current_ma");
        if (!compatible(last, mode, sign) || current * sign <= -50 || power != null && power * sign < 0
            || correction(last.getDouble("soc"), m.getDouble("rawSoc"), lastCurrent, current, age, capacity, sign)
            || Math.abs(lastCurrent - current) > Math.max(100, 0.5 * Math.max(Math.abs(lastCurrent), Math.abs(current))))
            return analysisState(a, "collecting", "live-discontinuity");
        List<JSONObject> segment = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (!compatible(row, mode, sign) || row.getDouble("ts") < bootStart) { segment.clear(); continue; }
            if (!segment.isEmpty()) {
                JSONObject previous = segment.get(segment.size() - 1); double interval = row.getDouble("ts") - previous.getDouble("ts");
                if (interval <= 0 || interval > 120 || correction(previous.getDouble("soc"), row.getDouble("soc"),
                    previous.getDouble("current_ma"), row.getDouble("current_ma"), interval, capacity, sign)) segment.clear();
            }
            segment.add(row);
        }
        List<JSONObject> window = new ArrayList<>(); for (JSONObject row : segment) if (row.getDouble("ts") >= lastTs - 7200) window.add(row);
        a.put("points", window.size());
        double seconds = 0, movement = 0, energy = 0;
        if (!window.isEmpty()) {
            seconds = lastTs - window.get(0).getDouble("ts"); movement = (last.getDouble("soc") - window.get(0).getDouble("soc")) * sign;
            for (int i = 1; i < window.size(); i++) {
                JSONObject from = window.get(i - 1), to = window.get(i);
                energy += (from.getDouble("power_w") / 2 + to.getDouble("power_w") / 2) * sign * (to.getDouble("ts") - from.getDouble("ts")) / 3600;
            }
        }
        a.put("windowSeconds", seconds).put("socMovement", movement).put("energyWh", energy);
        if (window.size() < 31 || seconds < 3600) return analysisState(a, "collecting", "short-window");
        if (movement + 1e-9 < 0.2) return analysisState(a, "collecting", "soc-movement");
        if (energy + 1e-9 < 0.05) return analysisState(a, "collecting", "energy");
        return analysisState(a, "ready", "");
    }
    static JSONObject time(String state, String reason, int target, Double minutes, String method) throws Exception {
        return new JSONObject().put("minutes", BatteryGaugeReading.orNull(minutes)).put("state", state)
            .put("method", BatteryGaugeReading.orNull(method)).put("reason", reason).put("targetPercent", target);
    }
    private static JSONObject time(String state, String reason, int target) throws Exception { return time(state, reason, target, null, null); }
    private static String reason(String code) {
        switch (code) {
            case "missing": return "CSV日志未获取"; case "stale": return "CSV日志已过期"; case "device-time": return "CSV设备时间异常";
            case "invalid-latest": return "CSV最新记录无效"; case "live-measurement": return "实时电量不可用"; case "live-current": return "实时电流不可用";
            case "live-discontinuity": return "CSV与实时状态不连续"; case "reboot": return "等待重启后CSV记录";
            case "short-window": return "CSV有效记录不足一小时"; case "soc-movement": return "CSV电量变化不足";
            case "energy": return "CSV能量变化不足"; case "inactive": return "当前状态不适用"; default: return "CSV日志不可用";
        }
    }
    static JSONObject estimate(JSONObject csv, JSONObject rawMeasurement, Double deviceNow, long calculatedAt) throws Exception {
        JSONObject m = MonitorHistoryStore.sanitizeMeasurement(rawMeasurement), a = analyze(csv, rawMeasurement, deviceNow);
        JSONObject out = new JSONObject().put("timeToFull", time("unavailable", reason(a.optString("reason")), 100))
            .put("runtime", time("unavailable", reason(a.optString("reason")), 0)).put("calculatedAt", calculatedAt)
            .put("windowSeconds", a.getDouble("windowSeconds")).put("csvAnalysis", a);
        if (m == null) return out;
        String mode = m.optString("mode");
        out.put("timeToFull", time("not-applicable", m.optBoolean("externalPower") ? "未净充电" : "未充电", 100))
            .put("runtime", time("not-applicable", "充电中", 0));
        if ("unknown".equals(mode)) out.put("timeToFull", time("unknown", "状态待确认", 100)).put("runtime", time("unknown", "状态待确认", 0));
        else if ("full".equals(mode)) out.put("timeToFull", time(m.optBoolean("fullConfirmed") ? "full" : "confirming", m.optBoolean("fullConfirmed") ? "已充满" : "满充确认中", 100)).put("runtime", time("not-applicable", "外接供电", 0));
        else if ("confirming".equals(mode)) out.put("timeToFull", time("confirming", "满充确认中", 100)).put("runtime", time("not-applicable", "满充确认中", 0));
        else if ("external".equals(mode)) out.put("timeToFull", time("external", "外接供电", 100)).put("runtime", time("external", "拔电后估算", 0));
        else {
            boolean charging = "charging".equals(mode); int sign = charging ? 1 : -1, target = charging ? 100 : 0;
            String key = charging ? "timeToFull" : "runtime"; Double current = BatteryGaugeReading.numeric(m.opt("netCurrentMa"));
            if (current != null && current * sign <= -50) out.put(key, time("unknown", "状态待确认", target));
            else if (current != null && Math.abs(current) < 50) out.put(key, time("low-current", "待估算", target));
            else if (charging && m.getDouble("rawSoc") >= 95) out.put(key, time("tapering", "充满时间随电流变化", target));
            else if ("ready".equals(a.optString("state"))) {
                double delta = charging ? 100 - m.getDouble("rawSoc") : m.getDouble("rawSoc");
                double minutes = delta / a.getDouble("socMovement") * a.getDouble("windowSeconds") / 60;
                out.put(key, Double.isFinite(minutes) ? time("estimated", "", target, minutes, "device-csv") : time("unavailable", "CSV估算不可用", target));
            } else out.put(key, time(a.optString("state"), reason(a.optString("reason")), target));
        }
        if (m.optBoolean("eodImminent") || m.optBoolean("eodClamp")) out.put("runtime", time("low-battery", "请尽快充电", 0));
        return out;
    }
}
