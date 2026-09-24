package cn.mu5120.console;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

/** A local router remains reachable over Wi-Fi even if Android prefers mobile data. */
final class RouterNetwork {
    // Each Network instance lazily creates its own OkHttp connection pool (and a
    // pool-cleanup thread), so the Wi-Fi Network must be cached and reused across
    // requests instead of re-fetched from getAllNetworks() every time.
    private static Network wifiNetwork;

    static HttpURLConnection open(Context context, URL url) throws IOException {
        String host = url.getHost();
        if (!"127.0.0.1".equals(host) && !"localhost".equalsIgnoreCase(host)) {
            Network network = wifi(context);
            if (network != null) return (HttpURLConnection) network.openConnection(url);
        }
        return (HttpURLConnection) url.openConnection();
    }

    private static synchronized Network wifi(Context context) {
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return null;
        if (wifiNetwork != null && isWifi(manager, wifiNetwork)) return wifiNetwork;
        wifiNetwork = null;
        for (Network network : manager.getAllNetworks()) {
            if (isWifi(manager, network)) {
                wifiNetwork = network;
                break;
            }
        }
        return wifiNetwork;
    }

    private static boolean isWifi(ConnectivityManager manager, Network network) {
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    private RouterNetwork() { }
}
