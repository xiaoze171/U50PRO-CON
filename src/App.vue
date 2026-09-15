<script>
function disablePinchZoom() {
  if (typeof document === 'undefined') return;
  const preventMultiTouch = event => {
    if (event.touches && event.touches.length > 1) event.preventDefault();
  };
  document.addEventListener('touchstart', preventMultiTouch, { passive: false });
  document.addEventListener('touchmove', preventMultiTouch, { passive: false });
  document.addEventListener('gesturestart', event => event.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', event => event.preventDefault(), { passive: false });
}

export default {
  onLaunch() {
    disablePinchZoom();
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
  background: #eef1f7;
  color: #101828;
  font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

html,
body,
#app,
uni-app {
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

button::after {
  border: 0;
}

/* 隐藏滚动条（Electron/WebView 里的竖向滚动条影响观感），滚动功能保留。 */
::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

/* uni.showModal 弹窗玻璃化（H5/WebView 渲染为 DOM，全局样式可覆盖）：
 * 半透明白 + backdrop 模糊 + 顶部内高光，与页面玻璃面板同材质。 */
uni-modal .uni-modal {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px) saturate(1.7);
  -webkit-backdrop-filter: blur(20px) saturate(1.7);
  box-shadow: 0 24px 56px rgba(24, 39, 75, 0.22), inset 0 1.5px 0 rgba(255, 255, 255, 0.85);
}

uni-modal .uni-modal__hd {
  padding: 20px 24px 0;
  color: #101828;
  font-weight: 700;
}

uni-modal .uni-modal__bd {
  padding: 12px 24px 20px;
  color: #47536b;
}

uni-modal .uni-modal__btn {
  color: #6d5bd0;
  font-weight: 700;
}

uni-modal .uni-modal__btn_default {
  color: #64748b;
  font-weight: 500;
}

uni-modal .uni-modal__ft::before {
  background: rgba(23, 32, 51, 0.08);
}
</style>
