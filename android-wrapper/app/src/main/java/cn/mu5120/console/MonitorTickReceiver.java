package cn.mu5120.console;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class MonitorTickReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        BackgroundMonitorService.start(context);
    }
}
