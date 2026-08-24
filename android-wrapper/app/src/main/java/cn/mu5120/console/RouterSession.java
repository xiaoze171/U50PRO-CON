package cn.mu5120.console;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Shares the router's single management session between the WebView bridge and background service. */
final class RouterSession {
    private static final Map<String, String> COOKIES = new HashMap<>();

    private RouterSession() {}

    static synchronized void clear() {
        COOKIES.clear();
    }

    static synchronized void replace(String cookieHeader) {
        COOKIES.clear();
        if (cookieHeader == null || cookieHeader.trim().isEmpty()) return;
        for (String raw : cookieHeader.split(";")) {
            String value = raw.trim();
            int separator = value.indexOf('=');
            if (separator > 0) COOKIES.put(value.substring(0, separator), value.substring(separator + 1));
        }
    }

    static synchronized String header() {
        StringBuilder output = new StringBuilder();
        for (Map.Entry<String, String> entry : COOKIES.entrySet()) {
            if (output.length() > 0) output.append("; ");
            output.append(entry.getKey()).append('=').append(entry.getValue());
        }
        return output.toString();
    }

    static synchronized void remember(Map<String, List<String>> headers) {
        if (headers == null) return;
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (entry.getKey() == null || !"Set-Cookie".equalsIgnoreCase(entry.getKey())) continue;
            for (String raw : entry.getValue()) {
                String first = raw.split(";", 2)[0];
                int separator = first.indexOf('=');
                if (separator > 0) COOKIES.put(first.substring(0, separator), first.substring(separator + 1));
            }
        }
    }
}
