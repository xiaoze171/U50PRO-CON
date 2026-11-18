package cn.mu5120.console;

/** Device history is collected by the router; the phone only hosts an optional live overlay. */
final class MonitorRuntimePolicy {
    private MonitorRuntimePolicy() { }

    static boolean shouldRun(boolean deviceHistory, boolean overlayEnabled) {
        return !deviceHistory || overlayEnabled;
    }

    static boolean shouldTick(boolean deviceHistory, boolean overlayEnabled, boolean screenInteractive) {
        return shouldRun(deviceHistory, overlayEnabled) && (!deviceHistory || screenInteractive);
    }

    static boolean shouldPoll(boolean deviceHistory, boolean overlayEnabled, boolean appForeground,
                              boolean screenInteractive) {
        return shouldTick(deviceHistory, overlayEnabled, screenInteractive) && !appForeground;
    }

    static boolean shouldArchive(boolean deviceHistory) { return !deviceHistory; }
    static boolean shouldWake(boolean deviceHistory) { return !deviceHistory; }
    static boolean shouldPollSms(boolean deviceHistory) { return !deviceHistory; }

    static boolean shouldAcceptSnapshot(boolean deviceHistory, boolean overlayEnabled, boolean nativeCollection,
                                        boolean appForeground, boolean screenInteractive) {
        return shouldRun(deviceHistory, overlayEnabled)
            && (!nativeCollection || shouldPoll(deviceHistory, overlayEnabled, appForeground, screenInteractive));
    }
}
