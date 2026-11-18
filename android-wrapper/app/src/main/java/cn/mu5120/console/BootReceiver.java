package cn.mu5120.console;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (!MonitorRuntimePolicy.shouldRun("gauge88-csv".equals(BatteryProfile.mode()),
            BackgroundMonitorService.isOverlayEnabled(context))) return;
        BackgroundMonitorService.setAppForeground(context, false);
        BackgroundMonitorService.start(context);
    }
}
