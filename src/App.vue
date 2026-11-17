<script>
export default {
  onLaunch() {
    let current = null;
    try { current = uni.getStorageSync('mu5120-config'); } catch {}
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      try {
        uni.setStorageSync('mu5120-config', {
          routerUrl: 'http://192.168.0.1',
          password: '111111',
          developerPassword: '111111',
          pollIntervalMs: 1000
        });
      } catch {}
    }
  }
};
</script>

<style>
page {
  min-height: 100%;
  background: #f3f5f8;
  color: #182332;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  font-size: 12px;
}

html,
body,
#app,
uni-app {
  /* Pinch policy stays in CSS + viewport/WebSettings. A non-passive document
   * touchmove listener makes every single-finger scroll wait for JavaScript. */
  touch-action: pan-x pan-y;
}

view,
text,
button,
input,
textarea,
section,
header,
main,
aside,
label {
  box-sizing: border-box;
}

button::after,
.app-shell button::after {
  border: 0;
}

/* Slim desktop scrollbars retain a useful indication of longer content. */
::-webkit-scrollbar {
  width: 5px;
  height: 4px;
}

::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: #c8d2df;
}

::-webkit-scrollbar-track {
  background: transparent;
}

/* Modal layers share the same opaque surface as the application. */
uni-modal .uni-modal {
  overflow: hidden;
  border: 1px solid #e5e9f0;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(23, 43, 69, 0.12);
}

uni-modal .uni-modal__hd {
  padding: 16px 20px 0;
  color: #182332;
  font-size: 16px;
  font-weight: 600;
}

uni-modal .uni-modal__bd {
  padding: 10px 20px 16px;
  color: #647186;
  font-size: 12px;
  line-height: 1.7;
}

uni-modal .uni-modal__btn {
  min-height: 48px;
  color: #4267ed;
  font-size: 13px;
  font-weight: 600;
}

uni-modal .uni-modal__btn_default {
  color: #647186;
  font-weight: 500;
}

uni-modal .uni-modal__ft::before {
  background: #e5e9f0;
}

uni-toast .uni-toast { border-radius: 10px; background: #182332; box-shadow: none; }

@media (max-width: 900px) {
  ::-webkit-scrollbar { width: 0; height: 0; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
</style>
