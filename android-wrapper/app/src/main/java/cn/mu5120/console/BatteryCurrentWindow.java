package cn.mu5120.console;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Signed mA*ms over actual receiver intervals; archived aggregates stay indivisible. */
final class BatteryCurrentWindow {
    private static final String[] IDENTITY_KEYS = { "percentageSource", "endpoint", "mode",
        "bootId", "usableCapacityMah", "capacityBasis", "anchorIdentity" };
    private final long windowMs;
    private final long maxGapMs;
    private String segmentId;
    private JSONObject identity;
    private Point previous;
    private Long receivedAt;
    private long identityBoundaryAt;
    private final Map<String, Block> local = new LinkedHashMap<>();
    private List<JSONObject> restored = new ArrayList<>();

    BatteryCurrentWindow() { this(300000, 120000); }
    BatteryCurrentWindow(long windowMs, long maxGapMs) {
        if (windowMs <= 0 || maxGapMs <= 0) throw new IllegalArgumentException("Invalid battery window");
        this.windowMs = windowMs; this.maxGapMs = maxGapMs; reset();
    }

    synchronized void reset() {
        segmentId = "native-" + UUID.randomUUID(); identity = null; previous = null; receivedAt = null;
        identityBoundaryAt = Long.MIN_VALUE; local.clear(); restored.clear();
    }

    static JSONObject identity(JSONObject measurement, String endpoint) throws Exception {
        if (measurement == null) return null;
        JSONObject value = new JSONObject();
        for (String key : IDENTITY_KEYS) value.put(key, BatteryGaugeReading.orNull(measurement.opt(key)));
        value.put("endpoint", endpoint == null ? measurement.optString("endpoint", "") : endpoint);
        return canonicalIdentity(value);
    }

    private static JSONObject canonicalIdentity(JSONObject value) throws Exception {
        if (value == null) return null;
        for (String key : IDENTITY_KEYS) if (!value.has(key)) return null;
        String source = value.optString("percentageSource"), mode = value.optString("mode");
        if (!("gauge88".equals(source) || "router".equals(source)) || !validMode(mode)
            || !(value.opt("endpoint") instanceof String)) return null;
        for (String key : new String[] { "bootId", "capacityBasis", "anchorIdentity" }) {
            Object item = value.opt(key);
            if (item != JSONObject.NULL && !(item instanceof String)) return null;
        }
        Object capacity = value.opt("usableCapacityMah");
        Double number = BatteryGaugeReading.numeric(capacity);
        if (capacity != JSONObject.NULL && (number == null || number <= 0)) return null;
        JSONObject result = new JSONObject();
        for (String key : IDENTITY_KEYS) result.put(key, value.opt(key));
        result.put("endpoint", BatteryGaugeReading.normalizeBatteryEndpoint(value.getString("endpoint")));
        return result;
    }

    static boolean validMode(String mode) {
        return "charging".equals(mode) || "discharging".equals(mode) || "full".equals(mode)
            || "confirming".equals(mode) || "external".equals(mode) || "unknown".equals(mode);
    }

    static boolean sameIdentity(JSONObject a, JSONObject b) {
        try {
            JSONObject left = canonicalIdentity(a), right = canonicalIdentity(b);
            if (left == null || right == null) return false;
            for (String key : IDENTITY_KEYS) {
                Object x = left.opt(key), y = right.opt(key);
                if (x instanceof Number && y instanceof Number) {
                    if (((Number) x).doubleValue() != ((Number) y).doubleValue()) return false;
                } else if (!x.equals(y)) return false;
            }
            return true;
        } catch (Exception ignored) { return false; }
    }

    synchronized JSONObject ingest(long time, String endpoint, JSONObject measurement) throws Exception {
        Double current = measurement == null ? null : BatteryGaugeReading.numeric(measurement.opt("netCurrentMa"));
        Double schema = measurement == null ? null : BatteryGaugeReading.numeric(measurement.opt("schemaVersion"));
        Double soc = measurement == null ? null : BatteryGaugeReading.numeric(measurement.opt("rawSoc"));
        JSONObject nextIdentity = identity(measurement, endpoint);
        if (time < 0 || current == null || schema == null || schema != 2 || soc == null || soc < 0 || soc > 100
            || nextIdentity == null) { reset(); return snapshot(); }
        Double mono = BatteryGaugeReading.numeric(measurement.opt("sampleMonoSeconds"));
        if (mono != null && mono < 0) mono = null;
        Point next = new Point(time, current, mono);
        if (!sameIdentity(identity, nextIdentity)) reset();
        if (previous != null) {
            long delta = time - previous.time;
            Double monoDelta = previous.mono != null && mono != null ? (mono - previous.mono) * 1000 : null;
            if (delta <= 0 || monoDelta != null && monoDelta <= 0) return snapshot();
            if (delta > maxGapMs || monoDelta != null && monoDelta > maxGapMs) reset();
        }
        identity = nextIdentity; receivedAt = time;
        if (previous != null && !integrate(previous, next)) {
            reset(); identity = nextIdentity; receivedAt = time;
        }
        previous = next;
        return snapshot();
    }

    private boolean integrate(Point a, Point b) throws Exception {
        long cursor = a.time;
        boolean initial = true;
        for (Block block : local.values()) if (segmentId.equals(block.stats.optString("segmentId"))) initial = false;
        while (cursor < b.time) {
            long minute = cursor / 60000 * 60000, until = Math.min(b.time, minute + 60000);
            String id = segmentId + ":" + minute;
            Block block = local.get(id);
            if (block == null) {
                block = new Block(new JSONObject().put("segmentId", segmentId).put("blockId", id)
                    .put("revision", 0).put("startAt", cursor).put("endAt", cursor).put("integralMaMs", 0)
                    .put("observedDurationMs", 0).put("sampleCount", 0).put("identity", copy(identity)));
                local.put(id, block);
            }
            double from = interpolate(a, b, cursor), to = interpolate(a, b, until);
            double integral = (from / 2 + to / 2) * (until - cursor);
            double total = block.stats.getDouble("integralMaMs") + integral;
            if (!Double.isFinite(integral) || !Double.isFinite(total)) return false;
            block.parts.add(new Part(cursor, until, from, to));
            boolean sharedBoundary = false;
            for (JSONObject saved : restored) if (saved.getLong("endAt") == cursor) sharedBoundary = true;
            if (initial && cursor == a.time && !sharedBoundary) block.points.add(cursor);
            if (until == b.time) block.points.add(until);
            block.stats.put("revision", block.stats.getLong("revision") + 1).put("endAt", until)
                .put("integralMaMs", total).put("observedDurationMs", block.stats.getLong("observedDurationMs") + until - cursor)
                .put("sampleCount", block.points.size());
            initial = false; cursor = until;
        }
        return true;
    }

    private static double interpolate(Point a, Point b, long time) {
        double fraction = (time - a.time) / (double) (b.time - a.time);
        return a.current * (1 - fraction) + b.current * fraction;
    }

    private List<JSONObject> selectedBlocks() throws Exception {
        if (receivedAt != null) {
            long cutoff = receivedAt - windowMs;
            local.entrySet().removeIf(entry -> entry.getValue().stats.optLong("endAt") <= cutoff
                || entry.getValue().stats.optLong("startAt") < identityBoundaryAt);
            restored.removeIf(block -> block.optLong("startAt") < Math.max(cutoff, identityBoundaryAt)
                || block.optLong("endAt") > receivedAt);
        }
        List<JSONObject> values = new ArrayList<>(restored);
        for (Block block : local.values()) values.add(block.stats);
        List<JSONObject> selected = selectBlocks(values);
        int first = selected.size();
        Long nextStart = previous != null ? Long.valueOf(previous.time) : receivedAt;
        for (int index = selected.size() - 1; index >= 0; index--) {
            JSONObject block = selected.get(index);
            if (nextStart != null && nextStart - block.getLong("endAt") > maxGapMs) break;
            first = index; nextStart = block.getLong("startAt");
        }
        return new ArrayList<>(selected.subList(first, selected.size()));
    }

    synchronized JSONObject snapshot() throws Exception {
        List<JSONObject> selected = selectedBlocks();
        long cutoff = receivedAt == null ? Long.MIN_VALUE : receivedAt - windowMs;
        long duration = 0, start = Long.MAX_VALUE, end = Long.MIN_VALUE, count = 0;
        double integral = 0;
        JSONArray stats = new JSONArray();
        for (JSONObject item : selected) {
            Block known = local.get(item.getString("blockId"));
            long blockStart = item.getLong("startAt");
            if (known != null && known.stats == item) {
                blockStart = Math.max(blockStart, cutoff);
                for (Part part : known.parts) {
                    long from = Math.max(part.start, cutoff);
                    if (from >= part.end) continue;
                    double fraction = (from - part.start) / (double) (part.end - part.start);
                    double firstCurrent = part.from * (1 - fraction) + part.to * fraction;
                    integral += (firstCurrent / 2 + part.to / 2) * (part.end - from);
                    duration += part.end - from;
                }
                for (Long time : known.points) if (time >= cutoff) count++;
            } else {
                integral += item.getDouble("integralMaMs"); duration += item.getLong("observedDurationMs");
                count += item.getLong("sampleCount");
            }
            start = Math.min(start, blockStart); end = Math.max(end, item.getLong("endAt"));
            stats.put(validateStats(item));
        }
        return new JSONObject().put("meanCurrentMa", duration > 0 && Double.isFinite(integral) ? integral / duration : JSONObject.NULL)
            .put("observedDurationMs", duration).put("sampleCount", duration > 0 ? count : previous == null ? 0 : 1)
            .put("windowStart", start == Long.MAX_VALUE ? JSONObject.NULL : start)
            .put("windowEnd", end == Long.MIN_VALUE ? JSONObject.NULL : end)
            .put("identity", identity == null ? JSONObject.NULL : copy(identity))
            .put("latestReceivedAt", previous == null ? JSONObject.NULL : previous.time).put("currentStats", stats);
    }

    synchronized JSONObject restore(JSONArray list, long now, JSONObject wanted) throws Exception {
        JSONObject nextIdentity = canonicalIdentity(wanted);
        if (nextIdentity == null || now < 0) return snapshot();
        if (identity != null && !sameIdentity(identity, nextIdentity)) reset();
        identity = nextIdentity; receivedAt = Math.max(receivedAt == null ? 0 : receivedAt, now);
        List<JSONObject> candidates = new ArrayList<>();
        if (list != null) for (int i = 0; i < list.length(); i++) {
            JSONObject block = validateStats(list.optJSONObject(i));
            if (block == null || block.getLong("startAt") < receivedAt - windowMs || block.getLong("endAt") > receivedAt) continue;
            JSONObject candidateIdentity = block.getJSONObject("identity");
            if (!identity.getString("percentageSource").equals(candidateIdentity.getString("percentageSource"))
                || !identity.getString("endpoint").equals(candidateIdentity.getString("endpoint"))) continue;
            candidates.add(block);
            if (!sameIdentity(candidateIdentity, identity)) identityBoundaryAt = Math.max(identityBoundaryAt, block.getLong("endAt"));
        }
        List<JSONObject> imported = new ArrayList<>();
        for (JSONObject block : candidates) if (sameIdentity(block.getJSONObject("identity"), identity)
            && block.getLong("startAt") >= identityBoundaryAt) imported.add(block);
        boolean handoff = previous != null && previous.time < identityBoundaryAt;
        if (previous != null) for (JSONObject block : imported) if (block.getLong("endAt") > previous.time) handoff = true;
        if (handoff) { previous = null; segmentId = "native-" + UUID.randomUUID(); }
        List<JSONObject> merged = new ArrayList<>(restored); merged.addAll(imported);
        restored = selectBlocks(merged);
        restored.removeIf(block -> local.containsKey(block.optString("blockId"))
            && block.optLong("revision") <= local.get(block.optString("blockId")).stats.optLong("revision"));
        return snapshot();
    }

    private static List<JSONObject> selectBlocks(List<JSONObject> values) {
        Map<String, JSONObject> byId = new LinkedHashMap<>();
        for (JSONObject block : values) {
            JSONObject prior = byId.get(block.optString("blockId"));
            if (prior == null || block.optLong("revision") > prior.optLong("revision")
                || block.optLong("revision") == prior.optLong("revision") && block.optLong("endAt") >= prior.optLong("endAt"))
                byId.put(block.optString("blockId"), block);
        }
        List<JSONObject> candidates = new ArrayList<>(byId.values()), selected = new ArrayList<>();
        candidates.sort((a, b) -> {
            int order = Long.compare(b.optLong("endAt"), a.optLong("endAt"));
            if (order == 0) order = Double.compare(b.optDouble("observedDurationMs") / (b.optDouble("endAt") - b.optDouble("startAt")),
                a.optDouble("observedDurationMs") / (a.optDouble("endAt") - a.optDouble("startAt")));
            if (order == 0) order = Long.compare(b.optLong("revision"), a.optLong("revision"));
            return order == 0 ? a.optString("blockId").compareTo(b.optString("blockId")) : order;
        });
        for (JSONObject candidate : candidates) {
            boolean overlap = false;
            for (JSONObject accepted : selected) if (candidate.optLong("startAt") < accepted.optLong("endAt")
                && candidate.optLong("endAt") > accepted.optLong("startAt")) { overlap = true; break; }
            if (!overlap) selected.add(candidate);
        }
        selected.sort(Comparator.comparingLong(block -> block.optLong("startAt")));
        return selected;
    }

    static JSONObject validateStats(JSONObject value) throws Exception {
        if (value == null) return null;
        JSONObject identity = canonicalIdentity(value.optJSONObject("identity"));
        if (identity == null || !(value.opt("segmentId") instanceof String) || value.optString("segmentId").isEmpty()
            || !(value.opt("blockId") instanceof String) || value.optString("blockId").isEmpty()) return null;
        for (String key : new String[] { "startAt", "endAt", "integralMaMs", "observedDurationMs", "sampleCount", "revision" })
            if (BatteryGaugeReading.numeric(value.opt(key)) == null) return null;
        double start = value.getDouble("startAt"), end = value.getDouble("endAt"), duration = value.getDouble("observedDurationMs");
        double samples = value.getDouble("sampleCount"), revision = value.getDouble("revision");
        if (start < 0 || end <= start || duration <= 0 || duration > end - start
            || !safeInteger(samples) || samples < 0 || !safeInteger(revision) || revision < 1) return null;
        JSONObject result = new JSONObject().put("identity", identity);
        for (String key : new String[] { "segmentId", "blockId", "revision", "startAt", "endAt", "integralMaMs", "observedDurationMs", "sampleCount" })
            result.put(key, value.opt(key));
        return result;
    }

    private static boolean safeInteger(double value) { return value == Math.floor(value) && Math.abs(value) <= 9007199254740991d; }
    private static JSONObject copy(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
    private static final class Point {
        final long time; final double current; final Double mono;
        Point(long time, double current, Double mono) { this.time = time; this.current = current; this.mono = mono; }
    }
    private static final class Part {
        final long start, end; final double from, to;
        Part(long start, long end, double from, double to) { this.start = start; this.end = end; this.from = from; this.to = to; }
    }
    private static final class Block {
        final JSONObject stats; final List<Part> parts = new ArrayList<>(); final Set<Long> points = new LinkedHashSet<>();
        Block(JSONObject stats) { this.stats = stats; }
    }
}
