package cn.mu5120.console;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String APP_ASSET_HOST = "appassets.androidplatform.net";
    private WebView webView;
    private final Handler foregroundHandler = new Handler(Looper.getMainLooper());
    private final Runnable foregroundHeartbeat = new Runnable() {
        @Override
        public void run() {
            BackgroundMonitorService.setAppForeground(MainActivity.this, true);
            foregroundHandler.postDelayed(this, 5000);
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFFF3F5F8);
        webView.getSettings().setJavaScriptEnabled(true);
        // The asset entry point keeps the same URL across APK updates. Avoid
        // reusing a cached index that still points at an older hashed bundle.
        webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setSupportZoom(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.addJavascriptInterface(new RouterBridge(webView), "AndroidRouter");
        BackgroundMonitorService.start(this);
        BackgroundMonitorService.setAppForeground(this, true);
        BackgroundMonitorService.refreshOverlay(this);
        requestNotificationPermissionIfNeeded();
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                android.util.Log.d("MU5120", message.message() + " @" + message.lineNumber());
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAppAssetUrl(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isAppAssetUrl(Uri.parse(url));
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loadAppAsset(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return loadAppAsset(Uri.parse(url));
            }
        });

        setContentView(webView);
        webView.loadUrl("https://" + APP_ASSET_HOST + "/index.html");
    }

    private boolean isAppAssetUrl(Uri uri) {
        return uri != null
            && "https".equalsIgnoreCase(uri.getScheme())
            && APP_ASSET_HOST.equalsIgnoreCase(uri.getHost());
    }

    private WebResourceResponse loadAppAsset(Uri uri) {
        if (!isAppAssetUrl(uri)) return null;

        String path = uri.getPath();
        while (path != null && path.startsWith("/")) path = path.substring(1);
        if (path == null || path.isEmpty()) path = "index.html";
        if (path.contains("..") || path.contains("\\")) return notFoundResponse();

        try {
            InputStream stream = getAssets().open("www/" + path);
            WebResourceResponse response = new WebResourceResponse(mimeType(path), textEncoding(path), stream);
            response.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-store, no-cache, must-revalidate"));
            return response;
        } catch (IOException ignored) {
            return notFoundResponse();
        }
    }

    private static WebResourceResponse notFoundResponse() {
        return new WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            Collections.emptyMap(),
            new ByteArrayInputStream(new byte[0])
        );
    }

    private static String mimeType(String path) {
        String value = path.toLowerCase();
        if (value.endsWith(".html")) return "text/html";
        if (value.endsWith(".js") || value.endsWith(".mjs")) return "text/javascript";
        if (value.endsWith(".css")) return "text/css";
        if (value.endsWith(".json")) return "application/json";
        if (value.endsWith(".svg")) return "image/svg+xml";
        if (value.endsWith(".png")) return "image/png";
        if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg";
        if (value.endsWith(".webp")) return "image/webp";
        if (value.endsWith(".woff2")) return "font/woff2";
        if (value.endsWith(".woff")) return "font/woff";
        if (value.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private static String textEncoding(String path) {
        String value = path.toLowerCase();
        return value.endsWith(".html") || value.endsWith(".js") || value.endsWith(".mjs")
            || value.endsWith(".css") || value.endsWith(".json") || value.endsWith(".svg")
            ? "UTF-8"
            : null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        foregroundHandler.removeCallbacks(foregroundHeartbeat);
        foregroundHeartbeat.run();
        BackgroundMonitorService.refreshOverlay(this);
        if (webView == null) return;
        webView.resumeTimers();
        webView.onResume();
        webView.postDelayed(() -> webView.evaluateJavascript(
            "window.dispatchEvent(new Event('pageshow'));window.dispatchEvent(new Event('resize'));",
            null
        ), 160);
    }

    @Override
    protected void onPause() {
        foregroundHandler.removeCallbacks(foregroundHeartbeat);
        BackgroundMonitorService.setAppForeground(this, false);
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1001);
        }
    }

    @Override
    protected void onDestroy() {
        foregroundHandler.removeCallbacks(foregroundHeartbeat);
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidRouter");
            webView.destroy();
        }
        super.onDestroy();
    }
}
