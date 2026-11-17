package cn.mu5120.console;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

/** Fixed login vectors protect the router's uppercase, UTF-8 SHA256 contract. */
public final class NativeRouterAuthTest {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        Class<?> auth;
        try { auth = Class.forName("cn.mu5120.console.RouterAuth"); }
        catch (ClassNotFoundException error) {
            throw new AssertionError("Router authentication must remain available independently of LAN services", error);
        }
        Method digest = auth.getDeclaredMethod("sha256Hex", String.class);
        Method login = auth.getDeclaredMethod("loginHash", String.class, String.class);
        digest.setAccessible(true);
        login.setAccessible(true);
        String[][] vectors = {
            { "", "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" },
            { "abc", "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD" },
            { "111111", "BCB15F821479B4D5772BD0CA866C00AD5F926E3580720659CC80D39C9D09802A" },
            { "路由器密碼🔒", "C6A41D42EC467A1369F50B4D6B215BC7893B965037EB833A08FECACB0D710D54" }
        };
        for (String[] vector : vectors) {
            check(vector[1].equals(digest.invoke(null, vector[0])), "digest must use UTF-8 and uppercase hexadecimal");
        }
        check(vectors[0][1].equals(digest.invoke(null, new Object[] { null })), "null digest preserves the empty-password behavior");
        check("5A07F1F10D13DB03D7259BFE67D3917E1D4C8CB6F81E04A8DAEC230295B3DC86".equals(
            login.invoke(null, "111111", "fixture-LD-123")), "login hashes uppercase password digest plus the dynamic LD");
        check("3FF6A3DEF65A3221782B1E51C847F0629C64FBC8C8C0E8AF523B7644C938A4C1".equals(
            login.invoke(null, "路由器密碼🔒", "動態LD")), "login preserves non-ASCII passwords and challenges");
        check("F8BBB0CCB2491CA29A3DF03D6F92277A4F3574266507ACD77214D37ECA3F3082".equals(
            login.invoke(null, "", "")), "empty challenge still performs both SHA256 stages");
        testNativeLoginRequest();
        System.out.println("PASS native router authentication UTF-8, uppercase digest, dynamic login vectors and LOGIN request/session");
    }

    private static void testNativeLoginRequest() throws Exception {
        AtomicReference<String> body = new AtomicReference<>();
        HttpServer router = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        router.createContext("/", exchange -> {
            String query = exchange.getRequestURI().getRawQuery();
            byte[] response = (query != null && query.contains("cmd=LD")
                ? "{\"LD\":\"fixture-LD-123\"}" : "{}").getBytes(StandardCharsets.UTF_8);
            if ("POST".equals(exchange.getRequestMethod())) {
                ByteArrayOutputStream received = new ByteArrayOutputStream();
                try (InputStream input = exchange.getRequestBody()) {
                    byte[] buffer = new byte[1024];
                    int length;
                    while ((length = input.read(buffer)) != -1) received.write(buffer, 0, length);
                }
                body.set(new String(received.toByteArray(), StandardCharsets.UTF_8));
                exchange.getResponseHeaders().add("Set-Cookie", "SID=fixture-session; Path=/; HttpOnly");
            }
            exchange.sendResponseHeaders(200, response.length);
            try { exchange.getResponseBody().write(response); }
            finally { exchange.close(); }
        });
        router.start();
        try {
            // Only bypass the Android asset/context constructor. The actual login,
            // HTTP transport, form encoding and cookie handling execute unchanged.
            Class<?> allocator = Class.forName("sun.misc.Unsafe");
            Field singleton = allocator.getDeclaredField("theUnsafe");
            singleton.setAccessible(true);
            MonitorRouterClient client = (MonitorRouterClient) allocator.getMethod("allocateInstance", Class.class)
                .invoke(singleton.get(null), MonitorRouterClient.class);
            Field url = MonitorRouterClient.class.getDeclaredField("routerUrl");
            Field password = MonitorRouterClient.class.getDeclaredField("password");
            url.setAccessible(true);
            password.setAccessible(true);
            url.set(client, "http://127.0.0.1:" + router.getAddress().getPort());
            password.set(client, "111111");
            Method login = MonitorRouterClient.class.getDeclaredMethod("login");
            login.setAccessible(true);
            login.invoke(client);
            check("isTest=false&goformId=LOGIN&password=5A07F1F10D13DB03D7259BFE67D3917E1D4C8CB6F81E04A8DAEC230295B3DC86".equals(body.get()),
                "actual native LOGIN submits the LD-derived uppercase hash");
            check("SID=fixture-session".equals(RouterSession.header()), "successful native login retains the router session");
        } finally {
            RouterSession.clear();
            router.stop(0);
        }
    }
}
