package cn.mu5120.console;

import java.net.URL;

/** The tracked build profile is authoritative over settings saved by older versions. */
final class BatteryProfile {
    private BatteryProfile() { }
    static String mode() { return BuildConfig.BATTERY_PROFILE; }
    static String source() { return "factory".equals(mode()) ? "factory" : "gauge"; }
    static boolean isGaugeRoute(URL url) {
        return "/state.json".equals(url.getPath()) || "/backup/battery-log.csv".equals(url.getPath());
    }
}
