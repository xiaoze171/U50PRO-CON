import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { importBatteryProfileClient } from './helpers/battery-profile-client.mjs';
import { emptyChartHistory } from '../src/utils/history.js';
import { collectionSourceLabels, historyTooltip } from '../src/utils/collection-source.js';
import { lineOption, batterySeries, throughputSeries } from '../src/utils/chart-options.js';
import { normalizeTemperaturePoints } from '../src/utils/temperature.js';

const CSV = 'ts_iso,ts,soc,voltage_mv,current_ma,power_w,temp_c,status,download_bps,upload_bps,net_interval_s,cpu_temp_c,modem_temp_c,pa_temp_c,network_type,lte_rsrp_dbm,lte_rsrq_db,lte_snr_db,nr_rsrp_dbm,nr_rsrq_db,nr_sinr_db\n'
  + '2026-11-18 12:00:00,1795003200,92,4100,-300,-1.23,25,Discharging,1024,128,60,28,29,30,SA,,,,-98,-11,13\n'
  + '2026-11-18 12:01:00,1795003260,91.9,4100,-310,-1.27,25,Discharging,0,0,60,28,29,30,SA,,,,-99,-12,12\n';

async function client(mode = 'gauge88-csv') {
  const storage = new Map([['mu5120-config', { routerUrl: 'http://192.168.0.1' }],
    ['mu5120-battery-history', [{ timestamp: Date.now(), percent: 3, source: 'foreground' }]]]);
  const calls = [], writes = [], pending = [];
  const transport = { fail: false, hold: false };
  globalThis.uni = { getStorageSync: key => storage.get(key), setStorageSync(key, value) { writes.push(key); storage.set(key, value); } };
  const host = { AndroidRouter: { request(id, raw) {
    const options = JSON.parse(raw); calls.push(options);
    const url = new URL(options.url);
    const reply = () => host.__mu5120NativeResponse(id, JSON.stringify(transport.fail
      ? { ok: false, status: 503, error: 'offline' }
      : { ok: true, status: 200, body: transport.csv ?? CSV }));
    assert.equal(url.pathname, '/backup/battery-log.csv', 'chart history must not need a goform login');
    if (transport.hold) pending.push(reply); else queueMicrotask(reply);
  } } };
  globalThis.window = host;
  const api = (await importBatteryProfileClient(mode)).routerApi;
  return { api, transport, calls, writes, pending };
}

test('88 chart history loads before original router login and replaces old phone samples', async () => {
  const c = await client();
  assert.equal(typeof c.api.getDeviceHistory, 'function');
  const result = await c.api.getDeviceHistory();
  assert.equal(result.state, 'ready');
  assert.equal(result.snapshotCount, 2);
  assert.equal(result.chart.down[0][1], 1024);
  assert.equal(result.chart.down[1][1], 0);
  assert.equal(result.chart.signals.nr_rsrp[0][1], -98);
  assert.equal(result.battery[0].percent, 92);
  assert.equal(result.battery[0].source, 'device');
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].url, 'http://192.168.0.1:88/backup/battery-log.csv');
  assert.equal(c.writes.includes('mu5120-battery-history'), false);
  assert.equal(c.api.getBatteryHistory().length, 0, 'old phone battery history is not a device archive');
});

test('CSV refresh failure retains only the same device history and reports failure', async () => {
  const c = await client();
  assert.equal(typeof c.api.getDeviceHistory, 'function');
  const first = await c.api.getDeviceHistory();
  const cached = await c.api.getDeviceHistory();
  assert.equal(cached, first);
  c.transport.fail = true;
  const failed = await c.api.getDeviceHistory(true);
  assert.equal(failed.state, 'unavailable');
  assert.equal(failed.chart, first.chart);
  assert.equal(failed.latestTimestamp, first.latestTimestamp);
  assert.match(failed.error, /offline/);
  c.api.updateConfig({ batteryHost: '192.168.0.2' });
  const other = await c.api.getDeviceHistory();
  assert.equal(other.snapshotCount, 0);
  assert.equal(other.battery.length, 0);
});

test('router history uses independent telemetry rows while estimator CSV remains strict', async () => {
  const c = await client();
  c.transport.csv = CSV.replace('92,4100,-300,-1.23,25,Discharging', ',4100,-300,-1.23,25,Discharging');
  const result = await c.api.getDeviceHistory();
  assert.equal(result.snapshotCount, 2);
  assert.deepEqual(result.chart.down.map(point => point[1]), [1024, 0]);
  assert.equal(result.battery[0].percent, null);
});

test('a late history response cannot reintroduce the previous device after address changes', async () => {
  const c = await client();
  assert.equal(typeof c.api.getDeviceHistory, 'function');
  c.transport.hold = true;
  const work = c.api.getDeviceHistory();
  await Promise.resolve(); await Promise.resolve();
  c.api.updateConfig({ batteryHost: '192.168.0.2' });
  c.pending.shift()();
  const discarded = await work;
  assert.equal(discarded.state, 'invalidated');
  assert.equal(discarded.battery.length, 0);
});

test('factory mode does not fetch device chart history', async () => {
  const c = await client('factory');
  assert.equal(typeof c.api.getDeviceHistory, 'function');
  assert.equal((await c.api.getDeviceHistory()).state, 'disabled');
  assert.equal(c.calls.length, 0);
});

const page = readFileSync(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8');
const script = page.split('<script setup>')[1].split('</script>')[0];
const ast = parse(script, { sourceType: 'module' });
function pageFunction(name, context) {
  const node = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `page function ${name} must exist`);
  return runInNewContext(`(${script.slice(node.start, node.end)})`, context);
}

test('88 page cannot write live values into the device chart archive or persist old chart JSON', () => {
  const histories = emptyChartHistory(), writes = [];
  const context = { usesDeviceHistory: true, histories, Date, uni: { setStorageSync: (...args) => writes.push(args) } };
  pageFunction('captureHistory', context)({ timestamp: Date.now(), signal: { Z5g_rsrp: -80 }, status: { realtime_rx_thrpt: 999 } });
  pageFunction('persistChartHistory', context)(true);
  assert.deepEqual(histories.down, []);
  assert.equal(writes.length, 0);
});

test('88 page applies the complete device archive directly instead of merging with phone JSON', () => {
  const histories = { ...emptyChartHistory(), down: [[123, 999, 'foreground']] };
  const deviceHistory = { value: null }, backgroundSourceCounts = {}, backgroundBackfill = { value: '' };
  const payload = { state: 'ready', chart: { ...emptyChartHistory(), down: [[456, 10, 'device']] }, battery: [], sourceCounts: { device: 1 }, snapshotCount: 1 };
  pageFunction('applyDeviceHistory', { histories, deviceHistory, backgroundSourceCounts, backgroundBackfill, collectionSourceLabels })(payload);
  assert.deepEqual(histories.down, [[456, 10, 'device']]);
  assert.equal(deviceHistory.value, payload);
  assert.equal(backgroundSourceCounts.device, 1);
});

test('device chart points retain continuity identities through throughput and battery rendering', () => {
  const times = [60000, 120000];
  const speeds = throughputSeries({ down: [[times[0], 1024, 'device', 'B/s', 'a'], [times[1], 2048, 'device', 'B/s', 'b']], up: [] }, 0);
  assert.equal(speeds[0].data[0][4], 'a');
  const series = batterySeries(times.map((timestamp, i) => ({ timestamp, percent: 50, source: 'device', identity: i ? 'b' : 'a' })));
  assert.notEqual(series[0].data[0][4], series[0].data[1][4]);
  const chart = lineOption(series, false, {}, { now: 120000, windowMs: 120000 });
  assert.equal(chart.series[0].data.length, 3, 'chart inserts a discontinuity between different device segments');
  assert.match(historyTooltip({ seriesName: '电量', value: [120000, 50, 'device'] }), /设备记录/);
});

test('device temperature gaps and segment identity survive chart preparation', () => {
  const points = [[60000, 25, 'device', '°C', 'a'], [120000, null, 'device', '°C', 'a'], [180000, 26, 'device', '°C', 'b']];
  assert.deepEqual(normalizeTemperaturePoints('cpu_temp', points), points);
});

test('device chart window follows the archived calendar instead of the unrelated phone clock', () => {
  const behavior = pageFunction('chartHistoryBehavior', { usesDeviceHistory: true,
    deviceHistory: { value: { latestTimestamp: 180000 } }, Date })(120000, 'temperature', '°C');
  assert.equal(behavior.now, 180000);
  assert.equal(behavior.maxGapMs, 120000);
  const chart = lineOption([{ name: 'CPU', data: [[180000, 25, 'device']] }], false, {}, behavior);
  assert.equal(chart.xAxis.max, 180000);
  assert.equal(chart.series[0].data.length, 1);
});

test('device windows end at the exact last record second while factory windows still round to a minute', () => {
  for (const windowMs of [7200000, 86400000]) {
    const behavior = pageFunction('chartHistoryBehavior', { usesDeviceHistory: true,
      deviceHistory: { value: { latestTimestamp: 1795009836000 } }, Date })(windowMs, 'battery');
    const option = lineOption([], false, {}, behavior);
    assert.equal(option.xAxis.max, 1795009836000);
    assert.equal(option.xAxis.min, windowMs === 7200000 ? 1795002636000 : 1794923436000);
  }
  const factory = lineOption([], false, {}, { now: 1795009836000, windowMs: 7200000 });
  assert.equal(factory.xAxis.max, 1795009860000);
  assert.equal(factory.xAxis.min, 1795002660000);
});

test('device minute drift up to two minutes stays connected while longer missing intervals break', () => {
  const chart = lineOption([{ name: 'NR', data: [[60000, -90, 'device'], [170000, -91, 'device'], [300000, -92, 'device']] }], false, {},
    { now: 300000, windowMs: 300000, maxGapMs: 120000 });
  assert.equal(chart.series[0].data.length, 4);
});
