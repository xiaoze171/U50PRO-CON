// 局域网数据互通编排（前端共享大脑，Electron 与安卓走同一份逻辑）。
//
// 设计原则：**直连路由器永远是缺省与兜底**（= 今天的行为）。同步/查看端是纯增量能力，
// 仅当发现到“可达且令牌指纹匹配的采集器”时才激活。纯浏览器 H5 没有原生桥
// （不能建服务、不能收 UDP 发现），因此 isSupported()=false → 永远直连。
//
// 角色：
//   collector（采集器）：独占登录路由器、持续采集、把 {live,chart,battery} 交给原生服务端供他人只读；
//                        并吸收别人 POST 来的离线片段（回补自身空洞）。
//   viewer（查看端）：不登录路由器，从采集器读 /sync/live 与 /sync/history（回补自身空洞）；
//                     若自己曾在采集（采集器缺席期间），角色切回 viewer 时把本地片段 POST 给采集器。
//   direct（直连）：同步未启用 / 不支持 / 自己就是选举赢家但无对端 —— 行为等同今天。
//
// 令牌（X-Sync-Token=sha256(密码)）由原生层持有与注入，前端不接触密钥。
// 所有历史合并统一走 utils/history.js 的分钟桶并集（幂等、无冲突）。

import { routerApi } from './router-client.js';
import { mergeChartHistory, mergeBatterySamples, emptyChartHistory, MINUTE_MS } from '../utils/history.js';
import { electCollector } from '../utils/election.js';

const SYNC_HTTP_PORT = 51200;
const SETTINGS_KEY = 'mu5120-sync-settings-v1';
const HUB_HISTORY_INTERVAL_MS = 20000; // 查看端拉取采集器历史的最小间隔
const PEER_REFRESH_MS = 3000;          // 角色/对端刷新最小间隔

let bridgeCache = null;
let syncFetchSequence = 0;
const syncFetchPending = new Map();

let settings = loadSettings();
let mergeOptions = {
  chartWindowMs: 24 * 60 * 60 * 1000,
  chartSampleMs: MINUTE_MS,
  chartMaxPoints: Infinity,
  batteryWindowMs: 12 * 60 * 60 * 1000,
  batteryMaxPoints: Infinity
};

let self = null;                // 原生返回的本机身份 {id,name,platform,tokenFP,httpPort,enabled}
let peers = [];                 // 原生发现的对端列表
let role = 'direct';
let hub = null;                 // 当前采集器 peer（viewer 时非空）
let previousRole = 'direct';
let lastError = '';
let lastPeerRefresh = 0;
let lastHubHistoryPull = 0;
let hubHistoryCursor = 0;       // 已从采集器同步到的时间戳
let nativeEnabled = false;

function loadSettings() {
  let stored = {};
  try {
    const value = uni.getStorageSync(SETTINGS_KEY);
    if (value && typeof value === 'object' && !Array.isArray(value)) stored = value;
  } catch {}
  return {
    enabled: stored.enabled !== false,                 // 默认开启（不支持时自然退化为直连）
    preferredCollector: typeof stored.preferredCollector === 'string' ? stored.preferredCollector : ''
  };
}

function saveSettings() {
  try { uni.setStorageSync(SETTINGS_KEY, settings); } catch {}
}

// 原生同步桥（安卓 window.AndroidRouter / 桌面 window.DesktopRouter），需具备 syncGetSelf。
function syncBridge() {
  const candidate = typeof window !== 'undefined' ? (window.AndroidRouter || window.DesktopRouter) : null;
  if (candidate && typeof candidate.syncGetSelf === 'function' && typeof candidate.syncFetch === 'function') {
    return candidate;
  }
  return null;
}

function isSupported() {
  if (bridgeCache === null) bridgeCache = !!syncBridge();
  return bridgeCache;
}

// —— 原生异步 fetch（走 window.__mu5120SyncResponse 回调，镜像 router-client 的 __mu5120NativeResponse）——
function ensureSyncResponseHandler() {
  if (typeof window === 'undefined' || typeof window.__mu5120SyncResponse === 'function') return;
  window.__mu5120SyncResponse = (id, rawResponse) => {
    const pending = syncFetchPending.get(id);
    if (!pending) return;
    syncFetchPending.delete(id);
    clearTimeout(pending.timer);
    try {
      const response = JSON.parse(rawResponse);
      pending.resolve(response && typeof response === 'object' ? response : { ok: false, status: 0, error: '响应异常' });
    } catch (error) {
      pending.resolve({ ok: false, status: 0, error: error.message || '响应解析失败' });
    }
  };
}

function nativeSyncFetch(options) {
  const bridge = syncBridge();
  if (!bridge) return Promise.resolve({ ok: false, status: 0, error: '同步桥不可用' });
  ensureSyncResponseHandler();
  return new Promise(resolve => {
    const id = `sync-${Date.now()}-${++syncFetchSequence}`;
    const timer = setTimeout(() => {
      syncFetchPending.delete(id);
      resolve({ ok: false, status: 0, error: '同步请求超时' });
    }, 10000);
    syncFetchPending.set(id, { resolve, timer });
    try {
      bridge.syncFetch(id, JSON.stringify(options));
    } catch (error) {
      clearTimeout(timer);
      syncFetchPending.delete(id);
      resolve({ ok: false, status: 0, error: error.message || '同步请求失败' });
    }
  });
}

function readSelf() {
  const bridge = syncBridge();
  if (!bridge) return null;
  try {
    const value = JSON.parse(bridge.syncGetSelf() || '{}');
    return value && value.id ? value : null;
  } catch { return null; }
}

function readPeers() {
  const bridge = syncBridge();
  if (!bridge) return [];
  try {
    const value = JSON.parse(bridge.syncGetPeers() || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function pushEnabled(enabled) {
  const bridge = syncBridge();
  if (!bridge || typeof bridge.syncSetEnabled !== 'function') return;
  if (enabled === nativeEnabled) return;
  nativeEnabled = enabled;
  try { bridge.syncSetEnabled(enabled); } catch {}
}

function pushAdvertise(nextRole, collecting) {
  const bridge = syncBridge();
  if (!bridge || typeof bridge.syncSetAdvertise !== 'function') return;
  try { bridge.syncSetAdvertise(nextRole, collecting); } catch {}
}

function publishStore(store) {
  const bridge = syncBridge();
  if (!bridge || typeof bridge.syncPublish !== 'function') return;
  try {
    bridge.syncPublish(JSON.stringify({
      live: store.live || null,
      chart: store.chart || emptyChartHistory(),
      battery: Array.isArray(store.battery) ? store.battery : []
    }));
  } catch {}
}

function drainInbound() {
  const bridge = syncBridge();
  if (!bridge || typeof bridge.syncDrainInbound !== 'function') return [];
  try {
    const value = JSON.parse(bridge.syncDrainInbound() || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

// 确定性选举：委托共享的 utils/election.js（本机 + 可服务对端按 (平台优先级, id) 取最小）。
// 各设备用相同对端集合算出相同赢家，天然收敛、无脑裂。此处仅把赢家 id 映射回 hub 对象。
function resolveRole() {
  if (!settings.enabled || !isSupported() || !self) return { role: 'direct', hub: null };
  const { role: elected, collectorId } = electCollector({ self, peers, preferredCollector: settings.preferredCollector });
  if (elected === 'viewer') return { role: 'viewer', hub: peers.find(peer => peer.id === collectorId) || null };
  if (elected === 'collector') return { role: 'collector', hub: null };
  return { role: 'direct', hub: null };
}

function refreshRole(force = false) {
  const now = Date.now();
  if (!force && now - lastPeerRefresh < PEER_REFRESH_MS) return;
  lastPeerRefresh = now;
  if (!isSupported()) { role = 'direct'; hub = null; self = null; peers = []; return; }
  pushEnabled(settings.enabled);
  self = readSelf();
  peers = settings.enabled ? readPeers() : [];
  const resolved = resolveRole();
  role = resolved.role;
  hub = resolved.hub;
  // 广播本机对外角色（direct 视作独立采集器身份，但不与他人协作）
  pushAdvertise(role === 'viewer' ? 'viewer' : (role === 'collector' ? 'collector' : 'auto'), role === 'collector');
}

async function fetchHubLive() {
  if (!hub) return null;
  const response = await nativeSyncFetch({ host: hub.host, port: hub.port || SYNC_HTTP_PORT, path: '/sync/live', method: 'GET' });
  if (!response.ok) { lastError = `读取采集器实时数据失败：${response.error || response.status}`; return null; }
  try {
    const parsed = JSON.parse(response.body || '{}');
    return parsed && parsed.live ? parsed.live : null;
  } catch { return null; }
}

async function fetchHubHistory(onMergeChart) {
  if (!hub) return;
  const now = Date.now();
  if (now - lastHubHistoryPull < HUB_HISTORY_INTERVAL_MS) return;
  lastHubHistoryPull = now;
  const response = await nativeSyncFetch({
    host: hub.host, port: hub.port || SYNC_HTTP_PORT,
    path: `/sync/history?since=${hubHistoryCursor}`, method: 'GET'
  });
  if (!response.ok) return;
  let parsed;
  try { parsed = JSON.parse(response.body || '{}'); } catch { return; }
  applyExternalHistory(parsed, onMergeChart);
  if (Number.isFinite(Number(parsed.now))) hubHistoryCursor = Number(parsed.now);
}

// 把外部 {chart,battery} 合并进本地历史（图表经回调交 index.vue，电池写回 router-client）。
function applyExternalHistory(external, onMergeChart) {
  if (!external || typeof external !== 'object') return;
  const cutoff = Date.now() - mergeOptions.chartWindowMs;
  if (external.chart && typeof onMergeChart === 'function') {
    onMergeChart(current => mergeChartHistory(current, external.chart, {
      cutoff, sampleMs: mergeOptions.chartSampleMs, maxPoints: mergeOptions.chartMaxPoints
    }));
  }
  if (Array.isArray(external.battery) && external.battery.length) {
    routerApi.mergeExternalBattery(external.battery);
  }
}

// 采集器->查看端切换时，把本地片段一次性 POST 给新采集器（回补采集器空洞）。
async function backfillHub(localStore) {
  if (!hub || !localStore) return;
  const body = JSON.stringify({
    from: self && self.id ? self.id : '',
    chart: localStore.chart || emptyChartHistory(),
    battery: Array.isArray(localStore.battery) ? localStore.battery : []
  });
  await nativeSyncFetch({ host: hub.host, port: hub.port || SYNC_HTTP_PORT, path: '/sync/history', method: 'POST', body });
}

// —— 对外 API —— //

function init(options = {}) {
  bridgeCache = null;
  if (options && typeof options === 'object') mergeOptions = { ...mergeOptions, ...options };
  refreshRole(true);
}

function getSettings() {
  return { ...settings };
}

function setEnabled(enabled) {
  settings = { ...settings, enabled: !!enabled };
  saveSettings();
  pushEnabled(settings.enabled);
  refreshRole(true);
  return getSettings();
}

function setPreferredCollector(id) {
  settings = { ...settings, preferredCollector: String(id || '') };
  saveSettings();
  refreshRole(true);
  return getSettings();
}

function getState() {
  return {
    supported: isSupported(),
    enabled: settings.enabled,
    role,
    hub: hub ? { id: hub.id, name: hub.name, host: hub.host, platform: hub.platform } : null,
    self: self ? { id: self.id, name: self.name, platform: self.platform } : null,
    peers: peers.map(peer => ({ id: peer.id, name: peer.name, platform: peer.platform, collecting: !!peer.collecting })),
    preferredCollector: settings.preferredCollector,
    lastError
  };
}

// 透明代理的 dashboard：查看端从采集器读实时数据，其余（采集器/直连）走真正的路由器轮询。
// 返回结构与 routerApi.dashboard() 完全一致，index.vue 调用点无需感知角色。
async function dashboard() {
  refreshRole();
  if (role === 'viewer' && hub) {
    const live = await fetchHubLive();
    if (live) { lastError = ''; return live; }
    // 采集器本 tick 不可达 → 退回直连本 tick（保证不断更新；下一 tick 角色会重算）
  }
  const data = await routerApi.dashboard();
  lastError = '';
  return data;
}

// index.vue 每个 tick 更新完本地图表后调用：按角色发布/回补/拉取。
// live：本 tick 的 dashboard 结果；localStore：{ chart, battery }（当前本地历史）；
// onMergeChart(updater)：用 updater(currentChart)->mergedChart 更新并持久化 index.vue 的图表历史。
async function afterTick({ live, localStore, onMergeChart } = {}) {
  refreshRole();
  const store = localStore || { chart: emptyChartHistory(), battery: [] };

  // 角色切换：采集器 -> 查看端，把本地片段回补给新采集器
  if (previousRole === 'collector' && role === 'viewer' && hub) {
    await backfillHub(store);
    hubHistoryCursor = 0; // 换了采集器，重新全量对齐一次
  }
  if (role !== 'viewer') { previousRole = role; }

  if (role === 'collector') {
    publishStore({ live, chart: store.chart, battery: store.battery });
    // 吸收别人 POST 来的离线片段
    const inbound = drainInbound();
    inbound.forEach(item => applyExternalHistory(item, onMergeChart));
    previousRole = 'collector';
  } else if (role === 'viewer' && hub) {
    await fetchHubHistory(onMergeChart);
    previousRole = 'viewer';
  } else {
    previousRole = role;
  }
}

export const syncClient = {
  init,
  isSupported,
  getSettings,
  setEnabled,
  setPreferredCollector,
  getState,
  dashboard,
  afterTick
};
