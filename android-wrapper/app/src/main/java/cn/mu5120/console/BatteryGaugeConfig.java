package cn.mu5120.console;

import java.net.URL;
import org.json.JSONObject;

/** Immutable polling configuration shared by foreground/background validation. */
final class BatteryGaugeConfig {
    final String source;
    final String host;
    final int port;

    BatteryGaugeConfig(String source, String host, int port) {
        String normalizedSource = source == null || source.trim().isEmpty() ? "gauge" : source.trim();
        if (!"gauge".equals(normalizedSource) && !"factory".equals(normalizedSource)) throw new IllegalArgumentException("Invalid battery source");
        if (port < 1 || port > 65535) throw new IllegalArgumentException("Invalid battery port");
        String normalizedHost = host == null ? "" : host.trim();
        if (!normalizedHost.isEmpty()) {
            if (normalizedHost.matches(".*[\\s/@?#\\\\].*")) throw new IllegalArgumentException("Invalid battery host");
            if (normalizedHost.contains(":") && !normalizedHost.startsWith("[") && normalizedHost.indexOf(':') != normalizedHost.lastIndexOf(':')) normalizedHost = "[" + normalizedHost + "]";
            try {
                URL parsed = new URL("http://" + normalizedHost);
                if (parsed.getHost().isEmpty() || parsed.getPort() != -1 || !parsed.getPath().isEmpty() || parsed.getUserInfo() != null) throw new IllegalArgumentException("Invalid battery host");
                normalizedHost = parsed.getHost();
            } catch (java.net.MalformedURLException error) { throw new IllegalArgumentException("Invalid battery host", error); }
        }
        this.source = normalizedSource;
        this.host = normalizedHost;
        this.port = port;
    }

    static BatteryGaugeConfig fromJson(JSONObject json) {
        JSONObject input = json == null ? new JSONObject() : json;
        String rawPort = String.valueOf(input.opt("batteryPort") == null || input.isNull("batteryPort") ? 88 : input.opt("batteryPort")).trim();
        if (!rawPort.matches("[0-9]+")) throw new IllegalArgumentException("Invalid battery port");
        return new BatteryGaugeConfig(input.optString("batterySource", "gauge"), input.optString("batteryHost", ""), Integer.parseInt(rawPort));
    }

    String endpoint(String routerUrl) throws java.net.MalformedURLException {
        URL router = new URL(routerUrl);
        if (!"http".equals(router.getProtocol()) && !"https".equals(router.getProtocol())) throw new java.net.MalformedURLException("Only HTTP/HTTPS supported");
        return new URL(router.getProtocol(), host.isEmpty() ? router.getHost() : host, port, "/state.json").toExternalForm();
    }

    boolean matches(JSONObject status, String routerUrl) {
        if ("factory".equals(source)) return "router".equals(BatteryGaugeReading.source(status));
        try { return "gauge88".equals(BatteryGaugeReading.source(status)) && endpoint(routerUrl).equals(BatteryGaugeReading.endpoint(status)); }
        catch (java.net.MalformedURLException ignored) { return false; }
    }
}
