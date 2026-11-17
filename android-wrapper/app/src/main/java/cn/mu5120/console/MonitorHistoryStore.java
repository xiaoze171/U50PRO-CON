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
import java.util.LinkedHashMap;
import java.util.Map;
import java.security.MessageDigest;

/** Single writer in :monitor. Atomic per-minute records remain readable by the UI process. */
final class MonitorHistoryStore {
    static final long WINDOW_MS = 24L * 60 * 60 * 1000;
    static final long MINUTE_MS = 60000;
    private final File root;
    private final File snapshots;
    private final File batteryBlocks;
    private final Map<String, JSONObject> pendingBatteryBlocks = new LinkedHashMap<>();
    private long lastPrunedMinute = -1;
    private long lastLiveWrite;
    private long lastSavedAt;
    private String lastBatteryIdentity;
    private String lastSms = "";

    MonitorHistoryStore(File root) {
        this.root = root;
        snapshots = new File(root, "monitor-snapshots");
        batteryBlocks = new File(root, "monitor-battery-blocks");
        JSONObject live = readJson(new File(root, "monitor-live.json"));
        if (live.has("status")) lastBatteryIdentity = batteryIdentity(live);
        try { collectBatteryBlocks(live, false); } catch (Exception ignored) { }
    }

    synchronized boolean record(JSONObject snapshot, long now) throws Exception {
        if (!valid(snapshot, now)) return false;
        JSONObject copy = new JSONObject(snapshot.toString());
        copy.put("source", CollectionSource.normalize(copy.optString("source")));
        copy.put("battery", compactBattery(copy.optJSONObject("battery")));
        long timestamp = copy.getLong("timestamp");
        long minute = timestamp / MINUTE_MS;
        if (!snapshots.isDirectory() && !snapshots.mkdirs()) throw new IOException("无法创建监测记录目录");
        File target = new File(snapshots, minute + ".json");
        String identity = batteryIdentity(copy);
        if (lastBatteryIdentity == null) {
            JSONObject previous = readJson(new File(root, "monitor-live.json"));
            if (!previous.has("status") && target.exists()) previous = readJson(target);
            lastBatteryIdentity = batteryIdentity(previous);
        }
        boolean sourceChanged = !identity.equals(lastBatteryIdentity);
        if (target.exists() && sourceChanged) target = new File(snapshots, minute + "-" + timestamp + ".json");
        boolean saved = !target.exists();
        if (saved) {
            writeJson(target, copy);
            lastSavedAt = timestamp;
        }
        collectBatteryBlocks(copy, true);
        if (lastLiveWrite == 0 || now - lastLiveWrite >= 5000 || saved || sourceChanged) {
            writeJson(new File(root, "monitor-live.json"), copy);
            lastLiveWrite = now;
        }
        lastBatteryIdentity = identity;
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
            Arrays.sort(files, Comparator.comparingLong(MonitorHistoryStore::archiveTime));
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
                        double value = TemperatureReading.read(name, temps.opt(name)).value;
                        if (!Double.isFinite(value)) continue;
                        if (!temperatures.has(name)) temperatures.put(name, new JSONArray());
                        point(temperatures.getJSONArray(name), bucket, value, source);
                    }
                }
                Double percent = BatteryGaugeReading.percent(status);
                if (percent != null) {
                    battery.put(batterySample(sample, null));
                }
            }
        }
        // Stats are keyed by block ID rather than chart minute. Live contributes the latest unfinished block.
        Map<String, JSONObject> currentBlocks = new LinkedHashMap<>();
        File[] blockFiles = batteryBlocks.listFiles((dir, name) -> name.endsWith(".json"));
        if (blockFiles != null) for (File file : blockFiles) mergeBlock(currentBlocks, readJson(file), now);
        for (JSONObject item : pendingBatteryBlocks.values()) mergeBlock(currentBlocks, item, now);
        JSONObject live = readJson(new File(root, "monitor-live.json"));
        if (valid(live, now)) {
            JSONObject summary = live.optJSONObject("battery");
            JSONArray liveStats = summary == null ? null : summary.optJSONArray("currentStats");
            if (liveStats != null) for (int i = 0; i < liveStats.length(); i++) {
                JSONObject block = BatteryCurrentWindow.validateStats(liveStats.optJSONObject(i));
                if (block != null && isCurrentStatsUpdate(summary, block)) mergeBlock(currentBlocks, batterySample(live, block), now);
            }
        }
        JSONObject[] sortedBlocks = currentBlocks.values().toArray(new JSONObject[0]);
        Arrays.sort(sortedBlocks, Comparator.comparingLong(item -> item.optLong("timestamp")));
        for (JSONObject item : sortedBlocks) battery.put(item);
        result.put("chart", chart).put("battery", battery).put("snapshotCount", count).put("lastSavedAt", latest).put("sourceCounts", sourceCounts);
        if (includeSnapshots) result.put("snapshots", records);
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
                if (file.getName().endsWith(".json") && archiveTime(file) / MINUTE_MS < cutoff) file.delete();
            } catch (NumberFormatException ignored) { }
        }
        File[] stats = batteryBlocks.listFiles((dir, name) -> name.endsWith(".json"));
        if (stats != null) for (File file : stats) if (readJson(file).optLong("timestamp") < now - WINDOW_MS) file.delete();
    }

    private static String batteryIdentity(JSONObject snapshot) {
        JSONObject status = snapshot == null ? null : snapshot.optJSONObject("status");
        try {
            JSONObject summary = snapshot == null ? null : snapshot.optJSONObject("battery");
            JSONObject measurement = summary == null ? null : sanitizeMeasurement(summary.optJSONObject("measurement"));
            if (measurement == null) measurement = BatteryGaugeReading.normalizeBatteryMeasurement(status);
            if (measurement != null) return BatteryCurrentWindow.identity(measurement, null).toString();
        } catch (Exception ignored) { }
        return "legacy|" + BatteryGaugeReading.source(status) + "|" + BatteryGaugeReading.endpoint(status) + "|" + chargingValue(status);
    }

    private static long archiveTime(File file) {
        String name = file.getName().replace(".json", "");
        int split = name.indexOf('-');
        try { return split < 0 ? Long.parseLong(name) * MINUTE_MS : Long.parseLong(name.substring(split + 1)); }
        catch (NumberFormatException ignored) { return Long.MAX_VALUE; }
    }

    private static void point(JSONArray series, long time, double value, String source) throws Exception {
        if (Double.isFinite(value)) series.put(new JSONArray().put(time).put(value).put(source));
    }

    static Object chargingValue(JSONObject status) {
        if (status != null && status.has("battery_gauge")) {
            try {
                JSONObject measurement = BatteryGaugeReading.normalizeBatteryMeasurement(status);
                if (measurement == null || "unknown".equals(measurement.optString("mode"))) return JSONObject.NULL;
                return "charging".equals(measurement.optString("mode"));
            } catch (Exception ignored) { return JSONObject.NULL; }
        }
        Object value = status == null ? null : status.opt("battery_charging");
        if ("1".equals(String.valueOf(value)) || Boolean.TRUE.equals(value)) return true;
        if ("0".equals(String.valueOf(value)) || Boolean.FALSE.equals(value)) return false;
        return JSONObject.NULL;
    }

    static JSONObject compactBattery(JSONObject input) throws Exception {
        JSONObject result = new JSONObject();
        if (input != null) for (String key : new String[] { "percent", "state", "mode", "charging", "externalPower", "percentSource", "percentEndpoint",
            "timeToFull", "runtime", "calculatedAt", "windowSeconds", "remainingHours", "ratePerHour", "spanMs", "sampleCount" })
            if (input.has(key)) result.put(key, input.get(key));
        JSONObject measurement = input == null ? null : sanitizeMeasurement(input.optJSONObject("measurement"));
        result.put("measurement", BatteryGaugeReading.orNull(measurement));
        JSONArray stats = input == null ? null : input.optJSONArray("currentStats");
        JSONArray clean = new JSONArray();
        if (stats != null && measurement != null) for (int i = 0; i < stats.length(); i++) {
            JSONObject block = BatteryCurrentWindow.validateStats(stats.optJSONObject(i));
            if (block != null && BatteryCurrentWindow.sameIdentity(block.optJSONObject("identity"), BatteryCurrentWindow.identity(measurement, measurement.optString("endpoint")))) clean.put(block);
        }
        result.put("currentStats", stats == null || measurement == null ? JSONObject.NULL : clean);
        JSONArray updates = new JSONArray();
        for (int i = 0; i < clean.length(); i++) {
            JSONObject block = clean.getJSONObject(i);
            if (isCurrentStatsUpdate(input, block)) updates.put(new JSONObject().put("blockId", block.getString("blockId"))
                .put("revision", block.getLong("revision")));
        }
        result.put("currentStatsUpdates", updates);
        JSONObject window = input == null ? null : input.optJSONObject("currentWindow");
        if (window != null && measurement != null) {
            JSONObject small = new JSONObject();
            for (String key : new String[] { "meanCurrentMa", "observedDurationMs", "sampleCount", "windowStart", "windowEnd", "identity", "latestReceivedAt" })
                if (window.has(key)) small.put(key, window.get(key));
            result.put("currentWindow", small);
        } else result.put("currentWindow", JSONObject.NULL);
        return result;
    }

    // Only the collector that changed this revision can bind it to this snapshot's reading.
    // Restored and relayed blocks remain usable in currentStats without becoming new observations.
    private static boolean isCurrentStatsUpdate(JSONObject summary, JSONObject block) {
        JSONArray updates = summary == null ? null : summary.optJSONArray("currentStatsUpdates");
        if (updates == null || block == null) return false;
        for (int i = 0; i < updates.length(); i++) {
            JSONObject update = updates.optJSONObject(i);
            if (update == null || !block.optString("blockId").equals(update.opt("blockId"))) continue;
            Double revision = BatteryGaugeReading.numeric(update.opt("revision"));
            if (revision != null && revision == block.optLong("revision")) return true;
        }
        return false;
    }

    static JSONObject sanitizeMeasurement(JSONObject value) throws Exception {
        Double soc = value == null ? null : BatteryGaugeReading.numeric(value.opt("rawSoc"));
        Double schema = value == null ? null : BatteryGaugeReading.numeric(value.opt("schemaVersion"));
        if (value == null || schema == null || schema != 2 || soc == null || soc < 0 || soc > 100) return null;
        String mode = value.optString("mode"), source = value.optString("percentageSource");
        JSONObject clean = new JSONObject().put("schemaVersion", 2).put("rawSoc", soc).put("mode", BatteryCurrentWindow.validMode(mode) ? mode : "unknown")
            .put("percentageSource", "gauge88".equals(source) || "router".equals(source) ? source : JSONObject.NULL)
            .put("endpoint", BatteryGaugeReading.normalizeBatteryEndpoint(value.opt("endpoint") instanceof String ? value.getString("endpoint") : ""));
        for (String key : new String[] { "netCurrentMa", "voltageMv", "netPowerW", "usableCapacityMah", "fullStableSeconds", "sampleMonoSeconds" }) {
            Double number = BatteryGaugeReading.numeric(value.opt(key));
            if (number != null && ((key.equals("usableCapacityMah") && number <= 0) || ((key.equals("fullStableSeconds") || key.equals("sampleMonoSeconds")) && number < 0))) number = null;
            clean.put(key, BatteryGaugeReading.orNull(number));
        }
        for (String key : new String[] { "capacityBasis", "bootId", "anchorIdentity" }) clean.put(key,
            value.opt(key) instanceof String && !value.getString(key).trim().isEmpty() ? value.get(key) : JSONObject.NULL);
        for (String key : new String[] { "externalPower", "fullConfirmed", "fullAnchorValid", "eodImminent", "eodClamp" }) clean.put(key, Boolean.TRUE.equals(value.opt(key)));
        return clean;
    }

    static JSONObject batterySample(JSONObject snapshot, JSONObject block) throws Exception {
        JSONObject status = snapshot.optJSONObject("status");
        JSONObject summary = snapshot.optJSONObject("battery");
        JSONObject measurement = summary == null ? null : sanitizeMeasurement(summary.optJSONObject("measurement"));
        Double percent = BatteryGaugeReading.percent(status);
        boolean gauge = "gauge88".equals(BatteryGaugeReading.source(status));
        // The reading was observed at snapshot.timestamp; aggregate coverage has its own start/end.
        JSONObject item = new JSONObject().put("timestamp", snapshot.optLong("timestamp"))
            .put("percent", BatteryGaugeReading.orNull(percent)).put("source", CollectionSource.normalize(snapshot.optString("source")))
            .put("percentSource", BatteryGaugeReading.source(status)).put("percentEndpoint", gauge || measurement == null
                ? BatteryGaugeReading.endpoint(status) : measurement.optString("endpoint", ""))
            .put("charging", chargingValue(status)).put("chargeType", gauge ? measurement == null ? "" : measurement.optString("mode") : status.optString("battery_charg_type"))
            .put("externalPower", measurement != null ? measurement.optBoolean("externalPower") : "1".equals(status.optString("external_charging_flag")))
            .put("voltage", gauge ? measurement == null ? JSONObject.NULL : measurement.opt("voltageMv") : status.optString("battery_voltage"))
            .put("current", gauge ? measurement == null ? JSONObject.NULL : measurement.opt("netCurrentMa") : status.optString("battery_current"))
            .put("capacity", gauge ? measurement == null ? JSONObject.NULL : measurement.opt("usableCapacityMah") : status.optString("battery_capacity"))
            .put("health", gauge ? "" : status.optString("battery_health"))
            .put("measurement", BatteryGaugeReading.orNull(measurement)).put("currentStats", BatteryGaugeReading.orNull(block));
        double temp = BatteryGaugeReading.temperature(snapshot.optJSONObject("temperature"), status).value;
        return item.put("temperature", Double.isFinite(temp) ? temp : JSONObject.NULL);
    }

    private void collectBatteryBlocks(JSONObject snapshot, boolean persist) throws Exception {
        JSONObject summary = snapshot.optJSONObject("battery");
        JSONArray stats = summary == null ? null : summary.optJSONArray("currentStats");
        Map<String, JSONObject> incoming = new LinkedHashMap<>();
        if (stats != null) for (int i = 0; i < stats.length(); i++) {
            JSONObject block = BatteryCurrentWindow.validateStats(stats.optJSONObject(i));
            if (block == null || !isCurrentStatsUpdate(summary, block)) continue;
            String id = block.getString("blockId"); JSONObject sample = batterySample(snapshot, block);
            JSONObject prior = pendingBatteryBlocks.get(id);
            if (prior == null || block.getLong("revision") > prior.getJSONObject("currentStats").getLong("revision")) pendingBatteryBlocks.put(id, sample);
            incoming.put(id, sample);
        }
        if (persist) {
            if (!batteryBlocks.isDirectory() && !batteryBlocks.mkdirs()) throw new IOException("无法创建电流统计目录");
            String active = null; long latest = -1;
            for (JSONObject sample : incoming.values()) {
                JSONObject block = sample.getJSONObject("currentStats");
                if (block.optLong("endAt") > latest) { latest = block.optLong("endAt"); active = block.getString("blockId"); }
            }
            Iterator<Map.Entry<String, JSONObject>> iterator = pendingBatteryBlocks.entrySet().iterator();
            while (iterator.hasNext()) {
                Map.Entry<String, JSONObject> entry = iterator.next();
                JSONObject block = entry.getValue().getJSONObject("currentStats");
                boolean complete = !entry.getKey().equals(active) || block.getLong("endAt") <= snapshot.optLong("timestamp") / MINUTE_MS * MINUTE_MS;
                if (complete) {
                    File target = new File(batteryBlocks, blockFilename(entry.getKey()));
                    JSONObject old = readJson(target).optJSONObject("currentStats");
                    if (old == null || old.optLong("revision") < block.getLong("revision")) writeJson(target, entry.getValue());
                    iterator.remove();
                }
            }
        }
    }

    private static String blockFilename(String id) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result + ".json";
    }

    private static void mergeBlock(Map<String, JSONObject> target, JSONObject sample, long now) throws Exception {
        JSONObject block = BatteryCurrentWindow.validateStats(sample.optJSONObject("currentStats"));
        if (block == null || block.getLong("endAt") < now - WINDOW_MS || block.getLong("endAt") > now + MINUTE_MS) return;
        JSONObject prior = target.get(block.getString("blockId"));
        if (prior == null || block.getLong("revision") > prior.getJSONObject("currentStats").getLong("revision")) target.put(block.getString("blockId"), sample);
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
        if (!temp.renameTo(file)) {
            // Android rename replaces atomically. Desktop JVM verification also needs Windows replacement.
            // Reflection keeps the Java NIO fallback off the Android 23 class-loading path.
            try {
                Class<?> path = Class.forName("java.nio.file.Path"), option = Class.forName("java.nio.file.CopyOption");
                Class<?> options = Class.forName("java.nio.file.StandardCopyOption");
                Object flags = java.lang.reflect.Array.newInstance(option, 2);
                java.lang.reflect.Array.set(flags, 0, options.getField("ATOMIC_MOVE").get(null));
                java.lang.reflect.Array.set(flags, 1, options.getField("REPLACE_EXISTING").get(null));
                Object from = File.class.getMethod("toPath").invoke(temp), to = File.class.getMethod("toPath").invoke(file);
                Class.forName("java.nio.file.Files").getMethod("move", path, path, flags.getClass()).invoke(null, from, to, flags);
            } catch (Exception error) { throw new IOException("无法保存 " + file.getName(), error); }
        }
    }
}
