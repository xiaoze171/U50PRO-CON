package cn.mu5120.console;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/** Password encoding required by the router's LOGIN command. */
final class RouterAuth {
    private RouterAuth() { }

    static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder();
            for (byte item : digest) output.append(String.format(Locale.US, "%02X", item));
            return output.toString();
        } catch (Exception error) {
            return "";
        }
    }

    static String loginHash(String password, String challenge) {
        return sha256Hex(sha256Hex(password) + challenge);
    }
}
