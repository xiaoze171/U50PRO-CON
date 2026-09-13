// U50 Pro 控制台 桌面端主进程。
// 定位：等价于安卓的 MainActivity + RouterBridge —— 加载同一份 H5 构建，
// 通过 preload 暴露的 window.DesktopRouter 桥接把路由器请求交给主进程完成
// （主进程注入 Origin/Referer/Cookie、走局域网 HTTP），页面逻辑零改动。
const { app, BrowserWindow, ipcMain, Menu, screen, shell, Tray, nativeImage } = require('electron');
const path = require('path');
const routerHttp = require('./router-http');
const session = require('./session');
const store = require('./store');
const syncServer = require('./sync-server');
const discovery = require('./discovery');

// H5 构建目录：开发时取仓库内 dist/build/h5，打包后取 resources/h5。
const H5_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'h5')
  : path.join(__dirname, '..', 'dist', 'build', 'h5');

// 运行时图标（托盘 + 窗口）。刻意放在 assets/ 而非 build/，避免 electron-builder
// 把 <256px 的图标当作打包图标源而报错；安装包图标沿用 electron 默认。
const ICON_PATH = path.join(__dirname, 'assets', 'tray.png');

let mainWindow = null;
let tray = null;
let residentNoticeShown = false;

// 后台配置与最新快照。Phase A 仅缓存；Phase D 用于主进程常驻采集。
let backgroundConfig = { routerUrl: '', password: '' };
let latestSnapshot = null;

// 局域网同步状态。角色由前端 services/sync.js 判定，主进程只做哑管道 + 广播。
let syncEnabled = false;
let syncAdvertise = { role: 'auto', collecting: false };

function createWindow() {
  const state = store.loadWindowState();
  // 拔掉副屏/改分辨率后，保存的坐标可能落在所有屏幕之外，窗口会"打开但看不见"
  //（实测出现过 x:-1720）。恢复前校验窗口与某块屏幕的工作区至少有 120×60 的
  // 可见重叠，否则丢弃坐标、按默认居中。
  let restoreX = Number.isInteger(state.x) ? state.x : undefined;
  let restoreY = Number.isInteger(state.y) ? state.y : undefined;
  if (restoreX !== undefined && restoreY !== undefined) {
    const restoreWidth = state.width || 1280;
    const restoreHeight = state.height || 860;
    const visible = screen.getAllDisplays().some(display => {
      const area = display.workArea;
      const overlapWidth = Math.min(restoreX + restoreWidth, area.x + area.width) - Math.max(restoreX, area.x);
      const overlapHeight = Math.min(restoreY + restoreHeight, area.y + area.height) - Math.max(restoreY, area.y);
      return overlapWidth >= 120 && overlapHeight >= 60;
    });
    if (!visible) {
      restoreX = undefined;
      restoreY = undefined;
    }
  }
  // 桌面默认尺寸取 1280×860：宽度 > 900px 断点，触发 index.css 里已有的桌面布局
  // （常驻侧边栏 + 多列内容），而非手机抽屉式窄屏布局。minWidth 锁在 1000（> 900）
  // 确保用户缩放窗口时也不会跌回手机版式。
  mainWindow = new BrowserWindow({
    width: state.width || 1280,
    height: state.height || 860,
    x: restoreX,
    y: restoreY,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#f5f7fb',
    autoHideMenuBar: true,
    title: 'U50 Pro 控制台',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 关键：不因窗口最小化/被遮挡而降频。渲染层的 1s 采集循环
      // （index.vue refresh）需持续运行，采集器才能常驻不断层。
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(H5_DIR, 'index.html'));

  // 页面内的外部链接交给系统浏览器，避免在应用窗口里跳走。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 关闭即退出会销毁渲染层、停掉采集循环 → 数据断层。因此当本机正作为
  // 采集器对外服务时，关闭改为隐藏到托盘（首次弹气泡告知），后台继续采集；
  // 非采集器（查看端/直连）保持原行为——关闭即退出。
  mainWindow.on('close', event => {
    if (app.isQuiting) return;
    if (!(syncEnabled && syncAdvertise.collecting)) return;
    event.preventDefault();
    mainWindow.hide();
    notifyResident();
  });

  const persist = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
      store.saveWindowState(mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', persist);
  mainWindow.on('move', persist);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// 从托盘/激活事件恢复主窗口。
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// 常驻托盘图标：左键唤出窗口，右键菜单显示/退出。仅在 whenReady 后创建一次。
function createTray() {
  if (tray) return;
  let image = nativeImage.createFromPath(ICON_PATH);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip('U50 Pro 控制台');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: showWindow },
    { type: 'separator' },
    { label: '退出程序', click: () => { app.isQuiting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

// 采集器首次隐藏到托盘时提示一次，避免用户以为程序已退出。
function notifyResident() {
  if (residentNoticeShown || !tray) return;
  residentNoticeShown = true;
  try {
    tray.displayBalloon({
      title: 'U50 Pro 控制台仍在后台运行',
      content: '正作为局域网采集器持续采集数据。需要退出请右键托盘图标选择“退出程序”。'
    });
  } catch {}
}

// 把响应回递到页面主世界，等价于安卓 RouterBridge.deliver 里的
// webView.evaluateJavascript("window.__mu5120NativeResponse(...)").
function deliver(id, resultJson) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const script = 'window.__mu5120NativeResponse && window.__mu5120NativeResponse('
    + JSON.stringify(String(id)) + ',' + JSON.stringify(resultJson) + ')';
  mainWindow.webContents.executeJavaScript(script).catch(() => {});
}

// 同步 fetch 的响应回递通道（独立于路由器请求，避免 id 空间冲突）。
function deliverSync(id, resultJson) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const script = 'window.__mu5120SyncResponse && window.__mu5120SyncResponse('
    + JSON.stringify(String(id)) + ',' + JSON.stringify(resultJson) + ')';
  mainWindow.webContents.executeJavaScript(script).catch(() => {});
}

// —— 桥接 IPC（方法面与安卓 AndroidRouter 对齐）——
ipcMain.on('router:request', async (event, message) => {
  const id = message && message.id;
  let payload;
  try { payload = JSON.parse(message && message.payload); } catch { payload = {}; }
  const result = await routerHttp.request(payload);
  deliver(id, JSON.stringify(result));
});

ipcMain.on('router:clear-session', () => { session.clear(); });

ipcMain.on('bg:configure', (event, message) => {
  backgroundConfig = {
    routerUrl: String((message && message.routerUrl) || ''),
    password: String((message && message.password) || '')
  };
  // 密码即同步令牌来源：启用中若密码变化，刷新令牌与信标指纹。
  if (syncEnabled) applySyncIdentity();
});

ipcMain.on('bg:snapshot', (event, payload) => {
  try { latestSnapshot = JSON.parse(payload); } catch {}
});

ipcMain.on('bg:battery-history', (event) => {
  // Phase A：桌面暂不做后台电池历史，返回空数组即与纯 H5 行为一致。
  event.returnValue = store.readBatteryHistory();
});

// —— 局域网同步 IPC —— 方法面与安卓 RouterBridge 的 sync* 对齐。
// 令牌由主进程从路由器密码派生（sha256），前端无需接触密钥。
function applySyncIdentity() {
  const id = store.getDeviceId();
  const name = store.getDeviceName();
  const version = app.getVersion();
  syncServer.setToken(backgroundConfig.password);
  syncServer.setSelf({ id, name, platform: 'desktop', version, role: syncAdvertise.role, collecting: syncAdvertise.collecting });
  discovery.setBeacon({
    id, name, platform: 'desktop', httpPort: syncServer.SYNC_HTTP_PORT,
    role: syncAdvertise.role, collecting: syncAdvertise.collecting, tokenFP: syncServer.tokenFingerprint()
  });
}

ipcMain.on('sync:set-enabled', (event, enabled) => {
  const want = !!enabled && !!backgroundConfig.password; // 无密码则无法派生令牌，不启用
  if (want && !syncEnabled) {
    syncEnabled = true;
    applySyncIdentity();
    syncServer.start();
    discovery.start();
  } else if (!want && syncEnabled) {
    syncEnabled = false;
    discovery.stop();
    syncServer.stop();
  }
});

// 前端每 tick 告知“对外宣告的角色/是否在采集”。
ipcMain.on('sync:advertise', (event, message) => {
  syncAdvertise = {
    role: String((message && message.role) || 'auto'),
    collecting: !!(message && message.collecting)
  };
  if (syncEnabled) applySyncIdentity();
});

// 前端推送最新序列化 store（{live,chart,battery}），服务端原样切片返回。
ipcMain.on('sync:publish', (event, payload) => {
  try { syncServer.publish(JSON.parse(payload)); } catch {}
});

ipcMain.on('sync:get-peers', (event) => {
  try { event.returnValue = JSON.stringify(discovery.getPeers()); } catch { event.returnValue = '[]'; }
});

ipcMain.on('sync:get-self', (event) => {
  try {
    event.returnValue = JSON.stringify({
      id: store.getDeviceId(), name: store.getDeviceName(), platform: 'desktop',
      version: app.getVersion(), httpPort: syncServer.SYNC_HTTP_PORT,
      tokenFP: syncServer.tokenFingerprint(), enabled: syncEnabled
    });
  } catch { event.returnValue = '{}'; }
});

ipcMain.on('sync:drain-inbound', (event) => {
  try { event.returnValue = JSON.stringify(syncServer.drainInbound()); } catch { event.returnValue = '[]'; }
});

// 异步：向对等端发同步请求（主进程注入令牌）；响应回递 __mu5120SyncResponse。
ipcMain.on('sync:fetch', async (event, message) => {
  const id = message && message.id;
  let options;
  try { options = JSON.parse(message && message.payload); } catch { options = {}; }
  const result = await syncServer.fetchPeer(options);
  deliverSync(id, JSON.stringify(result));
});

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    }
  ]);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu());
    createTray();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { app.isQuiting = true; discovery.stop(); syncServer.stop(); });
}
