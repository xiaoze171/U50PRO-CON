package cn.mu5120.console;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.io.File;
import java.util.Arrays;

/** Downloads are owned by Android and survive activity/process recreation. */
public final class UpdateBridge {
    private final Activity activity;
    private final DownloadManager downloads;
    private final SharedPreferences prefs;
    private volatile String error = "";

    public UpdateBridge(Activity activity) {
        this.activity = activity;
        downloads = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        prefs = activity.getSharedPreferences("apk-update", Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public synchronized void download(String url, String version) {
        try {
            String expected = "https://github.com/xiaoze171/U50PRO-CON/releases/download/v" + version
                    + "/U50PRO-Console-v" + version + ".apk";
            if (!version.matches("\\d+\\.\\d+\\.\\d+") || !expected.equals(url))
                throw new Exception("安装包地址无效，请重新检查更新");
            JSONObject current = new JSONObject(status());
            if ("downloading".equals(current.optString("state"))) return;
            long old = prefs.getLong("id", -1);
            if (old != -1) downloads.remove(old);
            File file = new File(activity.getExternalFilesDir(null), "update.apk");
            if (file.exists() && !file.delete()) throw new Exception("无法清理上次的安装包");
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle("U50 Pro 更新 v" + version)
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                    .setDestinationUri(Uri.fromFile(file));
            long id = downloads.enqueue(request);
            prefs.edit().putLong("id", id).putString("version", version).apply();
            error = "";
        } catch (Exception e) { error = e.getMessage(); }
    }

    @JavascriptInterface
    public synchronized String status() {
        JSONObject result = new JSONObject();
        try {
            result.put("state", "idle");
            result.put("version", prefs.getString("version", ""));
            if (!error.isEmpty()) {
                result.put("state", "error").put("message", error);
                return result.toString();
            }
            long id = prefs.getLong("id", -1);
            if (id == -1) return result.toString();
            try (Cursor c = downloads.query(new DownloadManager.Query().setFilterById(id))) {
                if (c == null || !c.moveToFirst()) return result.toString();
                int state = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if (state == DownloadManager.STATUS_SUCCESSFUL) result.put("state", "ready");
                else if (state == DownloadManager.STATUS_FAILED) {
                    result.put("state", "error").put("message", "下载失败，请重试（"
                            + c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)) + "）");
                } else {
                    long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    long done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    result.put("state", "downloading").put("progress", total > 0 ? done * 100 / total : -1);
                    result.put("message", state == DownloadManager.STATUS_PAUSED ? "等待网络，恢复后继续下载" : "正在下载");
                }
            }
        } catch (Exception e) {
            try { result.put("state", "error").put("message", "无法读取下载状态，请重试"); } catch (Exception ignored) { }
        }
        return result.toString();
    }

    @JavascriptInterface
    public void install() {
        activity.runOnUiThread(() -> {
            try {
                error = "";
                if (!"ready".equals(new JSONObject(status()).optString("state")))
                    throw new Exception("安装包尚未下载完成");
                File file = new File(activity.getExternalFilesDir(null), "update.apk");
                PackageManager pm = activity.getPackageManager();
                PackageInfo apk = pm.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNATURES);
                PackageInfo current = pm.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNATURES);
                if (apk == null || !current.packageName.equals(apk.packageName)
                        || !prefs.getString("version", "").equals(apk.versionName)
                        || apk.versionCode <= current.versionCode
                        || apk.signatures == null || !Arrays.equals(current.signatures, apk.signatures))
                    throw new Exception("安装包版本或签名校验失败，请重新下载");
                if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
                    activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + activity.getPackageName())));
                    android.widget.Toast.makeText(activity, "请允许安装应用，返回后点击安装更新", android.widget.Toast.LENGTH_LONG).show();
                    return;
                }
                Uri uri = downloads.getUriForDownloadedFile(prefs.getLong("id", -1));
                if (uri == null) throw new Exception("安装包不存在，请重新下载");
                activity.startActivity(new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
            } catch (Exception e) { error = e.getMessage() == null ? "无法启动安装，请重试" : e.getMessage(); }
        });
    }
}
