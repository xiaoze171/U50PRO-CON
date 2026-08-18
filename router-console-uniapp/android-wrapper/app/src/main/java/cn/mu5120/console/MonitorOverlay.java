package cn.mu5120.console;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

final class MonitorOverlay {
    private static final String PREFS = "u50pro_background_monitor";
    private static final String KEY_X = "overlayX";
    private static final String KEY_Y = "overlayY";

    private final Context context;
    private final SharedPreferences preferences;
    private final WindowManager windowManager;
    private LinearLayout root;
    private TextView speedText;
    private TextView batteryText;
    private WindowManager.LayoutParams layoutParams;

    MonitorOverlay(Context context) {
        this.context = context.getApplicationContext();
        this.preferences = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.windowManager = (WindowManager) this.context.getSystemService(Context.WINDOW_SERVICE);
    }

    void update(String down, String up, String battery, String temperature, String error) {
        if (!canDraw()) {
            remove();
            return;
        }
        ensureView();
        if (root == null) return;
        if (error != null && !error.isEmpty()) {
            speedText.setText("等待路由器连接");
        } else {
            speedText.setText("↓ " + down + "   ↑ " + up + "   ·   " + battery + "   " + temperature);
        }
    }

    void remove() {
        if (root == null || windowManager == null) return;
        try {
            windowManager.removeView(root);
        } catch (Exception ignored) {}
        root = null;
        speedText = null;
        batteryText = null;
        layoutParams = null;
    }

    private boolean canDraw() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context);
    }

    private void ensureView() {
        if (root != null || windowManager == null) return;

        LinearLayout container = new LinearLayout(context);
        container.setOrientation(LinearLayout.HORIZONTAL);
        container.setPadding(dp(12), dp(7), dp(12), dp(7));

        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(180, 15, 23, 42));
        background.setCornerRadius(dp(14));
        background.setStroke(dp(1), Color.argb(42, 255, 255, 255));
        container.setBackground(background);

        speedText = createTextView(12, Color.WHITE);
        speedText.setShadowLayer(dp(1.5f), 0, dp(1), Color.argb(80, 0, 0, 0));
        batteryText = null;
        container.addView(speedText);

        int type = Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        layoutParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            android.graphics.PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = preferences.getInt(KEY_X, Math.max(dp(12), screenWidth() - dp(230)));
        layoutParams.y = preferences.getInt(KEY_Y, dp(110));

        container.setOnTouchListener(new DragListener());
        try {
            windowManager.addView(container, layoutParams);
            root = container;
        } catch (Exception ignored) {
            root = null;
            layoutParams = null;
        }
    }

    private TextView createTextView(float size, int color) {
        TextView view = new TextView(context);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setSingleLine(true);
        view.setIncludeFontPadding(false);
        return view;
    }

    private int screenWidth() {
        return context.getResources().getDisplayMetrics().widthPixels;
    }

    private int screenHeight() {
        return context.getResources().getDisplayMetrics().heightPixels;
    }

    private int dp(float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    private final class DragListener implements View.OnTouchListener {
        private float downRawX;
        private float downRawY;
        private int startX;
        private int startY;

        @Override
        public boolean onTouch(View view, MotionEvent event) {
            if (layoutParams == null) return false;
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                startX = layoutParams.x;
                startY = layoutParams.y;
                return true;
            }
            if (event.getAction() == MotionEvent.ACTION_MOVE) {
                int nextX = startX + Math.round(event.getRawX() - downRawX);
                int nextY = startY + Math.round(event.getRawY() - downRawY);
                layoutParams.x = Math.max(0, Math.min(nextX, screenWidth() - view.getWidth()));
                layoutParams.y = Math.max(0, Math.min(nextY, screenHeight() - view.getHeight()));
                try {
                    windowManager.updateViewLayout(view, layoutParams);
                } catch (Exception ignored) {}
                return true;
            }
            if (event.getAction() == MotionEvent.ACTION_UP || event.getAction() == MotionEvent.ACTION_CANCEL) {
                preferences.edit().putInt(KEY_X, layoutParams.x).putInt(KEY_Y, layoutParams.y).apply();
                return true;
            }
            return false;
        }
    }
}
