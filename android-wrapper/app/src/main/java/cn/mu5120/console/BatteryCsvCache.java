package cn.mu5120.console;

import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;

/** One bounded endpoint entry; failures are cached too, independently of state.json. */
final class BatteryCsvCache {
    interface Loader { String load(String endpoint) throws Exception; }
    interface Clock { long nowMs(); }
    static final class Result {
        final JSONObject csv;
        final String error;
        final String reason;
        final long fetchedAt;
        Result(JSONObject csv, String error) { this(csv, error, error.isEmpty() ? "" : "fetch-error"); }
        Result(JSONObject csv, String error, String reason) { this.csv = csv; this.error = error; this.reason = reason; this.fetchedAt = System.currentTimeMillis(); }
    }
    private static final ExecutorService IO = Executors.newFixedThreadPool(2, task -> {
        Thread thread = new Thread(task, "battery-csv-fetch"); thread.setDaemon(true); return thread;
    });
    private final Loader loader;
    private final Clock clock;
    private String endpoint;
    private long requestedAt;
    private FutureTask<Result> pending;
    BatteryCsvCache(Loader loader) { this(loader, () -> System.nanoTime() / 1000000); }
    BatteryCsvCache(Loader loader, Clock clock) { this.loader = loader; this.clock = clock; }
    synchronized Future<Result> request(String target) {
        long now = clock.nowMs();
        if (pending != null && target.equals(endpoint) && (!pending.isDone() || now >= requestedAt && now - requestedAt < 60000)) return pending;
        invalidate(); endpoint = target; requestedAt = now;
        pending = new FutureTask<>(() -> {
            String text;
            try { text = loader.load(target); }
            catch (Exception error) {
                String message = MonitorRouterClient.message(error);
                return new Result(null, message, error instanceof java.net.SocketTimeoutException ? "timeout" : message.contains("limit") ? "too-large" : "fetch-error");
            }
            try { return new Result(BatteryCsv.parse(text), ""); }
            catch (Exception error) { String message = MonitorRouterClient.message(error); return new Result(null, message, message.contains("limit") ? "too-large" : "invalid-csv"); }
        });
        IO.execute(pending); return pending;
    }
    synchronized void invalidate() {
        if (pending != null && !pending.isDone()) pending.cancel(true);
        pending = null; endpoint = null;
    }
}
