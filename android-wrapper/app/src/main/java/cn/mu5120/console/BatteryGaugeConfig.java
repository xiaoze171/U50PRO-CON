package cn.mu5120.console;

import java.net.URL;
import org.json.JSONObject;

/** Immutable polling configuration shared by foreground/background validation. */
final class BatteryGaugeConfig {
    final String source;
    final String host;
    final int port;

    BatteryGaugeConfig(String source, String host, int port) {
        String normalizedSource = BatteryProfile.source();
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
        this.port = 88;
    }

    static BatteryGaugeConfig fromJson(JSONObject json) {
        JSONObject input = json == null ? new JSONObject() : json;
        return new BatteryGaugeConfig(BatteryProfile.source(), input.optString("batteryHost", ""), 88);
    }

    String endpoint(String routerUrl) throws java.net.MalformedURLException {
        return endpoint(routerUrl, "/state.json");
    }

    String csvEndpoint(String routerUrl) throws java.net.MalformedURLException {
        return endpoint(routerUrl, "/backup/battery-log.csv");
    }

    private String endpoint(String routerUrl, String path) throws java.net.MalformedURLException {
        URL router = new URL(routerUrl);
        if (!"http".equals(router.getProtocol()) && !"https".equals(router.getProtocol())) throw new java.net.MalformedURLException("Only HTTP/HTTPS supported");
        return new URL(router.getProtocol(), host.isEmpty() ? router.getHost() : host, 88, path).toExternalForm();
    }

    boolean matches(JSONObject status, String routerUrl) {
        if ("factory".equals(source)) return "router".equals(BatteryGaugeReading.source(status));
        try { return "gauge88".equals(BatteryGaugeReading.source(status)) && endpoint(routerUrl).equals(BatteryGaugeReading.endpoint(status)); }
        catch (java.net.MalformedURLException ignored) { return false; }
    }
}
