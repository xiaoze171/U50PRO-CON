import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { importBatteryProfileClient } from './helpers/battery-profile-client.mjs';

const storage = new Map();
const snapshots = [];
const smsSnapshots = [];
const nativeTimestamp = Math.floor(Date.now() / 60000) * 60000 - 60000;
let synchronousBatteryReads = 0;
const fixtures = {
  loginfo: 'ok', battery_vol_percent: '0', battery_charging: '0', battery_temp: '33',
  realtime_rx_thrpt: '2048', realtime_tx_thrpt: '512', monthly_rx_bytes: '987654',
  lte_rsrp: '-93', Z5g_SINR: '17', nr5g_pci: '42', cpu_usage: '12',
  wifi_chip_temp: '41', lte_band_lock: '0x4', data_volume_limit_switch: '1',
  lte_ngbr_cell_info_ext: 'neighbor-data'
};
const clientResponses = {
  station_list: { station_list: [{ hostname: 'phone', ip_addr: '192.168.0.2' }] },
  lan_station_list: { lan_station_list: [{ hostname: 'pc' }] }
};
const failedClientCommands = new Set();

globalThis.uni = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value)
};
const nativeHistory = {
  chart: { rsrp: [[nativeTimestamp, -95]], sinr: [], rsrq: [], down: [[nativeTimestamp, 4096]], up: [], temperatures: { wifi_chip_temp: [[nativeTimestamp, 40]] } },
  battery: [{ timestamp: nativeTimestamp, percent: 48, charging: false }],
  snapshotCount: 1,
  lastSavedAt: 1790133361000
};
globalThis.window = {
  AndroidRouter: {
    getBackgroundBatteryHistory() { synchronousBatteryReads++; return '[]'; },
    getBackgroundBatteryHistoryAsync(id) { queueMicrotask(() => window.__mu5120HistoryResponse(id, '[]')); },
    getBackgroundHistory(id) { queueMicrotask(() => window.__mu5120HistoryResponse(id, JSON.stringify(nativeHistory))); },
    getBackgroundMonitorState: () => JSON.stringify({ lastSavedAt: 1790133361000, background: true, lastError: '' }),
    isIgnoringBatteryOptimizations: () => false,
    updateBackgroundSnapshot: value => snapshots.push(JSON.parse(value)),
    updateBackgroundSms: value => smsSnapshots.push(JSON.parse(value)),
    request(id, raw) {
      const url = new URL(JSON.parse(raw).url);
      if (url.port === '88') {
        queueMicrotask(() => window.__mu5120NativeResponse(id, JSON.stringify({ ok: true, status: 200,
          headers: { 'X-Gauge-Age': '0' },
          body: JSON.stringify({ soc: 0, data_quality: 'ok', ts: Date.now() / 1000 }) })));
        return;
      }
      const command = url.searchParams.get('cmd');
      if (failedClientCommands.has(command)) {
        queueMicrotask(() => window.__mu5120NativeResponse(id, JSON.stringify({ ok: false, status: 503, error: '设备列表获取失败' })));
        return;
      }
      let body;
      if (command in clientResponses) body = clientResponses[command];
      else if (command === 'sms_cmd_status_info') body = { sms_cmd_status_result: '3' };
      else if (command === 'sms_capacity_info') body = { sms_nv_total: '500', sms_nv_rev_total: '1' };
      else if (command === 'sms_data_total') body = { messages: [{ id: '7', content: '00410042', number: '10086' }] };
      else body = Object.fromEntries(command.split(',').map(key => [key, fixtures[key] ?? '']));
      queueMicrotask(() => window.__mu5120NativeResponse(id, JSON.stringify({ ok: true, status: 200, body: JSON.stringify(body) })));
    }
  }
};

const { routerApi } = await importBatteryProfileClient('factory');

const page = readFileSync(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8');
const pageScript = page.split('<script setup>')[1].split('</script>')[0];
const pageAst = parse(pageScript, { sourceType: 'module' });
const requiredPageFunctions = new Set(['clientListAvailability', 'clientListCountText', 'clientEmptyText', 'trafficPlanGb']);
const pageFunctions = pageAst.program.body.filter(item => item.type === 'FunctionDeclaration' && requiredPageFunctions.has(item.id.name))
  .map(item => pageScript.slice(item.start, item.end)).join('\n');
function pageComputed(name, snapshot) {
  const declaration = pageAst.program.body.flatMap(item => item.declarations || []).find(item => item.id.name === name);
  assert.ok(declaration, `${name} must provide the page summary`);
  const callback = declaration.init.arguments[0];
  return runInNewContext(`${pageFunctions}\n(${pageScript.slice(callback.start, callback.end)})()`, {
    data: { value: snapshot }, stations: { value: snapshot.stations || [] }, cableStations: { value: snapshot.cableStations || [] },
    features: { value: snapshot.features || {} }, monthlyUsedBytes: { value: null }
  });
}
function pageClientText(name, snapshot, group) {
  const declaration = pageAst.program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(declaration, `${name} must describe client acquisition status`);
  return runInNewContext(`${pageFunctions}\n${name}(${JSON.stringify(group)})`, {
    data: { value: snapshot }, stations: { value: snapshot.stations || [] }, cableStations: { value: snapshot.cableStations || [] }
  });
}

test('successful empty client endpoints distinguish measured zero from unavailable lists', async () => {
  const previous = { ...clientResponses };
  try {
    clientResponses.station_list = { station_list: [] };
    clientResponses.lan_station_list = { lan_station_list: [] };
    const result = await routerApi.dashboard();
    assert.deepEqual(result.clientAvailability, { stations: true, cableStations: true });
    assert.deepEqual(snapshots.at(-1).clientAvailability, { stations: true, cableStations: true });
    assert.equal(pageComputed('clientSummaryText', result), '0 台已连接');
  } finally {
    Object.assign(clientResponses, previous);
  }
});

test('optional client endpoint failures preserve the dashboard without claiming zero connected devices', async () => {
  try {
    failedClientCommands.add('station_list');
    failedClientCommands.add('lan_station_list');
    const result = await routerApi.dashboard();
    assert.equal(result.status.monthly_rx_bytes, '987654');
    assert.equal(result.signal.lte_rsrp, '-93');
    assert.deepEqual(result.stations, []);
    assert.deepEqual(result.cableStations, []);
    assert.deepEqual(result.clientAvailability, { stations: false, cableStations: false });
    assert.match(pageComputed('clientSummaryText', result), /获取失败.*数量未知/);
    assert.match(pageClientText('clientEmptyText', result, 'stations'), /无线.*获取失败/);
    assert.match(pageClientText('clientEmptyText', result, 'cableStations'), /有线.*获取失败/);
    assert.match(pageClientText('clientListCountText', result, 'stations'), /待获取/);
  } finally {
    failedClientCommands.clear();
  }
});

test('partial client acquisition labels available entries as records with unknown total', async () => {
  try {
    failedClientCommands.add('lan_station_list');
    const result = await routerApi.dashboard();
    assert.deepEqual(result.clientAvailability, { stations: true, cableStations: false });
    assert.equal(result.stations[0].hostname, 'phone');
    assert.match(pageComputed('clientSummaryText', result), /1 条设备记录.*连接数量未知/);
  } finally {
    failedClientCommands.clear();
  }
});

test('successful HTTP responses without client-list fields stay unavailable', async () => {
  const previous = { ...clientResponses };
  try {
    clientResponses.station_list = {};
    clientResponses.lan_station_list = null;
    let result;
    await assert.doesNotReject(async () => { result = await routerApi.dashboard(); }, 'optional missing client lists must not reject the dashboard');
    assert.deepEqual(result.clientAvailability, { stations: false, cableStations: false });
    assert.match(pageComputed('clientSummaryText', result), /数量未知/);
    assert.equal(result.signal.lte_rsrp, '-93');
  } finally {
    Object.assign(clientResponses, previous);
  }
});

test('legacy snapshots without client acquisition metadata never imply a measured zero', () => {
  const empty = { timestamp: 1000, stations: [], cableStations: [] };
  assert.match(pageComputed('clientSummaryText', empty), /数量待获取/);
  const populated = { ...empty, stale: true, stations: [{ hostname: 'phone' }], cableStations: [{ hostname: 'pc' }] };
  assert.match(pageComputed('clientSummaryText', populated), /2 条设备记录.*数量未知.*缓存/);
  assert.match(pageClientText('clientEmptyText', empty, 'stations'), /待获取/);
  assert.match(pageClientText('clientListCountText', populated, 'stations'), /1 条记录/);
  assert.match(pageComputed('clientSummaryText', { ...empty, errors: { stations: '后台请求失败' } }), /获取失败.*数量未知/);
});

test('known empty client lists show no devices only when the snapshot is current', () => {
  const snapshot = { timestamp: 1000, stations: [], cableStations: [], clientAvailability: { stations: true, cableStations: true } };
  assert.match(pageClientText('clientEmptyText', snapshot, 'stations'), /当前没有无线设备/);
  assert.match(pageClientText('clientEmptyText', { ...snapshot, stale: true }, 'stations'), /缓存.*记录/);
  assert.equal(pageComputed('clientSummaryText', { ...snapshot, stale: true }), '0 台 · 缓存');
});

test('foreground samples hand all dashboard groups and their original timestamp to native persistence', async () => {
  const result = await routerApi.dashboard();
  const saved = snapshots.at(-1);
  assert.equal(saved.source, 'foreground');
  assert.equal(result.battery.samples.at(-1).source, 'foreground');
  assert.equal(saved.timestamp, result.timestamp, 'a snapshot must retain its actual collection time');
  assert.equal(saved.signal.lte_rsrp, '-93');
  assert.equal(saved.signal.nr5g_pci, '42');
  assert.equal(saved.temperature.wifi_chip_temp, '41');
  assert.equal(saved.resources.cpu_usage, '12');
  assert.equal(saved.locks.lte_band_lock, '0x4');
  assert.equal(saved.status.monthly_rx_bytes, '987654');
  assert.equal(saved.status.battery_vol_percent, '0');
  assert.equal(saved.stations[0].hostname, 'phone');
  assert.equal(saved.cableStations[0].hostname, 'pc');
  assert.equal(saved.neighbors.lte_ngbr_cell_info_ext, 'neighbor-data');
  assert.equal(saved.features.data_volume_limit_switch, '1');
  assert.equal(saved.battery?.samples, undefined, 'do not duplicate the entire battery history in every snapshot');
});

test('dashboard history reads use the asynchronous bridge instead of blocking the WebView', async () => {
  await routerApi.dashboard();
  assert.equal(synchronousBatteryReads, 0);
});

test('SMS snapshots preserve decoded content, raw content and capacity for offline recovery', async () => {
  const result = await routerApi.listSms();
  const saved = smsSnapshots.at(-1);
  assert.ok(saved, 'SMS data must reach persistent native storage');
  assert.equal(saved.source, 'foreground');
  assert.equal(saved.messages[0].content, 'AB');
  assert.equal(saved.messages[0].rawContent, '00410042');
  assert.equal(saved.capacity.sms_nv_total, '500');
  assert.equal(saved.timestamp, result.timestamp);
});

test('factory native history backfill imports battery samples through the same-phone history API', async () => {
  const history = await routerApi.getBackgroundHistory();
  assert.equal(history.chart.rsrp[0][1], -95);
  assert.equal(history.chart.temperatures.wifi_chip_temp[0][1], 40);
  assert.equal(history.snapshotCount, 1);
  assert.equal(typeof routerApi.mergeBackgroundBatteryHistory, 'function', 'local recovery needs a background history import API');
  const merged = routerApi.mergeBackgroundBatteryHistory(history.battery);
  assert.ok(merged.some(item => item.timestamp === nativeTimestamp && item.percent === 48), 'background battery samples must enter local history');
});

test('background monitor state and battery optimization status are readable from the page', () => {
  const state = routerApi.getBackgroundMonitorState();
  assert.equal(state.available, true);
  assert.equal(state.background, true);
  assert.equal(state.lastSavedAt, 1790133361000);
  const power = routerApi.getBatteryOptimizationState();
  assert.equal(power.available, true);
  assert.equal(power.ignoring, false);
});

test('empty factory charging flags stay off while invalid temperatures remain diagnostic only', async () => {
  const previous = { ...fixtures };
  try {
    fixtures.battery_charging = '';
    fixtures.external_charging_flag = '';
    fixtures.battery_temp = '-80';
    fixtures.wifi_chip_temp = '-80';
    routerApi.resetBatteryCollection();
    const expectedCharging = routerApi.getConfig().batterySource === 'factory' ? false : null;
    const result = await routerApi.dashboard();
    assert.equal(result.battery.charging, expectedCharging);
    assert.equal(result.battery.remainingHours, null);
    assert.equal(result.battery.ratePerHour, null);
    assert.equal(result.battery.samples.at(-1).temperature, null);
    assert.equal(result.battery.samples.at(-1).charging, expectedCharging);
    assert.equal(result.temperature.wifi_chip_temp, '-80');
    assert.equal(snapshots.at(-1).temperature.battery_temp, '-80');
  } finally {
    Object.keys(fixtures).forEach(key => delete fixtures[key]);
    Object.assign(fixtures, previous);
  }
});

test('gauge profile keeps unknown charging when factory flags are empty and never imports invalid factory temperature', async () => {
  const previous = { ...fixtures };
  const nativeResponse = window.__mu5120NativeResponse;
  const historyResponse = window.__mu5120HistoryResponse;
  try {
    fixtures.battery_charging = '';
    fixtures.external_charging_flag = '';
    fixtures.battery_temp = '-80';
    fixtures.wifi_chip_temp = '-80';
    delete window.__mu5120HistoryResponse;
    const gaugeApi = (await importBatteryProfileClient('gauge88-csv')).routerApi;
    const result = await gaugeApi.dashboard();
    assert.equal(result.battery.charging, null);
    assert.equal(result.battery.samples.at(-1).charging, null);
    assert.equal(result.battery.samples.at(-1).temperature, null);
    assert.equal(result.battery.remainingHours, null);
    assert.equal(result.temperature.wifi_chip_temp, '-80');
    assert.equal(snapshots.at(-1).temperature.battery_temp, '-80');
  } finally {
    Object.keys(fixtures).forEach(key => delete fixtures[key]);
    Object.assign(fixtures, previous);
    window.__mu5120NativeResponse = nativeResponse;
    window.__mu5120HistoryResponse = historyResponse;
  }
});

test('native backfill sanitizes legacy temperature histories without changing diagnostic snapshots', async () => {
  const previous = JSON.parse(JSON.stringify(nativeHistory));
  try {
    nativeHistory.chart.temperatures.wifi_chip_temp.push([nativeTimestamp + 60000, -80, 'screenOff']);
    nativeHistory.chart.temperatures.therm_pa_level = [[nativeTimestamp, 1]];
    nativeHistory.chart.temperatures.wifi_temp_level_1 = [[nativeTimestamp, 37, 'overlay']];
    nativeHistory.battery[0].temperature = -80;
    nativeHistory.snapshots = [{ temperature: { wifi_chip_temp: '-80' } }];
    const history = await routerApi.getBackgroundHistory();
    assert.equal(history.chart.temperatures.wifi_chip_temp.length, 1);
    assert.equal(history.chart.temperatures.therm_pa_level, undefined);
    assert.equal(history.chart.temperatures.wifi_temp_level_1[0][2], 'overlay');
    assert.equal(history.battery[0].temperature, null);
    assert.equal(history.snapshots[0].temperature.wifi_chip_temp, '-80');
  } finally {
    Object.keys(nativeHistory).forEach(key => delete nativeHistory[key]);
    Object.assign(nativeHistory, previous);
  }
});

test('a measured numeric zero battery percentage does not fall back to another field', async () => {
  const previous = { ...fixtures };
  try {
    fixtures.battery_vol_percent = 0;
    fixtures.battery_value = '80';
    const result = await routerApi.dashboard();
    assert.equal(result.battery.percent, 0);
  } finally {
    Object.keys(fixtures).forEach(key => delete fixtures[key]);
    Object.assign(fixtures, previous);
  }
});
