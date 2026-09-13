package cn.mu5120.console;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原厂后台本地反代：手机本机 127.0.0.1 上的迷你 HTTP 服务，把所有请求
 * （含 POST——shouldInterceptRequest 拿不到请求体，故不走 WebView 拦截）
 * 原样转发到路由器，等价于浏览器开发时 vite 的 /router-api 代理。
 * iframe 从 http://127.0.0.1:<port>/index.html 加载原厂界面：
 * - 响应剥离 X-Frame-Options / CSP（跨源 iframe 才能内嵌）；
 * - 请求由手机本机发出，与 RouterBridge 同一出口 IP，天然共享路由器会话。
 */
final class StockProxyServer {
    private static final int PORT_BEGIN = 8123;
    private static final int PORT_END = 8130;
    private static final int MAX_BODY = 2 * 1024 * 1024;

    private final Object lock = new Object();
    private ServerSocket serverSocket;
    private ExecutorService executor;
    private volatile int port = 0;

    int getPort() {
        return port;
    }

    void start() {
        synchronized (lock) {
            if (serverSocket != null) return;
            for (int candidate = PORT_BEGIN; candidate <= PORT_END; candidate++) {
                try {
                    ServerSocket socket = new ServerSocket();
                    socket.setReuseAddress(true);
                    socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), candidate));
                    serverSocket = socket;
                    port = candidate;
                    executor = Executors.newFixedThreadPool(6);
                    break;
                } catch (IOException error) {
                    // 端口被占：试下一个
                }
            }
            if (serverSocket == null) return;
            Thread thread = new Thread(this::acceptLoop, "u50-stock-proxy");
            thread.setDaemon(true);
            thread.start();
        }
    }

    void stop() {
        ServerSocket socket;
        ExecutorService pool;
        synchronized (lock) {
            socket = serverSocket;
            pool = executor;
            serverSocket = null;
            executor = null;
            port = 0;
        }
        if (socket != null) { try { socket.close(); } catch (Exception ignored) {} }
        if (pool != null) pool.shutdownNow();
    }

    private void acceptLoop() {
        ServerSocket socket = serverSocket;
        while (socket != null && !socket.isClosed()) {
            try {
                Socket client = socket.accept();
                ExecutorService pool = executor;
                if (pool != null) pool.execute(() -> handle(client));
                else { try { client.close(); } catch (Exception ignored) {} }
            } catch (IOException error) {
                break; // socket 关闭：退出循环
            }
            socket = serverSocket;
        }
    }

    private void handle(Socket client) {
        try {
            client.setSoTimeout(10000);
            InputStream input = client.getInputStream();
            OutputStream output = client.getOutputStream();
            String requestLine = readLine(input);
            if (requestLine == null || requestLine.isEmpty()) { client.close(); return; }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) { output.write(plainResponse(400, "bad request")); client.close(); return; }
            String method = parts[0].toUpperCase(Locale.US);
            String target = parts[1];

            Map<String, String> headers = new HashMap<>();
            String headerLine;
            while ((headerLine = readLine(input)) != null && !headerLine.isEmpty()) {
                int separator = headerLine.indexOf(':');
                if (separator > 0) {
                    headers.put(headerLine.substring(0, separator).trim().toLowerCase(Locale.US),
                        headerLine.substring(separator + 1).trim());
                }
            }
            int contentLength = 0;
            try { contentLength = Integer.parseInt(headers.getOrDefault("content-length", "0")); } catch (Exception ignored) {}
            byte[] body = contentLength > 0 && contentLength <= MAX_BODY ? readFully(input, contentLength) : new byte[0];

            output.write(forward(method, target, headers, body));
            output.flush();
            client.close();
        } catch (Exception error) {
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    /** 转发到路由器并组装完整 HTTP 响应。 */
    private byte[] forward(String method, String target, Map<String, String> headers, byte[] body) {
        try {
            String base = RouterBridge.getRouterBaseUrl();
            URL url = new URL(base + target);
            if (!RouterBridge.isLocalRouterHost(url.getHost())) {
                return plainResponse(403, "forbidden");
            }
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(15000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "*/*");
            connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            connection.setRequestProperty("Origin", base);
            connection.setRequestProperty("Referer", base + "/index.html");
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                String name = entry.getKey();
                if (name.equals("host") || name.equals("cookie") || name.equals("origin")
                    || name.equals("referer") || name.equals("accept-encoding")
                    || name.equals("content-length") || name.equals("connection")) continue;
                connection.setRequestProperty(name, entry.getValue());
            }
            // 路由器会话由 HttpOnly Cookie 识别（非 IP）：必须带上原生层
            // RouterSession 持有的会话 Cookie，原厂界面才能共享 App 的登录态。
            String sessionCookie = RouterSession.header();
            if (!sessionCookie.isEmpty()) connection.setRequestProperty("Cookie", sessionCookie);
            if (body.length > 0) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                OutputStream out = connection.getOutputStream();
                try {
                    out.write(body);
                    out.flush();
                } finally {
                    try { out.close(); } catch (IOException ignored) {}
                }
            }
            int status = connection.getResponseCode();
            // 原厂界面内的登录/注销等操作会下发新 Cookie，回收进共享会话，
            // 保持 WebView 桥、后台服务与原厂界面三者同一会话。
            RouterSession.remember(connection.getHeaderFields());
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] payload = stream == null ? new byte[0] : readFully(stream, -1);
            String contentType = connection.getContentType();
            if (contentType == null) contentType = "application/octet-stream";
            // 响应头刻意精简：X-Frame-Options / CSP 必须剥离（跨源 iframe 内嵌的前提），
            // 长度按（已透明解压的）正文重算，Connection: close 简化连接管理。
            String head = "HTTP/1.1 " + status + " " + reason(status) + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + payload.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
            ByteArrayOutputStream out = new ByteArrayOutputStream(head.length() + payload.length);
            out.write(head.getBytes(StandardCharsets.US_ASCII));
            out.write(payload);
            return out.toByteArray();
        } catch (Exception error) {
            return plainResponse(502, "router unreachable");
        }
    }

    private static String reason(int status) {
        return status >= 200 && status < 300 ? "OK" : "HTTP " + status;
    }

    private static byte[] plainResponse(int status, String text) {
        String head = "HTTP/1.1 " + status + " " + reason(status) + "\r\n"
            + "Content-Type: text/plain\r\n"
            + "Content-Length: " + text.getBytes(StandardCharsets.UTF_8).length + "\r\n"
            + "Connection: close\r\n\r\n" + text;
        return head.getBytes(StandardCharsets.UTF_8);
    }

    private static String readLine(InputStream input) throws IOException {
        StringBuilder line = new StringBuilder();
        int b;
        while ((b = input.read()) >= 0) {
            if (b == '\n') break;
            if (b != '\r') line.append((char) b);
        }
        return line.length() == 0 && b < 0 ? null : line.toString();
    }

    private static byte[] readFully(InputStream input, int length) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        if (length >= 0) {
            int remaining = length;
            while (remaining > 0) {
                int read = input.read(chunk, 0, Math.min(chunk.length, remaining));
                if (read < 0) break;
                buffer.write(chunk, 0, read);
                remaining -= read;
            }
        } else {
            int read;
            while ((read = input.read(chunk)) >= 0) buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }
}
