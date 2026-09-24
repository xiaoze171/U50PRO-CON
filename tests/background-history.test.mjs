import assert from 'node:assert/strict';
import { test } from 'node:test';

const storage = new Map();
const snapshots = [];
const smsSnapshots = [];
const fixtures = {
  loginfo: 'ok', battery_vol_percent: '0', battery_charging: '0', battery_temp: '33',
  realtime_rx_thrpt: '2048', realtime_tx_thrpt: '512', monthly_rx_bytes: '987654',
  lte_rsrp: '-93', Z5g_SINR: '17', nr5g_pci: '42', cpu_usage: '12',
  wifi_chip_temp: '41', lte_band_lock: '0x4', data_volume_limit_switch: '1',
  lte_ngbr_cell_info_ext: 'neighbor-data'
};

globalThis.uni = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value)
};
const nativeHistory = {
  chart: { rsrp: [[1790133360000, -95]], sinr: [], rsrq: [], down: [[1790133360000, 4096]], up: [], temperatures: { wifi_chip_temp: [[1790133360000, 40]] } },
  battery: [{ timestamp: 1790133360000, percent: 48, charging: false }],
  snapshotCount: 1,
  lastSavedAt: 1790133361000
};
globalThis.window = {
  AndroidRouter: {
    getBackgroundBatteryHistory: () => '[]',
    getBackgroundHistory(id) { queueMicrotask(() => window.__mu5120HistoryResponse(id, JSON.stringify(nativeHistory))); },
    getBackgroundMonitorState: () => JSON.stringify({ lastSavedAt: 1790133361000, background: true, lastError: '' }),
    isIgnoringBatteryOptimizations: () => false,
    updateBackgroundSnapshot: value => snapshots.push(JSON.parse(value)),
    updateBackgroundSms: value => smsSnapshots.push(JSON.parse(value)),
    request(id, raw) {
      const url = new URL(JSON.parse(raw).url);
      const command = url.searchParams.get('cmd');
      let body;
      if (command === 'station_list') body = { station_list: [{ hostname: 'phone', ip_addr: '192.168.0.2' }] };
      else if (command === 'lan_station_list') body = { lan_station_list: [{ hostname: 'pc' }] };
      else if (command === 'sms_cmd_status_info') body = { sms_cmd_status_result: '3' };
      else if (command === 'sms_capacity_info') body = { sms_nv_total: '500', sms_nv_rev_total: '1' };
      else if (command === 'sms_data_total') body = { messages: [{ id: '7', content: '00410042', number: '10086' }] };
      else body = Object.fromEntries(command.split(',').map(key => [key, fixtures[key] ?? '']));
      queueMicrotask(() => window.__mu5120NativeResponse(id, JSON.stringify({ ok: true, status: 200, body: JSON.stringify(body) })));
    }
  }
};

const { routerApi } = await import('../src/services/router-client.js');

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

test('native history backfill returns chart series, battery samples and merges battery into local history', async () => {
  const history = await routerApi.getBackgroundHistory();
  assert.equal(history.chart.rsrp[0][1], -95);
  assert.equal(history.chart.temperatures.wifi_chip_temp[0][1], 40);
  assert.equal(history.snapshotCount, 1);
  const merged = routerApi.mergeExternalBattery(history.battery);
  assert.ok(merged.some(item => item.timestamp === 1790133360000 && item.percent === 48), 'background battery samples must enter local history');
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
