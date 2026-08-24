package cn.mu5120.console;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import java.util.Locale;

final class MonitorOverlay {
    private static final String PREFS = "u50pro_background_monitor";
    private static final String KEY_X = "overlayX";
    private static final String KEY_Y = "overlayY";
    private static final int OVERLAY_WIDTH_DP = 290;
    private static final int OVERLAY_HEIGHT_DP = 34;

    private final Context context;
    private final SharedPreferences preferences;
    private final WindowManager windowManager;
    private OverlayView root;
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
            root.setValues("离线", "--", "--", "--");
        } else {
            root.setValues(compactRate(down), compactRate(up), normalize(battery), normalize(temperature));
        }
    }

    void remove() {
        if (root == null || windowManager == null) return;
        try {
            windowManager.removeView(root);
        } catch (Exception ignored) {}
        root = null;
        layoutParams = null;
    }

    private boolean canDraw() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context);
    }

    private void ensureView() {
        if (root != null || windowManager == null) return;

        OverlayView container = new OverlayView(context);

        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.TRANSPARENT);
        background.setCornerRadius(dp(12));
        background.setStroke(0, Color.TRANSPARENT);
        container.setBackground(background);

        int type = Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        layoutParams = new WindowManager.LayoutParams(
            dp(OVERLAY_WIDTH_DP),
            dp(OVERLAY_HEIGHT_DP),
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            android.graphics.PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        int defaultX = Math.max(dp(12), screenWidth() - dp(OVERLAY_WIDTH_DP) - dp(12));
        layoutParams.x = Math.max(0, Math.min(
            preferences.getInt(KEY_X, defaultX),
            screenWidth() - dp(OVERLAY_WIDTH_DP)
        ));
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

    private String normalize(String value) {
        return value == null || value.isEmpty() ? "--" : value;
    }

    private String compactRate(String value) {
        if (value == null || value.trim().isEmpty() || "未知".equals(value)) return "--";
        String text = value.trim().toUpperCase(Locale.US);
        try {
            double number;
            if (text.endsWith("MB/S")) number = Double.parseDouble(text.substring(0, text.length() - 4).trim());
            else if (text.endsWith("KB/S")) number = Double.parseDouble(text.substring(0, text.length() - 4).trim()) / 1024d;
            else if (text.endsWith("B/S")) number = Double.parseDouble(text.substring(0, text.length() - 3).trim()) / (1024d * 1024d);
            else number = Double.parseDouble(text) / (1024d * 1024d);
            if (!Double.isFinite(number) || number < 0) return "0.00 MB/s";
            return String.format(Locale.US, "%.2f MB/s", number);
        } catch (Exception ignored) {
            return "--";
        }
    }

    private final class OverlayView extends View {
        private final Paint valuePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint separatorPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private String[] values = {"--", "--", "--", "--"};

        OverlayView(Context context) {
            super(context);
            setWillNotDraw(false);
            valuePaint.setTextSize(dp(10));
            valuePaint.setTypeface(Typeface.MONOSPACE);
            valuePaint.setTextAlign(Paint.Align.CENTER);
            valuePaint.setColor(Color.WHITE);
            valuePaint.setShadowLayer(dp(1.5f), 0, dp(1), Color.argb(80, 0, 0, 0));
            separatorPaint.setColor(Color.argb(38, 15, 23, 42));
            separatorPaint.setStrokeWidth(Math.max(1, dp(1)));
        }

        void setValues(String down, String up, String battery, String temperature) {
            String[] next = {normalize(down), normalize(up), normalize(battery), normalize(temperature)};
            boolean changed = false;
            for (int index = 0; index < values.length; index++) {
                if (!values[index].equals(next[index])) changed = true;
            }
            if (!changed) return;
            values = next;
            postInvalidateOnAnimation();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int padding = dp(12);
            int usableWidth = Math.max(1, getWidth() - padding * 2);
            int downWidth = Math.round(usableWidth * 0.35f);
            int upWidth = Math.round(usableWidth * 0.35f);
            int batteryWidth = Math.round(usableWidth * 0.15f);
            int temperatureWidth = usableWidth - downWidth - upWidth - batteryWidth;
            float valueY = (getHeight() - valuePaint.ascent() - valuePaint.descent()) / 2f;
            String[] display = {
                "↓ " + values[0],
                "↑ " + values[1],
                values[2],
                values[3]
            };
            int[] widths = {downWidth, upWidth, batteryWidth, temperatureWidth};
            int left = padding;
            for (int index = 0; index < 4; index++) {
                int width = widths[index];
                float centerX = left + width / 2f;
                valuePaint.setColor(index == 0 ? Color.rgb(37, 99, 235)
                    : index == 1 ? Color.rgb(8, 145, 178)
                    : index == 2 ? Color.rgb(5, 150, 105)
                    : Color.rgb(234, 88, 12));
                canvas.drawText(fit(display[index], width - dp(6)), centerX, valueY, valuePaint);
                if (index < 3) {
                    float separatorX = left + width;
                    canvas.drawLine(separatorX, dp(9), separatorX, getHeight() - dp(9), separatorPaint);
                }
                left += width;
            }
        }

        private String fit(String value, float maxWidth) {
            if (valuePaint.measureText(value) <= maxWidth) return value;
            String suffix = "…";
            String result = value;
            while (result.length() > 1 && valuePaint.measureText(result + suffix) > maxWidth) {
                result = result.substring(0, result.length() - 1);
            }
            return result + suffix;
        }
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
