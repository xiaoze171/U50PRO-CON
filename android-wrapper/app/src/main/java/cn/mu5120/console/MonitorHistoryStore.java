package cn.mu5120.console;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Iterator;
import java.util.Locale;

/** Single writer in :monitor. Atomic per-minute records remain readable by the UI process. */
final class MonitorHistoryStore {
    static final long WINDOW_MS = 24L * 60 * 60 * 1000;
    static final long MINUTE_MS = 60000;
    private final File root;
    private final File snapshots;
    private long lastPrunedMinute = -1;
    private long lastLiveWrite;
    private long lastSavedAt;
    private String lastSms = "";

    MonitorHistoryStore(File root) {
        this.root = root;
        snapshots = new File(root, "monitor-snapshots");
    }

    synchronized boolean record(JSONObject snapshot, long now) throws Exception {
        if (!valid(snapshot, now)) return false;
        JSONObject copy = new JSONObject(snapshot.toString());
        copy.put("source", CollectionSource.normalize(copy.optString("source")));
        copy.remove("battery"); // derived history must not recursively enter the raw archive
        long timestamp = copy.getLong("timestamp");
        long minute = timestamp / MINUTE_MS;
        if (!snapshots.isDirectory() && !snapshots.mkdirs()) throw new IOException("无法创建监测记录目录");
        File target = new File(snapshots, minute + ".json");
        boolean saved = !target.exists();
        if (saved) {
            writeJson(target, copy);
            lastSavedAt = timestamp;
        }
        if (lastLiveWrite == 0 || now - lastLiveWrite >= 5000 || saved) {
            writeJson(new File(root, "monitor-live.json"), copy);
            lastLiveWrite = now;
        }
        if (lastPrunedMinute != minute) {
            prune(now);
            lastPrunedMinute = minute;
        }
        return saved;
    }

    synchronized void recordSms(JSONObject sms, long now) throws Exception {
        if (sms == null || sms.optBoolean("stale") || !sms.has("messages")) return;
        String content = String.valueOf(sms.opt("messages")) + String.valueOf(sms.opt("capacity"));
        if (content.equals(lastSms)) return;
        // Keep a timestamped SMS snapshot with each changed message list, plus the latest copy.
        File directory = new File(root, "monitor-sms");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建短信记录目录");
        long timestamp = sms.optLong("timestamp", now);
        writeJson(new File(directory, timestamp + ".json"), sms);
        writeJson(new File(root, "monitor-sms.json"), sms);
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) {
            try {
                long time = Long.parseLong(file.getName().replace(".json", ""));
                if (time < now - WINDOW_MS) file.delete();
            } catch (NumberFormatException ignored) { }
        }
        lastSms = content;
    }

    long lastSavedAt() { return lastSavedAt; }

    JSONObject read(long now) throws Exception { return read(now, true); }

    JSONObject read(long now, boolean includeSnapshots) throws Exception {
        JSONObject result = new JSONObject();
        JSONObject chart = new JSONObject();
        for (String key : new String[] { "rsrp", "sinr", "rsrq", "down", "up" }) chart.put(key, new JSONArray());
        JSONObject temperatures = new JSONObject();
        chart.put("temperatures", temperatures);
        JSONArray battery = new JSONArray();
        JSONArray records = new JSONArray();
        JSONObject sourceCounts = new JSONObject();
        for (String source : new String[] { "foreground", "background", "overlay", "screenOff", "unknown" }) sourceCounts.put(source, 0);
        int count = 0;
        long latest = 0;
        File[] files = snapshots.listFiles((dir, name) -> name.endsWith(".json"));
        if (files != null) {
            Arrays.sort(files, Comparator.comparing(File::getName));
            for (File file : files) {
                JSONObject sample = readJson(file);
                if (!valid(sample, now)) continue;
                String source = CollectionSource.normalize(sample.optString("source"));
                sample.put("source", source);
                sourceCounts.put(source, sourceCounts.optInt(source) + 1);
                count++;
                long timestamp = sample.getLong("timestamp");
                latest = Math.max(latest, timestamp);
                if (includeSnapshots) records.put(sample);
                JSONObject signal = sample.optJSONObject("signal");
                JSONObject status = sample.optJSONObject("status");
                JSONObject temps = sample.optJSONObject("temperature");
                long bucket = timestamp / MINUTE_MS * MINUTE_MS;
                point(chart.getJSONArray("rsrp"), bucket, firstNumber(signal, "Z5g_rsrp", "lte_rsrp", "rssi"), source);
                point(chart.getJSONArray("sinr"), bucket, firstNumber(signal, "Z5g_SINR", "Z5g_snr", "lte_snr"), source);
                point(chart.getJSONArray("rsrq"), bucket, firstNumber(signal, "Z5g_rsrq", "lte_rsrq"), source);
                point(chart.getJSONArray("down"), bucket, firstNumber(status, "realtime_rx_thrpt"), source);
                point(chart.getJSONArray("up"), bucket, firstNumber(status, "realtime_tx_thrpt"), source);
                if (temps != null) {
                    Iterator<String> names = temps.keys();
                    while (names.hasNext()) {
                        String name = names.next();
                        String lower = name.toLowerCase(Locale.US);
                        double value = firstNumber(temps, name);
                        if (!Double.isFinite(value) || !(lower.contains("temp") || lower.contains("sensor"))
                            || lower.contains("level") || lower.contains("oom_temp_pro")) continue;
                        if (!temperatures.has(name)) temperatures.put(name, new JSONArray());
                        point(temperatures.getJSONArray(name), bucket, value, source);
                    }
                }
                double percent = firstNumber(status, "battery_vol_percent", "battery_value");
                if (Double.isFinite(percent)) {
                    JSONObject item = new JSONObject().put("timestamp", timestamp).put("percent", percent)
                        .put("source", source)
                        .put("charging", "1".equals(status.optString("battery_charging")) || "1".equals(status.optString("external_charging_flag")))
                        .put("chargeType", status.optString("battery_charg_type"))
                        .put("externalPower", "1".equals(status.optString("external_charging_flag")))
                        .put("voltage", status.optString("battery_voltage"))
                        .put("current", status.optString("battery_current"))
                        .put("capacity", status.optString("battery_capacity"))
                        .put("health", status.optString("battery_health"));
                    double temp = firstNumber(temps, "battery_temp");
                    if (!Double.isFinite(temp)) temp = firstNumber(status, "battery_temp");
                    if (Double.isFinite(temp)) item.put("temperature", temp);
                    battery.put(item);
                }
            }
        }
        result.put("chart", chart).put("battery", battery).put("snapshotCount", count).put("lastSavedAt", latest).put("sourceCounts", sourceCounts);
        if (includeSnapshots) result.put("snapshots", records);
        JSONObject live = readJson(new File(root, "monitor-live.json"));
        if (valid(live, now)) result.put("live", live);
        JSONObject sms = readJson(new File(root, "monitor-sms.json"));
        if (sms.optLong("timestamp") >= now - WINDOW_MS) result.put("sms", sms);
        return result;
    }

    private static boolean valid(JSONObject sample, long now) {
        if (sample == null || sample.optBoolean("stale")) return false;
        long timestamp = sample.optLong("timestamp");
        JSONObject status = sample.optJSONObject("status");
        return timestamp > 0 && timestamp >= now - WINDOW_MS && timestamp <= now + MINUTE_MS
            && status != null && "ok".equals(status.optString("loginfo"));
    }

    private void prune(long now) {
        File[] files = snapshots.listFiles();
        if (files == null) return;
        long cutoff = (now - WINDOW_MS) / MINUTE_MS;
        for (File file : files) {
            try {
                if (file.getName().endsWith(".json") && Long.parseLong(file.getName().replace(".json", "")) < cutoff) file.delete();
            } catch (NumberFormatException ignored) { }
        }
    }

    private static void point(JSONArray series, long time, double value, String source) throws Exception {
        if (Double.isFinite(value)) series.put(new JSONArray().put(time).put(value).put(source));
    }

    static double firstNumber(JSONObject object, String... keys) {
        if (object == null) return Double.NaN;
        for (String key : keys) {
            try {
                String text = object.optString(key, "").trim();
                if (text.isEmpty()) continue;
                double value = Double.parseDouble(text);
                if (Double.isFinite(value)) return value;
            } catch (NumberFormatException ignored) { }
        }
        return Double.NaN;
    }

    static JSONObject readJson(File file) {
        try { return new JSONObject(readText(file)); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    static String readText(File file) throws IOException {
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    static void writeJson(File file, JSONObject value) throws IOException {
        File temp = new File(file.getParentFile(), file.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temp)) {
            output.write(value.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        if (!temp.renameTo(file)) throw new IOException("无法保存 " + file.getName());
    }
}
