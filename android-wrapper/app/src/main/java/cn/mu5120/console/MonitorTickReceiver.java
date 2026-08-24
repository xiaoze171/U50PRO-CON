package cn.mu5120.console;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class MonitorTickReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Intent service = new Intent(context, BackgroundMonitorService.class)
            .setAction(BackgroundMonitorService.ACTION_POLL);
        if (android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
        else context.startService(service);
    }
}
