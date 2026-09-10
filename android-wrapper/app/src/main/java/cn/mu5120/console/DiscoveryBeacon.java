package cn.mu5120.console;

import android.content.Context;
import android.net.wifi.WifiManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 局域网设备发现（安卓端）。UDP 广播信标 + 监听，维护 peer 表；用 tokenFP 过滤非同一
 * 路由器/家庭（或密码不同）的信标；peer TTL 15s。与桌面 desktop/discovery.js 行为一一对应。
 */
final class DiscoveryBeacon {
    static final int DISCOVERY_PORT = 51201;
    static final String APP_TAG = "u50pro-sync";
    static final int PROTOCOL_VERSION = 1;
    static final long BEACON_INTERVAL_MS = 5000;
    static final long PEER_TTL_MS = 15000;

    private final Context appContext;
    private final Object lock = new Object();
    private DatagramSocket socket;
    private Thread receiveThread;
    private ScheduledExecutorService beaconExecutor;
    private WifiManager.MulticastLock multicastLock;

    private JSONObject beacon = new JSONObject();
    private final Map<String, JSONObject> peers = new ConcurrentHashMap<>();

    DiscoveryBeacon(Context context) {
        this.appContext = context.getApplicationContext();
        try {
            beacon.put("app", APP_TAG);
            beacon.put("v", PROTOCOL_VERSION);
            beacon.put("id", "");
            beacon.put("name", "");
            beacon.put("platform", "android");
            beacon.put("httpPort", SyncServer.SYNC_HTTP_PORT);
            beacon.put("role", "auto");
            beacon.put("collecting", false);
            beacon.put("tokenFP", "");
        } catch (Exception ignored) {}
    }

    void setBeacon(JSONObject fields) {
        if (fields == null) return;
        synchronized (lock) {
            JSONArray names = fields.names();
            if (names == null) return;
            for (int index = 0; index < names.length(); index++) {
                String name = names.optString(index);
                try { beacon.put(name, fields.get(name)); } catch (Exception ignored) {}
            }
            try { beacon.put("app", APP_TAG); } catch (Exception ignored) {}
        }
    }

    /** 返回存活 peer（顺带清理过期项）。 */
    JSONArray getPeers() {
        long now = System.currentTimeMillis();
        JSONArray alive = new JSONArray();
        Iterator<Map.Entry<String, JSONObject>> iterator = peers.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<String, JSONObject> entry = iterator.next();
            JSONObject peer = entry.getValue();
            if (now - peer.optLong("lastSeen", 0) > PEER_TTL_MS) { iterator.remove(); continue; }
            alive.put(peer);
        }
        return alive;
    }

    void start() {
        synchronized (lock) {
            if (socket != null) return;
            try {
                DatagramSocket next = new DatagramSocket(null);
                next.setReuseAddress(true);
                next.setBroadcast(true);
                next.bind(new InetSocketAddress(DISCOVERY_PORT));
                socket = next;
            } catch (Exception error) {
                socket = null;
                return;
            }
            acquireMulticastLock();

            Thread thread = new Thread(this::receiveLoop, "u50-sync-discovery");
            thread.setDaemon(true);
            receiveThread = thread;
            thread.start();

            beaconExecutor = Executors.newSingleThreadScheduledExecutor();
            beaconExecutor.scheduleAtFixedRate(this::broadcast, 0, BEACON_INTERVAL_MS, TimeUnit.MILLISECONDS);
        }
    }

    void stop() {
        DatagramSocket socketRef;
        ScheduledExecutorService executorRef;
        synchronized (lock) {
            socketRef = socket;
            executorRef = beaconExecutor;
            socket = null;
            beaconExecutor = null;
            receiveThread = null;
        }
        if (executorRef != null) executorRef.shutdownNow();
        if (socketRef != null) { try { socketRef.close(); } catch (Exception ignored) {} }
        releaseMulticastLock();
        peers.clear();
    }

    private void broadcast() {
        DatagramSocket socketRef = socket;
        if (socketRef == null) return;
        try {
            JSONObject packet;
            synchronized (lock) { packet = new JSONObject(beacon.toString()); }
            packet.put("time", System.currentTimeMillis());
            byte[] bytes = packet.toString().getBytes(StandardCharsets.UTF_8);
            DatagramPacket datagram = new DatagramPacket(
                bytes, bytes.length, InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT);
            socketRef.send(datagram);
        } catch (Exception ignored) {
            // 广播失败静默，下个周期重试。
        }
    }

    private void receiveLoop() {
        byte[] buffer = new byte[8192];
        DatagramSocket socketRef = socket;
        while (socketRef != null && !socketRef.isClosed()) {
            try {
                DatagramPacket datagram = new DatagramPacket(buffer, buffer.length);
                socketRef.receive(datagram);
                String message = new String(datagram.getData(), datagram.getOffset(), datagram.getLength(), StandardCharsets.UTF_8);
                handleMessage(message, datagram.getAddress().getHostAddress());
            } catch (Exception error) {
                break; // socket 关闭：退出循环
            }
            socketRef = socket;
        }
    }

    private void handleMessage(String message, String senderHost) {
        JSONObject data;
        try { data = new JSONObject(message); } catch (Exception error) { return; }
        String id = data.optString("id", "");
        if (!APP_TAG.equals(data.optString("app")) || id.isEmpty()) return;

        String selfId;
        String selfTokenFP;
        synchronized (lock) {
            selfId = beacon.optString("id", "");
            selfTokenFP = beacon.optString("tokenFP", "");
        }
        if (id.equals(selfId)) return;                                         // 忽略自身
        String peerTokenFP = data.optString("tokenFP", "");
        if (!selfTokenFP.isEmpty() && !peerTokenFP.isEmpty() && !peerTokenFP.equals(selfTokenFP)) return; // 非同一密码/家庭

        try {
            JSONObject peer = new JSONObject();
            peer.put("id", id);
            peer.put("name", data.optString("name", id));
            peer.put("host", senderHost);
            peer.put("port", data.optInt("httpPort", SyncServer.SYNC_HTTP_PORT));
            peer.put("platform", data.optString("platform", ""));
            peer.put("role", data.optString("role", "auto"));
            peer.put("collecting", data.optBoolean("collecting", false));
            peer.put("lastSeen", System.currentTimeMillis());
            peers.put(id, peer);
        } catch (Exception ignored) {}
    }

    private void acquireMulticastLock() {
        try {
            WifiManager wifi = (WifiManager) appContext.getSystemService(Context.WIFI_SERVICE);
            if (wifi == null) return;
            WifiManager.MulticastLock nextLock = wifi.createMulticastLock("u50-sync-discovery");
            nextLock.setReferenceCounted(false);
            nextLock.acquire();
            multicastLock = nextLock;
        } catch (Exception ignored) {}
    }

    private void releaseMulticastLock() {
        WifiManager.MulticastLock lockRef = multicastLock;
        multicastLock = null;
        if (lockRef != null && lockRef.isHeld()) { try { lockRef.release(); } catch (Exception ignored) {} }
    }
}
