// 局域网同步 HTTP 服务（桌面端）。定位：哑管道 + 缓存 —— 只负责鉴权、按分钟桶
// 切片返回前端 publish 进来的 store、把别人 POST 来的片段排队等前端来取合并。
// 所有“合并/角色/归一”逻辑都在共享 JS（src/utils/history.js、services/sync.js），
// 与安卓 SyncServer.java 行为一一对应。
const http = require('http');
const crypto = require('crypto');

const SYNC_HTTP_PORT = 51200;
const APP_TAG = 'u50pro-sync';
const PROTOCOL_VERSION = 1;
const MAX_BODY = 4 * 1024 * 1024; // 单次 POST 上限 4MB
const MAX_INBOUND = 64;           // 待前端消费的入站队列上限

let server = null;
let token = '';                   // sha256(路由器密码) 十六进制大写；空表示未启用
let self = { id: '', name: '', platform: 'desktop', role: 'auto', collecting: false, version: '' };
let publishedStore = { live: null, chart: emptyChart(), battery: [] };
const inboundQueue = [];

function emptyChart() {
  return { rsrp: [], sinr: [], rsrq: [], down: [], up: [], temperatures: {} };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value), 'utf8').digest('hex').toUpperCase();
}

function setToken(password) {
  token = password ? sha256Hex(password) : '';
}

function tokenFingerprint() {
  return token ? token.slice(0, 8) : '';
}

function setSelf(next) {
  if (next && typeof next === 'object') self = { ...self, ...next };
}

function publish(store) {
  if (!store || typeof store !== 'object') return;
  publishedStore = {
    live: store.live !== undefined ? store.live : publishedStore.live,
    chart: store.chart && typeof store.chart === 'object' ? store.chart : publishedStore.chart,
    battery: Array.isArray(store.battery) ? store.battery : publishedStore.battery
  };
}

// 取走并清空入站队列（前端来合并后再 publish 回来）。
function drainInbound() {
  return inboundQueue.splice(0, inboundQueue.length);
}

function authorized(req) {
  if (!token) return false;
  const provided = req.headers['x-sync-token'];
  return typeof provided === 'string' && provided.toUpperCase() === token;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// 按 since 只返回新于该时间戳的分钟桶（增量），减少体积。
function sliceSince(store, since) {
  if (!Number.isFinite(since) || since <= 0) return { chart: store.chart, battery: store.battery };
  const chart = emptyChart();
  ['rsrp', 'sinr', 'rsrq', 'down', 'up'].forEach(key => {
    chart[key] = (store.chart[key] || []).filter(point => Number(point?.[0]) > since);
  });
  Object.entries(store.chart.temperatures || {}).forEach(([key, values]) => {
    const filtered = (values || []).filter(point => Number(point?.[0]) > since);
    if (filtered.length) chart.temperatures[key] = filtered;
  });
  const battery = (store.battery || []).filter(sample => Number(sample?.timestamp) > since);
  return { chart, battery };
}

function handle(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return sendJson(res, 400, { error: 'bad url' }); }
  if (!url.pathname.startsWith('/sync/')) return sendJson(res, 404, { error: 'not found' });
  if (!authorized(req)) return sendJson(res, 403, { error: 'invalid token' });

  if (req.method === 'GET' && url.pathname === '/sync/hello') {
    return sendJson(res, 200, {
      app: APP_TAG, v: PROTOCOL_VERSION,
      id: self.id, name: self.name, platform: self.platform,
      role: self.role, collecting: self.collecting, version: self.version,
      tokenFP: tokenFingerprint(), time: Date.now()
    });
  }
  if (req.method === 'GET' && url.pathname === '/sync/live') {
    return sendJson(res, 200, { live: publishedStore.live, time: Date.now() });
  }
  if (req.method === 'GET' && url.pathname === '/sync/history') {
    const since = Number(url.searchParams.get('since'));
    return sendJson(res, 200, { ...sliceSince(publishedStore, since), since: Number.isFinite(since) ? since : 0, now: Date.now() });
  }
  if (req.method === 'POST' && url.pathname === '/sync/history') {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { aborted = true; req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        inboundQueue.push({
          chart: parsed.chart && typeof parsed.chart === 'object' ? parsed.chart : emptyChart(),
          battery: Array.isArray(parsed.battery) ? parsed.battery : [],
          from: String(parsed.from || ''),
          at: Date.now()
        });
        while (inboundQueue.length > MAX_INBOUND) inboundQueue.shift();
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { error: 'bad json' });
      }
    });
    req.on('error', () => { try { sendJson(res, 400, { error: 'read error' }); } catch {} });
    return;
  }
  return sendJson(res, 404, { error: 'not found' });
}

function start() {
  if (server) return;
  server = http.createServer(handle);
  server.on('error', () => { server = null; }); // 端口占用等：静默失败，前端会退回直连
  server.listen(SYNC_HTTP_PORT, '0.0.0.0');
}

function stop() {
  if (server) { try { server.close(); } catch {} server = null; }
}

function isLan(host) {
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return host.endsWith('.local');
}

// 向对等端发同步请求，自动注入 X-Sync-Token；永不抛出。
function fetchPeer(options) {
  const { host, port, path, method = 'GET', body = '' } = options || {};
  return new Promise(resolve => {
    if (!token) return resolve({ ok: false, status: 0, error: '同步未启用' });
    if (!isLan(host)) return resolve({ ok: false, status: 0, error: '仅允许局域网地址' });
    const headers = { 'X-Sync-Token': token, Accept: 'application/json' };
    const payload = body && method !== 'GET' ? Buffer.from(String(body), 'utf8') : null;
    if (payload) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = payload.length;
    }
    const request = http.request({ host, port: port || SYNC_HTTP_PORT, path, method, headers, timeout: 8000 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const status = response.statusCode || 0;
        const ok = status >= 200 && status < 300;
        resolve({ ok, status, body: Buffer.concat(chunks).toString('utf8'), error: ok ? undefined : `HTTP ${status}` });
      });
    });
    request.on('timeout', () => request.destroy(new Error('同步请求超时')));
    request.on('error', error => resolve({ ok: false, status: 0, error: error.message || '连接失败' }));
    if (payload) request.write(payload);
    request.end();
  });
}

module.exports = {
  SYNC_HTTP_PORT, APP_TAG, PROTOCOL_VERSION,
  sha256Hex, setToken, tokenFingerprint, setSelf,
  publish, drainInbound, start, stop, fetchPeer, emptyChart
};
