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
  background: #f5f7fb;
  color: #172033;
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
</style>
