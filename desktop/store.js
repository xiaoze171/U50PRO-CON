// 主进程本地持久化：窗口状态 + 后台电池历史。
// 存到 app.getPath('userData')，与渲染层的 localStorage 互不干扰。
// Phase A 只用到窗口状态；电池历史读接口先返回空数组（与纯 H5 一致），Phase D 补写。
const { app } = require('electron');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(userFile(name), 'utf8')); }
  catch { return fallback; }
}

function writeJson(name, value) {
  try { fs.writeFileSync(userFile(name), JSON.stringify(value)); }
  catch {}
}

function loadWindowState() {
  const state = readJson('window-state.json', {});
  if (!state || typeof state !== 'object') return {};
  // 历史遗留：旧版本默认 480×900（手机版式）会被持久化下来，覆盖新桌面默认值。
  // 若存到的尺寸低于桌面最小宽度，视作旧手机版式记录并丢弃，回落到新默认值。
  if (Number(state.width) < 1000) return {};
  return state;
}

function saveWindowState(bounds) {
  if (!bounds || typeof bounds !== 'object') return;
  writeJson('window-state.json', {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y
  });
}

// 返回 JSON 字符串（形态同安卓 getBackgroundBatteryHistory）。
function readBatteryHistory() {
  const value = readJson('battery-history.json', []);
  return JSON.stringify(Array.isArray(value) ? value : []);
}

// 本机稳定设备标识（局域网同步用），首次生成后持久化。
function getDeviceId() {
  const existing = readJson('device.json', null);
  if (existing && typeof existing.id === 'string' && existing.id) return existing.id;
  const id = 'exe-' + crypto.randomUUID();
  writeJson('device.json', { id, createdAt: Date.now() });
  return id;
}

// 默认设备名（用户可在设置里另存，这里给个可读缺省）。
function getDeviceName() {
  const saved = readJson('device.json', null);
  if (saved && typeof saved.name === 'string' && saved.name) return saved.name;
  try { return os.hostname() || 'Windows PC'; } catch { return 'Windows PC'; }
}

function setDeviceName(name) {
  const saved = readJson('device.json', {}) || {};
  writeJson('device.json', { ...saved, name: String(name || '').slice(0, 64) });
}

module.exports = { loadWindowState, saveWindowState, readBatteryHistory, getDeviceId, getDeviceName, setDeviceName };
