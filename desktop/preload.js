// preload：在隔离世界里通过 contextBridge 暴露 window.DesktopRouter，
// 方法签名与安卓的 window.AndroidRouter 对齐，页面里的 router-client.js 直接复用。
// 请求走 IPC 交给主进程；响应由主进程 executeJavaScript 回递到页面主世界的
// window.__mu5120NativeResponse(id, json)（等价于安卓 evaluateJavascript）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DesktopRouter', {
  // 异步：路由器请求。payload 为 JSON 字符串，主进程解析后发起 HTTP。
  request(id, payload) {
    ipcRenderer.send('router:request', { id: String(id), payload: String(payload) });
  },
  // 清除路由器会话（改配置/退出登录时调用）。
  clearSession() {
    ipcRenderer.send('router:clear-session');
  },
  // 同步后台采集配置（路由器地址 + 密码）。
  configureBackground(routerUrl, password) {
    ipcRenderer.send('bg:configure', { routerUrl, password });
  },
  // 推送最新状态快照（供 Phase D 常驻采集/悬浮窗使用）。
  updateBackgroundSnapshot(payload) {
    ipcRenderer.send('bg:snapshot', String(payload == null ? '' : payload));
  },
  // 同步读取后台电池历史（返回 JSON 字符串），与安卓返回值形态一致。
  getBackgroundBatteryHistory() {
    try { return ipcRenderer.sendSync('bg:battery-history') || '[]'; }
    catch { return '[]'; }
  },

  // —— 局域网同步（方法面与安卓 AndroidRouter 的 sync* 对齐）——
  // 启停同步服务 + 发现信标。
  syncSetEnabled(enabled) {
    ipcRenderer.send('sync:set-enabled', !!enabled);
  },
  // 告知主进程对外宣告的角色与是否在采集（供信标广播）。
  syncSetAdvertise(role, collecting) {
    ipcRenderer.send('sync:advertise', { role: String(role || 'auto'), collecting: !!collecting });
  },
  // 推送最新序列化 store（JSON 字符串），供同步服务端返回给查看端。
  syncPublish(payload) {
    ipcRenderer.send('sync:publish', String(payload == null ? '' : payload));
  },
  // 同步读取发现到的 peer 列表（JSON 字符串数组）。
  syncGetPeers() {
    try { return ipcRenderer.sendSync('sync:get-peers') || '[]'; }
    catch { return '[]'; }
  },
  // 同步读取本机身份（id/name/platform/tokenFP/httpPort/enabled）。
  syncGetSelf() {
    try { return ipcRenderer.sendSync('sync:get-self') || '{}'; }
    catch { return '{}'; }
  },
  // 取走并清空入站队列（别人 POST 来的历史片段，交前端合并）。
  syncDrainInbound() {
    try { return ipcRenderer.sendSync('sync:drain-inbound') || '[]'; }
    catch { return '[]'; }
  },
  // 异步：向 peer 发同步请求。payload={host,port,path,method,body}；
  // 响应经主进程回递到 window.__mu5120SyncResponse(id, json)。
  syncFetch(id, payload) {
    ipcRenderer.send('sync:fetch', { id: String(id), payload: String(payload) });
  }
});
