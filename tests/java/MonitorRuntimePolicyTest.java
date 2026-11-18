package cn.mu5120.console;

import java.lang.reflect.Method;

/** The policy used by the Android service must keep device history off the phone. */
public final class MonitorRuntimePolicyTest {
    private static Class<?> policy;

    private static boolean call(String name, Class<?>[] types, Object... values) throws Exception {
        Method method = policy.getDeclaredMethod(name, types);
        return (Boolean) method.invoke(null, values);
    }

    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        try { policy = Class.forName("cn.mu5120.console.MonitorRuntimePolicy"); }
        catch (ClassNotFoundException missing) {
            throw new AssertionError("device history must have an optional overlay lifecycle policy", missing);
        }
        Class<?>[] selection = { boolean.class, boolean.class };
        check(!call("shouldRun", selection, true, false), "88 without an overlay cannot start a monitor service");
        check(call("shouldRun", selection, true, true), "88 enabled overlay needs a monitor service");
        check(call("shouldRun", selection, false, false), "factory collector runs without an overlay");

        Class<?>[] ticking = { boolean.class, boolean.class, boolean.class };
        check(!call("shouldTick", ticking, true, false, true), "disabled overlay has no scheduler");
        check(!call("shouldTick", ticking, true, true, false), "screen-off overlay has no scheduler");
        check(call("shouldTick", ticking, true, true, true), "screen-on overlay keeps a heartbeat takeover ticker");
        check(call("shouldTick", ticking, false, false, false), "factory scheduler survives screen-off");

        Class<?>[] polling = { boolean.class, boolean.class, boolean.class, boolean.class };
        check(!call("shouldPoll", polling, true, false, false, true), "88 disabled overlay never queries");
        check(!call("shouldPoll", polling, true, true, false, false), "88 screen-off never queries");
        check(!call("shouldPoll", polling, true, true, true, true), "foreground UI owns live queries");
        check(call("shouldPoll", polling, true, true, false, true), "background screen-on overlay owns live queries");
        check(call("shouldPoll", polling, false, false, false, false), "factory retains screen-off collection");

        Class<?>[] profile = { boolean.class };
        check(!call("shouldArchive", profile, true), "88 snapshots and battery samples are not archived");
        check(call("shouldArchive", profile, false), "factory still archives local history");
        check(!call("shouldWake", profile, true), "88 never requests alarms or wake/Wi-Fi locks");
        check(call("shouldWake", profile, false), "factory retains alarms and locks");
        check(!call("shouldPollSms", profile, true), "88 overlay does not poll SMS in the background");
        check(call("shouldPollSms", profile, false), "factory retains SMS polling");

        Class<?>[] acceptance = { boolean.class, boolean.class, boolean.class, boolean.class, boolean.class };
        check(call("shouldAcceptSnapshot", acceptance, true, true, false, true, true), "enabled overlay accepts UI snapshots");
        check(!call("shouldAcceptSnapshot", acceptance, true, false, false, true, true), "queued UI snapshot is discarded after disabling");
        check(!call("shouldAcceptSnapshot", acceptance, true, false, true, false, true), "in-flight native fetch is discarded after disabling");
        check(!call("shouldAcceptSnapshot", acceptance, true, true, true, false, false), "in-flight native fetch is discarded after screen-off");
        check(!call("shouldAcceptSnapshot", acceptance, true, true, true, true, true), "in-flight native fetch is discarded after UI resumes");
        check(call("shouldAcceptSnapshot", acceptance, false, false, true, false, false), "factory accepts screen-off native fetch");
        System.out.println("PASS optional monitor service, screen lifecycle, archive/SMS/wake gates and late snapshot policy");
    }
}
