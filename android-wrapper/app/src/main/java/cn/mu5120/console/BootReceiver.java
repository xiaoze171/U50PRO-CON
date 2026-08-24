package cn.mu5120.console;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        BackgroundMonitorService.setAppForeground(context, false);
        BackgroundMonitorService.start(context);
    }
}
