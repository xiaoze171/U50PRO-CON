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
  background: #f5f7fb;
  color: #172033;
  font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
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
