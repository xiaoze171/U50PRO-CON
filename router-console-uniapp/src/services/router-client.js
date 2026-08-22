import CryptoJS from 'crypto-js';

const DEFAULT_CONFIG = {
  routerUrl: 'http://192.168.0.1',
  password: '111111',
  developerPassword: '111111',
  pollIntervalMs: 1000
};

const BATTERY_HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000;
const BATTERY_HISTORY_MAX_POINTS = 725;
const NATIVE_BATTERY_MERGE_MS = 30000;

const signalFields = [
  'network_type', 'network_provider', 'Operator', 'rmcc', 'rmnc', 'mdm_mcc', 'mdm_mnc', 'rssi', 'lte_rssi', 'rscp', 'lte_rsrp', 'lte_rsrq', 'lte_snr', 'ecio',
  'Z5g_snr', 'Z5g_SINR', 'Z5g_rsrp', 'Z5g_rsrq', 'Z5g_rssi', 'signalbar', 'wan_lte_ca', 'nr_ca_dl_state', 'nr_ca_ul_state',
  'lte_pci', 'cell_id', 'wan_active_band', 'wan_active_channel', 'bandwidth', 'lte_ca_pcell_arfcn', 'lte_ca_pcell_band', 'lte_ca_pcell_bandwidth',
  'lte_ca_scell_arfcn', 'lte_ca_scell_band', 'lte_ca_scell_bandwidth', 'lte_ca_scell_info', 'lte_multi_ca_scell_info', 'lte_multi_ca_scell_sig_info',
  'nr5g_pci', 'nr5g_action_band', 'nr5g_action_channel', 'nr5g_cell_id', 'Z5g_CELL_ID', 'Z5g_dlEarfcn', 'nr5g_nsa_bandwidth', 'nr_multi_ca_scell_info'
];

const statusFields = [
  'loginfo', 'modem_main_state', 'simcard_roam', 'sim_iccid', 'imei', 'imsi', 'sim_imsi', 'msisdn', 'opms_wan_mode', 'opms_wan_auto_mode',
  'ppp_status', 'wan_connect_status', 'wan_ipaddr', 'ipv6_wan_ipaddr', 'lan_ipaddr', 'wifi_mac_address', 'wa_inner_version', 'wa_version', 'hardware_version', 'web_version',
  'realtime_tx_bytes', 'realtime_rx_bytes', 'realtime_tx_thrpt', 'realtime_rx_thrpt', 'realtime_time', 'monthly_rx_bytes', 'monthly_tx_bytes', 'monthly_time', 'date_month',
  'wifi_onoff_state', 'wifi_lbd_enable', 'wifi_chip1_ssid1_ssid', 'wifi_chip2_ssid1_ssid', 'wifi_chip1_ssid1_access_sta_num', 'wifi_chip2_ssid1_access_sta_num', 'wifi_access_sta_num',
  'battery_temp', 'battery_value', 'battery_vol_percent', 'battery_charging', 'battery_charg_type', 'external_charging_flag', 'battery_pers', 'battery_customer_mode',
  'battery_time', 'battery_remain_time', 'battery_remaining_time', 'battery_capacity', 'battery_health', 'battery_voltage', 'battery_current', 'sms_unread_num'
];

// 流量页面使用的原厂字段。接口层保留路由器的原始格式，页面再转换为 GB。
const featureFields = [
  'data_volume_limit_switch', 'data_volume_limit_unit', 'data_volume_limit_size',
  'data_volume_alert_percent', 'wan_auto_clear_flow_data_switch', 'traffic_clear_date'
];

const temperatureFields = [
  'battery_temp', 'wifi_chip_temp', 'wifi_temp_level_1', 'wifi_temp_level_2', 'pm_sensor_pa1', 'pm_sensor_mdm', 'pm_modem_5g',
  'therm_pa_level', 'therm_pa_frl_level', 'therm_tj_level', 'OOM_TEMP_PRO', 'cpu_temp', 'cpu_temperature', 'soc_temp', 'board_temp', 'modem_temp'
];

const resourceFields = [
  'cpu_usage', 'cpu_load', 'cpu_percent', 'mem_usage', 'memory_usage', 'memory_percent', 'mem_total', 'mem_free', 'MemTotal', 'MemFree', 'ram_total', 'ram_free', 'loadavg'
];

const lockFields = ['nr5g_cell_lock', 'lte_band_lock', 'lte_freq_lock', 'lte_pci_lock', 'lte_earfcn_lock', 'nr5g_band_lock', 'nr5g_sa_band_lock', 'nr5g_nsa_band_lock', 'operate_mode'];
const lteBandMasks = { 1: '0x000000001', 3: '0x000000004', 5: '0x000000010', 7: '0x000000040', 8: '0x000000080', 20: '0x000080000', 28: '0x008000000', 34: '0x200000000', 38: '0x2000000000', 39: '0x4000000000', 40: '0x8000000000', 41: '0x10000000000' };
const nrBandSet = new Set([1, 3, 5, 8, 28, 41, 77, 78]);

let config = loadConfig();
let cookies = new Map();
let accessIdSeed = '';
let loginState = { loggedIn: false, lastAttempt: 0, message: '尚未连接', method: 'sha256' };
let batteryHistory = loadBatteryHistory();
let lastNativeBatteryMerge = 0;
let isH5 = false;
let nativeRequestSequence = 0;
const nativeRequests = new Map();

// #ifdef H5
isH5 = true;
// #endif

function nativeBridge() {
  return typeof window !== 'undefined' && window.AndroidRouter && typeof window.AndroidRouter.request === 'function'
    ? window.AndroidRouter
    : null;
}

function nativeBridgeRequest(bridge, path, options, headers) {
  if (typeof window.__mu5120NativeResponse !== 'function') {
    window.__mu5120NativeResponse = (id, rawResponse) => {
      const pending = nativeRequests.get(id);
      if (!pending) return;
      nativeRequests.delete(id);
      clearTimeout(pending.timer);
      try {
        const response = JSON.parse(rawResponse);
        if (!response.ok) throw new Error(response.error || `路由器返回 HTTP ${response.status || '未知'}`);
        const body = response.body || '';
        try { pending.resolve(JSON.parse(body)); } catch { pending.resolve(body); }
      } catch (error) {
        pending.reject(error);
      }
    };
  }

  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${++nativeRequestSequence}`;
    const timer = setTimeout(() => {
      nativeRequests.delete(id);
      reject(new Error('路由器请求超时'));
    }, 13000);
    nativeRequests.set(id, { resolve, reject, timer });
    try {
      bridge.request(id, JSON.stringify({
        url: `${config.routerUrl.replace(/\/$/, '')}${path}`,
        method: options.method || 'GET',
        headers,
        body: options.data == null ? '' : String(options.data),
        timeoutMs: 12000
      }));
    } catch (error) {
      clearTimeout(timer);
      nativeRequests.delete(id);
      reject(error);
    }
  });
}

function loadConfig() {
  const stored = uni.getStorageSync('mu5120-config');
  return {
    ...DEFAULT_CONFIG,
    routerUrl: stored?.routerUrl || DEFAULT_CONFIG.routerUrl,
    password: stored?.password || DEFAULT_CONFIG.password,
    developerPassword: stored?.password || stored?.developerPassword || DEFAULT_CONFIG.password,
    pollIntervalMs: 1000
  };
}

function saveConfig() {
  uni.setStorageSync('mu5120-config', config);
}

function loadBatteryHistory() {
  const stored = uni.getStorageSync('mu5120-battery-history');
  const cutoff = Date.now() - BATTERY_HISTORY_WINDOW_MS;
  return mergeBatterySamples(Array.isArray(stored) ? stored : [], readNativeBatteryHistory(), cutoff);
}

function readNativeBatteryHistory() {
  try {
    const bridge = nativeBridge();
    if (!bridge || typeof bridge.getBackgroundBatteryHistory !== 'function') return [];
    const value = JSON.parse(bridge.getBackgroundBatteryHistory() || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function mergeBatterySamples(local, native, cutoff = Date.now() - BATTERY_HISTORY_WINDOW_MS) {
  const buckets = new Map();
  [...local, ...native].forEach(item => {
    const timestamp = Number(item?.timestamp);
    const percent = numeric(item?.percent);
    if (!Number.isFinite(timestamp) || timestamp < cutoff || percent == null) return;
    const charging = Boolean(item?.charging);
    const key = `${Math.floor(timestamp / 60000)}:${charging ? 1 : 0}`;
    const previous = buckets.get(key) || {};
    buckets.set(key, { ...previous, ...item, timestamp, percent, charging });
  });
  return [...buckets.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-BATTERY_HISTORY_MAX_POINTS);
}

function mergeNativeBatteryHistory(force = false) {
  const now = Date.now();
  if (!force && now - lastNativeBatteryMerge < NATIVE_BATTERY_MERGE_MS) return;
  lastNativeBatteryMerge = now;
  const merged = mergeBatterySamples(batteryHistory, readNativeBatteryHistory());
  if (merged.length) batteryHistory = merged;
}

function syncBackgroundConfig() {
  const bridge = nativeBridge();
  if (bridge && typeof bridge.configureBackground === 'function') {
    bridge.configureBackground(config.routerUrl, config.password);
  }
}

function updateBackgroundSnapshot(status, temperature) {
  const bridge = nativeBridge();
  if (!bridge || typeof bridge.updateBackgroundSnapshot !== 'function') return;
  try {
    bridge.updateBackgroundSnapshot(JSON.stringify({ status, temperature }));
  } catch {}
}

function getOverlayState() {
  const bridge = nativeBridge();
  if (!bridge || typeof bridge.getOverlayEnabled !== 'function') {
    return { available: false, enabled: false, permitted: false };
  }
  try {
    return {
      available: true,
      enabled: Boolean(bridge.getOverlayEnabled()),
      permitted: typeof bridge.canDrawOverlays === 'function' && Boolean(bridge.canDrawOverlays())
    };
  } catch {
    return { available: true, enabled: false, permitted: false };
  }
}

function setOverlayEnabled(enabled) {
  const bridge = nativeBridge();
  if (bridge && typeof bridge.setOverlayEnabled === 'function') bridge.setOverlayEnabled(Boolean(enabled));
  return getOverlayState();
}

function requestOverlayPermission() {
  const bridge = nativeBridge();
  if (bridge && typeof bridge.requestOverlayPermission === 'function') bridge.requestOverlayPermission();
}

function sha256(value) {
  return CryptoJS.SHA256(String(value)).toString(CryptoJS.enc.Hex).toUpperCase();
}

function baseUrl() {
  if (isH5) return '/router-api';
  return config.routerUrl.replace(/\/$/, '');
}

function queryString(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value == null ? '' : String(value))}`)
    .join('&');
}

function rememberCookies(response) {
  if (isH5) return;
  const values = [];
  if (Array.isArray(response.cookies)) values.push(...response.cookies);
  const headerValue = response.header?.['Set-Cookie'] || response.header?.['set-cookie'];
  if (Array.isArray(headerValue)) values.push(...headerValue);
  else if (headerValue) values.push(headerValue);
  values.forEach(item => {
    const first = String(item).split(';', 1)[0];
    const index = first.indexOf('=');
    if (index > 0) cookies.set(first.slice(0, index), first.slice(index + 1));
  });
}

function cookieHeader() {
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function requestRouter(path, options = {}) {
  const headers = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.header || {})
  };
  if (!isH5) {
    headers.Origin = config.routerUrl;
    headers.Referer = `${config.routerUrl.replace(/\/$/, '')}/index.html`;
    if (cookieHeader()) headers.Cookie = cookieHeader();
  }

  const bridge = nativeBridge();
  if (bridge) return nativeBridgeRequest(bridge, path, options, headers);
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${baseUrl()}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: headers,
      timeout: 12000,
      withCredentials: true,
      success(response) {
        rememberCookies(response);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`路由器返回 HTTP ${response.statusCode}`));
          return;
        }
        resolve(response.data);
      },
      fail(error) {
        reject(new Error(error.errMsg || '无法连接路由器'));
      }
    });
  });
}

async function getFields(fields, extra = {}) {
  const query = queryString({ isTest: 'false', multi_data: '1', cmd: fields.join(','), _: Date.now(), ...extra });
  return requestRouter(`/goform/goform_get_cmd_process?${query}`);
}

async function getCommand(cmd, params = {}) {
  const query = queryString({ isTest: 'false', cmd, ...params, _: Date.now() });
  return requestRouter(`/goform/goform_get_cmd_process?${query}`);
}

async function accessibleId() {
  if (!accessIdSeed) {
    const version = await getFields(['wa_inner_version', 'cr_version']);
    accessIdSeed = `${version.wa_inner_version || ''}${version.cr_version || ''}`;
  }
  const token = await getFields(['RD']);
  if (!token.RD) throw new Error('固件未返回写接口动态令牌 RD');
  return sha256(sha256(accessIdSeed) + token.RD);
}

async function setGoform(goformId, data = {}) {
  const values = { isTest: 'false', goformId, ...data };
  if (goformId !== 'LOGIN' && goformId !== 'SET_WEB_LANGUAGE') values.AD = await accessibleId();
  const response = await requestRouter('/goform/goform_set_cmd_process', {
    method: 'POST',
    header: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    data: queryString(values)
  });
  return typeof response === 'string' ? safeJson(response) : response;
}

function safeJson(value) {
  try { return JSON.parse(value); } catch { return { raw: value }; }
}

async function login(force = false) {
  const now = Date.now();
  if (!force && loginState.loggedIn && now - loginState.lastAttempt < 30000) return loginState;
  loginState.lastAttempt = now;
  if (!config.password) return (loginState = { loggedIn: false, lastAttempt: now, message: '未保存路由器密码', method: 'none' });
  try {
    // H5 的路由器 Cookie 由浏览器保存，改密码后先注销旧会话，避免旧 Cookie 让错误密码看起来也能登录。
    if (force && isH5) await setGoform('LOGOUT').catch(() => {});
    await requestRouter('/index.html');
    const version = await getFields(['Language', 'cr_version', 'wa_inner_version']);
    accessIdSeed = `${version.wa_inner_version || ''}${version.cr_version || ''}`;
    const token = await getFields(['LD']);
    const password = sha256(sha256(config.password) + (token.LD || ''));
    const result = await setGoform('LOGIN', { password });
    const log = await getFields(['loginfo']);
    const loggedIn = ['0', '4', 0, 4].includes(result?.result) || log.loginfo === 'ok';
    loginState = {
      loggedIn,
      lastAttempt: now,
      method: 'sha256',
      message: loggedIn ? '已自动登录' : `登录失败：${result?.result ?? '未知响应'}`,
      firmware: version.wa_inner_version || version.cr_version || ''
    };
  } catch (error) {
    loginState = { loggedIn: false, lastAttempt: now, message: error.message, method: 'sha256' };
  }
  return loginState;
}

async function ensureLogin() {
  let status = await getFields(['loginfo']).catch(() => ({ loginfo: '' }));
  if (status.loginfo !== 'ok') await login(true);
  status = await getFields(['loginfo']).catch(() => ({ loginfo: '' }));
  loginState.loggedIn = status.loginfo === 'ok';
  if (!loginState.loggedIn) throw new Error(loginState.message || '路由器登录失败');
}

async function developerLogin() {
  if (!config.password) throw new Error('未保存登录密码');
  const current = await getFields(['developer_option_loginfo']).catch(() => ({}));
  if (current.developer_option_loginfo === 'ok') return { ok: true, message: '开发者会话已就绪' };
  const main = await login(true);
  if (!main.loggedIn) throw new Error(`主登录刷新失败：${main.message}`);
  const token = await getFields(['LD']);
  const password = sha256(sha256(config.password) + (token.LD || ''));
  const result = await setGoform('DEVELOPER_OPTION_LOGIN', { password });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const state = await getFields(['developer_option_loginfo']).catch(() => ({}));
    if (state.developer_option_loginfo === 'ok') return { ok: true, message: '开发者会话已建立', result };
    await delay(150);
  }
  throw new Error(`开发者认证失败：${result?.result ?? '未知响应'}`);
}

async function ensureDeveloperAccess() {
  const state = await getFields(['developer_option_loginfo']).catch(() => ({}));
  if (state.developer_option_loginfo !== 'ok') await developerLogin();
}

async function dashboard() {
  await ensureLogin();
  const [status, signal, temperature, resources, locks, stations, cable, neighbors, features] = await Promise.all([
    getFields(statusFields),
    getFields(signalFields),
    getFields(temperatureFields),
    getFields(resourceFields),
    getFields(lockFields),
    getCommand('station_list').catch(() => ({ station_list: [] })),
    getCommand('lan_station_list').catch(() => ({ lan_station_list: [] })),
    getFields(['network_type', 'lte_ngbr_cell_info_ext', 'sa_ngbr_cell_manual_result_ext']).catch(() => ({})),
    getFields(featureFields).catch(() => ({}))
  ]);
  mergeNativeBatteryHistory();
  const sample = recordBattery(status, temperature);
  const battery = batterySummary(status);
  if (sample) {
    Object.assign(sample, {
      ratePerHour: battery.ratePerHour,
      remainingMinutes: battery.remainingHours == null ? null : Math.round(battery.remainingHours * 60)
    });
    saveBatteryHistory();
  }
  updateBackgroundSnapshot(status, temperature);
  return {
    timestamp: Date.now(),
    login: { ...loginState },
    status,
    signal,
    temperature,
    resources,
    locks,
    stations: normalizeList(stations.station_list),
    cableStations: normalizeList(cable.lan_station_list || cable.station_list),
    neighbors,
    features,
    battery
  };
}

function trafficSizeValue(gigabytes) {
  const value = Number(gigabytes);
  if (!Number.isFinite(value) || value < 0) throw new Error('套餐流量必须是大于等于 0 的数字');
  // 原厂 data 格式为“数量_1024”，表示数量 GB。
  return `${Math.round(value * 100) / 100}_1024`;
}

async function setTrafficPlan(values = {}) {
  await ensureLogin();
  const size = trafficSizeValue(values.sizeGb);
  const alert = Number(values.alertPercent);
  if (!Number.isFinite(alert) || alert < 0 || alert > 100) throw new Error('提醒百分比必须在 0-100 之间');
  const clearDate = String(values.clearDate ?? '').trim();
  if (clearDate && (!/^\d{1,2}$/.test(clearDate) || Number(clearDate) < 1 || Number(clearDate) > 31)) {
    throw new Error('清零日期必须是 1-31');
  }
  const result = await setGoform('DATA_LIMIT_SETTING', {
    data_volume_limit_switch: values.enabled ? '1' : '0',
    data_volume_limit_unit: 'data',
    data_volume_limit_size: size,
    data_volume_alert_percent: String(Math.round(alert)),
    wan_auto_clear_flow_data_switch: values.autoClear ? 'on' : 'off',
    traffic_clear_date: clearDate || '1'
  });
  assertSuccess(result, '流量设置');
  return result;
}

async function calibrateTraffic(values = {}) {
  await ensureLogin();
  const gigabytes = Number(values.gigabytes);
  if (!Number.isFinite(gigabytes) || gigabytes < 0) throw new Error('已用流量必须是大于等于 0 的数字');
  const bytes = Math.round(gigabytes * 1024 ** 3);
  const result = await setGoform('FLOW_CALIBRATION_MANUAL', {
    calibration_way: 'data',
    data: String(bytes),
    time: '0'
  });
  assertSuccess(result, '已用流量校准');
  return result;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).filter(item => item && typeof item === 'object');
}

function recordBattery(status, temperature) {
  const percent = numeric(status.battery_vol_percent || status.battery_value);
  if (percent == null) return null;
  const timestamp = Date.now();
  const charging = status.battery_charging === '1' || status.external_charging_flag === '1';
  const last = batteryHistory.at(-1);
  if (last && timestamp - last.timestamp < 60000 && last.charging === charging) return null;
  const sample = {
    timestamp,
    percent,
    charging,
    temperature: numeric(temperature.battery_temp),
    chargeType: status.battery_charg_type || '',
    externalPower: status.external_charging_flag === '1',
    voltage: status.battery_voltage || '',
    current: status.battery_current || '',
    capacity: status.battery_capacity || '',
    health: status.battery_health || ''
  };
  batteryHistory.push(sample);
  const cutoff = timestamp - BATTERY_HISTORY_WINDOW_MS;
  batteryHistory = batteryHistory.filter(item => item.timestamp >= cutoff).slice(-BATTERY_HISTORY_MAX_POINTS);
  return sample;
}

function batterySummary(status) {
  const percent = numeric(status.battery_vol_percent || status.battery_value);
  const charging = status.battery_charging === '1' || status.external_charging_flag === '1';
  const recent = [];
  const cutoff = Date.now() - BATTERY_HISTORY_WINDOW_MS;
  for (let index = batteryHistory.length - 1; index >= 0; index -= 1) {
    const item = batteryHistory[index];
    if (item.timestamp < cutoff || item.charging !== charging) break;
    recent.unshift(item);
  }
  let ratePerHour = null;
  if (recent.length >= 2) {
    const first = recent[0];
    const last = recent.at(-1);
    const hours = (last.timestamp - first.timestamp) / 3600000;
    const delta = charging ? last.percent - first.percent : first.percent - last.percent;
    if (hours >= 0.15 && delta > 0) ratePerHour = delta / hours;
  }
  const remainingHours = ratePerHour && percent != null
    ? (charging ? Math.max(0, (100 - percent) / ratePerHour) : Math.max(0, percent / ratePerHour))
    : null;
  return { percent, charging, ratePerHour, remainingHours, samples: batteryHistory };
}

function saveBatteryHistory() {
  uni.setStorageSync('mu5120-battery-history', batteryHistory);
}

async function listSms() {
  await ensureLogin();
  const ready = await getCommand('sms_cmd_status_info', { sms_cmd: 1 });
  if (ready.sms_cmd_status_result !== '3') return { ready, messages: [], capacity: {} };
  const [list, capacity] = await Promise.all([
    getCommand('sms_data_total', { page: 0, data_per_page: 500, mem_store: 1, tags: 10, order_by: 'order by id desc' }),
    getCommand('sms_capacity_info')
  ]);
  return {
    ready,
    capacity,
    messages: normalizeList(list.messages).map(item => ({ ...item, content: decodeSmsHex(item.content), rawContent: item.content }))
  };
}

async function sendSms(number, message) {
  await ensureLogin();
  const target = String(number || '').trim();
  if (!/^\+?\d{3,20}$/.test(target)) throw new Error('手机号格式不正确');
  if (!message || message.length > 670) throw new Error('短信内容长度必须为 1 到 670 个字符');
  const result = await setGoform('SEND_SMS', { Number: target, sms_time: smsTime(), MessageBody: encodeSmsHex(message), ID: -1, encode_type: 'UNICODE' });
  if (result.result !== 'success') return result;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(500);
    const state = await getCommand('sms_cmd_status_info', { sms_cmd: 4 });
    if (state.sms_cmd_status_result === '3') return { result: 'success', state };
    if (state.sms_cmd_status_result === '2') return { result: 'failure', state };
  }
  return { result: 'pending' };
}

async function scanNeighbors() {
  await ensureLogin();
  return setGoform('SCAN_NR5G_NEIGHBOR_CELL');
}

async function linkedCellLock(candidate) {
  await ensureDeveloperAccess();
  if (candidate.rat === 'NR') {
    const pci = integer(candidate.pci, 0, 1007, '5G PCI');
    const arfcn = integer(candidate.arfcn, 0, 800000, '5G NR-ARFCN');
    const band = integer(String(candidate.band || '').replace(/^n/i, ''), 1, 261, '5G Band');
    const scs = integer(candidate.scs, 15, 120, 'SCS');
    const result = await setGoform('NR5G_LOCK_CELL_SET', { nr5g_cell_lock: `${pci},${arfcn},${band},${scs}` });
    assertSuccess(result, '5G 锁小区');
    return result;
  }
  const pci = integer(candidate.pci, 0, 503, 'LTE PCI');
  const arfcn = integer(candidate.arfcn, 0, 68935, 'LTE EARFCN');
  const result = await setGoform('LTE_LOCK_CELL_SET', { lte_pci_lock: pci, lte_earfcn_lock: arfcn });
  assertSuccess(result, 'LTE 锁小区');
  return result;
}

async function setNrCellLock(values) {
  await ensureDeveloperAccess();
  const payload = values.unlock
    ? '1,1,1,1'
    : `${integer(values.pci, 0, 1007, '5G PCI')},${integer(values.arfcn, 0, 800000, '5G NR-ARFCN')},${integer(String(values.band || '').replace(/^n/i, ''), 1, 261, '5G Band')},${integer(values.scs, 15, 120, 'SCS')}`;
  const result = await setGoform('NR5G_LOCK_CELL_SET', { nr5g_cell_lock: payload });
  assertSuccess(result, values.unlock ? '5G 解除锁定' : '5G 锁小区');
  return result;
}

async function setLteCellLock(values) {
  await ensureDeveloperAccess();
  const result = await setGoform('LTE_LOCK_CELL_SET', {
    lte_pci_lock: values.unlock ? '' : integer(values.pci, 0, 503, 'LTE PCI'),
    lte_earfcn_lock: values.unlock ? '' : integer(values.arfcn, 0, 68935, 'LTE EARFCN')
  });
  assertSuccess(result, values.unlock ? 'LTE 解除锁定' : 'LTE 锁小区');
  return result;
}

async function setLteBands(bands) {
  await ensureDeveloperAccess();
  const values = parseBands(bands, new Set(Object.keys(lteBandMasks).map(Number)));
  let mask = 0n;
  values.forEach(band => { mask |= BigInt(lteBandMasks[band]); });
  const result = await setGoform('BAND_SELECT', { is_gw_band: 0, gw_band_mask: 0, is_lte_band: 1, lte_band_mask: `0x${mask.toString(16).padStart(16, '0')}` });
  assertSuccess(result, 'LTE 锁频段');
  return result;
}

async function setNrBands(type, bands) {
  await ensureDeveloperAccess();
  const values = parseBands(bands, nrBandSet);
  const result = await setGoform('WAN_PERFORM_NR5G_SANSA_BAND_LOCK', { nr5g_band_mask: values.join(','), type: type === 'nsa' ? '1' : '0' });
  assertSuccess(result, `5G ${type.toUpperCase()} 锁频段`);
  return result;
}

function parseBands(input, allowed) {
  const values = [...new Set((Array.isArray(input) ? input : String(input || '').split(',')).map(Number).filter(Number.isFinite))];
  if (!values.length || values.some(value => !allowed.has(value))) throw new Error('频段列表包含不支持的值');
  return values;
}

function assertSuccess(result, label) {
  if (result?.result !== 'success') throw new Error(`固件拒绝${label}：${result?.result || JSON.stringify(result)}`);
}

function integer(value, min, max, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} 必须在 ${min}-${max} 之间`);
  return parsed;
}

function numeric(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeSmsHex(value) {
  if (!value || !/^[0-9a-f]+$/i.test(value)) return value || '';
  let output = '';
  for (let index = 0; index < value.length; index += 4) {
    const code = Number.parseInt(value.slice(index, index + 4), 16);
    if (code && code !== 9) output += String.fromCharCode(code);
  }
  return output;
}

function encodeSmsHex(value) {
  let output = '';
  for (let index = 0; index < value.length; index += 1) output += value.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0');
  return output;
}

function smsTime() {
  const date = new Date();
  const two = value => String(value).padStart(2, '0');
  const zone = -date.getTimezoneOffset() / 60;
  return `${String(date.getFullYear()).slice(-2)};${two(date.getMonth() + 1)};${two(date.getDate())};${two(date.getHours())};${two(date.getMinutes())};${two(date.getSeconds())};${zone >= 0 ? '+' : ''}${zone}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getConfig() {
  syncBackgroundConfig();
  return { ...config };
}

function updateConfig(next) {
  const password = String(next.password ?? config.password);
  config = {
    ...config,
    ...next,
    password,
    developerPassword: password,
    routerUrl: String(next.routerUrl ?? config.routerUrl).trim().replace(/\/$/, ''),
    pollIntervalMs: 1000
  };
  saveConfig();
  syncBackgroundConfig();
  clearSession();
  return getConfig();
}

function clearSession() {
  cookies.clear();
  accessIdSeed = '';
  loginState = { loggedIn: false, lastAttempt: 0, message: '配置已更新，等待重新登录', method: 'sha256' };
  const bridge = nativeBridge();
  if (bridge && typeof bridge.clearSession === 'function') bridge.clearSession();
}

async function controlDevice(action) {
  await ensureLogin();
  const definitions = {
    reboot: ['REBOOT_DEVICE', {}],
    shutdown: ['SHUTDOWN_DEVICE', {}],
    'wifi-on': ['SET_WIFI_INFO', { wifiEnabled: 1 }],
    'wifi-off': ['SET_WIFI_INFO', { wifiEnabled: 0 }]
  };
  if (!definitions[action]) throw new Error('不支持的设备控制命令');
  const [goformId, values] = definitions[action];
  return setGoform(goformId, values);
}

export const routerApi = {
  getConfig,
  updateConfig,
  getOverlayState,
  setOverlayEnabled,
  requestOverlayPermission,
  controlDevice,
  login,
  developerLogin,
  dashboard,
  setTrafficPlan,
  calibrateTraffic,
  listSms,
  sendSms,
  scanNeighbors,
  linkedCellLock,
  setNrCellLock,
  setLteCellLock,
  setLteBands,
  setNrBands
};
