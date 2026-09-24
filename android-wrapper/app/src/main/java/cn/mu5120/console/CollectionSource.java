package cn.mu5120.console;

/** Collection context at acquisition time, independent of when the record is saved. */
final class CollectionSource {
    static String resolve(boolean fromPage, boolean interactive, boolean overlayVisible) {
        if (fromPage) return "foreground";
        if (!interactive) return "screenOff";
        return overlayVisible ? "overlay" : "background";
    }

    static String normalize(String source) {
        if ("foreground".equals(source) || "background".equals(source)
            || "overlay".equals(source) || "screenOff".equals(source)) return source;
        return "unknown";
    }
}
