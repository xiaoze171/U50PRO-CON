import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { numeric, firstValue, withUnit } from '../src/utils/format.js';
import { normalizePoints } from '../src/utils/history.js';
import { isTemperatureField, temperatureReading, normalizeTemperaturePoints } from '../src/utils/temperature.js';
import { batteryModeText, formatBatteryTime, batteryTimeReason } from '../src/utils/battery-presentation.js';

const page = readFileSync(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8');
const script = page.split('<script setup>')[1].split('</script>')[0];
const ast = parse(script, { sourceType: 'module' });
function pageFunction(name, context = {}) {
  const node = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `${name} must implement dashboard behavior`);
  return runInNewContext(`(${script.slice(node.start, node.end)})`, context);
}
function pageComputed(name, context = {}) {
  const declaration = ast.program.body.flatMap(item => item.declarations || []).find(item => item.id.name === name);
  const callback = declaration.init.arguments[0];
  return runInNewContext(`(${script.slice(callback.start, callback.end)})()`, context);
}

test('settings entries open their editor and reject unknown sections', () => {
  const settingsSection = { value: '' };
  const diagnosticsOpen = { value: false };
  const open = pageFunction('openSettingsSection', { settingsSection, diagnosticsOpen });
  open('connection');
  assert.equal(settingsSection.value, 'connection');
  open('diagnostics');
  assert.equal(settingsSection.value, 'diagnostics');
  assert.equal(diagnosticsOpen.value, true);
  open('missing');
  assert.equal(settingsSection.value, 'diagnostics');
  open('update');
  assert.equal(settingsSection.value, 'update');
  assert.equal(diagnosticsOpen.value, false);
});

test('carrier aggregation summary does not treat firmware flags as active carriers', () => {
  const describe = pageFunction('carrierAggregationText');
  assert.equal(describe({}), '待获取');
  assert.equal(describe({ nr_ca_dl_state: '0', nr_multi_ca_scell_info: '1' }), '待获取');
  assert.equal(describe({ wan_lte_ca: 'ca_activated' }), 'LTE CA');
  assert.equal(describe({ wan_lte_ca: 'ca_deactivated' }), '未启用');
  assert.equal(describe({ nr_multi_ca_scell_info: 'n78,640000,100' }), 'NR CA');
});

test('native back returns from a settings editor to settings before leaving the tab', () => {
  const activeTab = { value: 'settings' };
  const settingsSection = { value: 'diagnostics' };
  const diagnosticsOpen = { value: true };
  const back = pageFunction('handleNavigationBack', {
    menuOpen: { value: false }, activeTab, settingsSection, diagnosticsOpen,
    switchTab: id => { activeTab.value = id; }
  });
  assert.equal(back(), true);
  assert.equal(activeTab.value, 'settings');
  assert.equal(settingsSection.value, '');
  assert.equal(diagnosticsOpen.value, false);
  assert.equal(back(), true);
  assert.equal(activeTab.value, 'overview');
  assert.equal(back(), false);
});

test('legacy and native links retain their feature destinations in four main tabs', () => {
  const resolve = pageFunction('resolveNavigation');
  const destinations = [
    ['radio', '', 'devices', 'radio', 'throughput', ''],
    ['usage', '', 'trends', 'clients', 'throughput', 'usage'],
    ['battery', '', 'trends', 'clients', 'battery', ''],
    ['signal', '', 'trends', 'clients', 'signal', ''],
    ['temperature', '', 'trends', 'clients', 'temperature', ''],
    ['sms', '', 'devices', 'sms', 'throughput', ''],
    ['manage', 'settings', 'settings', 'clients', 'throughput', ''],
    ['manage', 'sms', 'devices', 'sms', 'throughput', ''],
    ['clients', '', 'devices', 'clients', 'throughput', ''],
    ['stock', '', 'devices', 'stock', 'throughput', ''],
    ['devices', '', 'devices', 'clients', 'throughput', ''],
    ['bogus', '', 'overview', 'clients', 'throughput', ''],
  ];
  for (const [tab, section, expectedTab, device, metric, detail] of destinations) {
    assert.deepEqual(JSON.parse(JSON.stringify(resolve(tab, section))), { tab: expectedTab, device, metric, detail });
  }
});

test('usage totals preserve unknown readings and distinguish measured zero', () => {
  const sum = pageFunction('totalBytes', { numeric });
  assert.equal(sum(undefined, undefined), null);
  assert.equal(sum('1024', undefined), null);
  assert.equal(sum('', '0'), null);
  assert.equal(sum('0', '0'), 0);
  assert.equal(sum('1024', '2048'), 3072);
  assert.equal(sum('-1', '2048'), null);
});

test('freshness follows acquisition time instead of successful cache polling', () => {
  const describe = pageFunction('describeFreshness');
  assert.equal(describe({ connected: false, timestamp: 0, now: 100000 }).state, 'offline');
  assert.equal(describe({ connected: true, timestamp: 99000, now: 100000 }).state, 'live');
  assert.equal(describe({ connected: true, timestamp: 1000, now: 100000 }).state, 'stale');
  assert.equal(describe({ connected: true, timestamp: 99000, stale: true, now: 100000 }).state, 'stale');
  assert.equal(describe({ connected: true, timestamp: 0, now: 100000 }).state, 'offline');
  assert.equal(describe({ connected: false, timestamp: 99000, now: 100000 }).state, 'stale');
});

test('system back closes the current secondary view before leaving the app', () => {
  const state = {
    activeTab: { value: 'devices' }, managementTab: { value: 'radio' },
    trendMetric: { value: 'throughput' }, trendDetail: { value: '' },
    menuOpen: { value: false }, smsComposeOpen: { value: false }, diagnosticsOpen: { value: false },
  };
  const back = pageFunction('handleNavigationBack', {
    ...state, switchTab(id) { state.activeTab.value = id; state.managementTab.value = 'clients'; },
  });
  assert.equal(back(), true);
  assert.equal(state.activeTab.value, 'devices');
  assert.equal(state.managementTab.value, 'clients');
  assert.equal(back(), true);
  assert.equal(state.activeTab.value, 'overview');
  assert.equal(back(), false);
  state.activeTab.value = 'trends';
  state.trendDetail.value = 'usage';
  assert.equal(back(), true);
  assert.equal(state.trendDetail.value, '');
  assert.equal(state.activeTab.value, 'trends');
  state.trendMetric.value = 'battery';
  assert.equal(back(), true);
  assert.equal(state.trendMetric.value, 'throughput');
});

test('page capture and storage exclude suspect temperatures while preserving raw snapshots and negative signals', () => {
  const now = 1800000000000;
  const histories = { rsrp: [], sinr: [], rsrq: [], down: [], up: [], temperatures: {} };
  const common = { CHART_HISTORY_SAMPLE_MS: 60000, CHART_HISTORY_MAX_POINTS: 1445, METRIC_HISTORY_WINDOW_MS: 86400000 };
  const pruneHistory = pageFunction('pruneHistory', common);
  const pushHistory = pageFunction('pushHistory', { ...common, pruneHistory });
  const capture = pageFunction('captureHistory', { histories, ...common, numeric, firstValue, isTemperatureField, temperatureReading, pushHistory, pruneHistory, persistChartHistory() {} });
  const snapshot = { timestamp: now, source: 'foreground', signal: { lte_rsrp: '-80' }, temperature: { wifi_chip_temp: '-80', wifi_temp_level_1: '43', therm_wcn_level: '1' } };
  capture(snapshot);
  assert.equal(histories.temperatures.wifi_chip_temp, undefined);
  assert.equal(histories.temperatures.therm_wcn_level, undefined);
  assert.equal(histories.temperatures.wifi_temp_level_1[0][1], 43);
  assert.equal(histories.rsrp[0][1], -80);
  assert.equal(snapshot.temperature.wifi_chip_temp, '-80');
  const normalizePointList = pageFunction('normalizePointList', { ...common, normalizePoints });
  const stored = { temperatures: { wifi_chip_temp: [[now - 60000, 42, 'screenOff'], [now, -80, 'foreground']], wifi_temp_level_1: [[now, 43, 'foreground']] } };
  const load = pageFunction('loadChartHistory', { ...common, CHART_HISTORY_KEY: 'test', Date: { now: () => now }, normalizePointList, normalizeTemperaturePoints, uni: { getStorageSync: () => stored } });
  const loaded = load();
  assert.equal(loaded.temperatures.wifi_chip_temp.length, 1);
  assert.equal(loaded.temperatures.wifi_chip_temp[0][2], 'screenOff');
  assert.equal(loaded.temperatures.wifi_temp_level_1[0][1], 43);
  assert.equal(stored.temperatures.wifi_chip_temp.length, 2);
});

test('stale snapshots keep the original acquisition timestamp despite later polling timestamps', () => {
  const merge = pageFunction('mergeDashboard');
  const stale = merge({ timestamp: 1000, source: 'screenOff', status: { value: 1 } }, { stale: true, timestamp: 99000 });
  assert.equal(stale.timestamp, 1000);
  assert.equal(stale.source, 'screenOff');
});

test('a successful poll clears the failed-poll stale flag so history resumes', () => {
  const merge = pageFunction('mergeDashboard');
  const previous = { stale: true, timestamp: 1000, source: 'screenOff', login: { loggedIn: true } };
  const recovered = merge(previous, { timestamp: 2000, source: 'foreground', login: { loggedIn: true }, status: { battery_value: '50' } });
  assert.equal(recovered.stale, false);
  assert.equal(recovered.timestamp, 2000);
  assert.equal(recovered.source, 'foreground');
  assert.equal(merge(recovered, { stale: true, timestamp: 3000 }).stale, true);
});

test('fresh legacy snapshots cannot inherit client availability from another collector', () => {
  const merge = pageFunction('mergeDashboard');
  const previous = { timestamp: 1000, clientAvailability: { stations: true, cableStations: true }, errors: { stations: 'old failure' } };
  const legacy = merge(previous, { timestamp: 2000, stations: [], cableStations: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.clientAvailability)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.errors)), {});
  const cached = merge(previous, { stale: true, timestamp: 3000 });
  assert.equal(cached.clientAvailability.stations, true);
});

test('home temperature entry reports anomalies without treating missing sensors as failures', () => {
  const metrics = [{ state: 'valid' }, { state: 'invalid' }, { state: 'missing' }, { state: 'invalid' }];
  assert.equal(pageComputed('homeTemperatureAlert', { homeTemperatureMetrics: { value: metrics } }), '2 项读数异常');
  assert.equal(pageComputed('homeTemperatureAlert', { homeTemperatureMetrics: { value: [{ state: 'missing' }] } }), '');
});

test('home time items use independent results and never display cached estimates as live', () => {
  const now = 1700000000000;
  const freshnessNow = { value: now };
  const battery = { value: { calculatedAt: now, measurement: { mode: 'discharging', externalPower: true },
    timeToFull: { state: 'not-applicable', reason: '未净充电', minutes: null },
    runtime: { state: 'estimated', minutes: 120 }, remainingHours: 9 } };
  const data = { value: { stale: false, timestamp: now } };
  const result = pageFunction('batteryTimeResult', { battery, data, freshnessNow });
  const context = { battery, data, batteryTimeResult: result, formatBatteryTime, batteryTimeReason, batteryModeText };
  assert.equal(pageComputed('batteryStateText', context), '插电 · 仍在放电');
  assert.equal(pageComputed('batteryTimeToFullText', context), '—');
  assert.equal(pageComputed('batteryRuntimeText', context), '约 2 小时');
  data.value.stale = true;
  assert.equal(pageComputed('batteryRuntimeText', context), '—');
  assert.equal(pageComputed('batteryRuntimeReason', context), '待刷新');
  data.value.stale = false;
  battery.value = { remainingHours: 9 };
  assert.equal(pageComputed('batteryRuntimeText', context), '—', 'legacy hours must not become two independent new estimates');
});

test('home estimates expire while a slow poll is still pending and cannot renew a gauge deadline', () => {
  const capturedAt = 1700000000000;
  const freshnessNow = { value: capturedAt };
  const runtime = { state: 'estimated', minutes: 120 };
  const timeToFull = { state: 'estimated', minutes: 60 };
  const battery = { value: { calculatedAt: capturedAt, runtime, timeToFull } };
  const data = { value: { stale: false, timestamp: capturedAt, status: {} } };
  const result = pageFunction('batteryTimeResult', { battery, data, freshnessNow });
  assert.equal(result('runtime'), runtime);
  freshnessNow.value = capturedAt + 5000;
  assert.equal(result('runtime'), runtime, 'the five-second boundary remains valid');
  freshnessNow.value++;
  assert.equal(data.value.stale, false, 'a pending network request has not reported failure yet');
  for (const key of ['runtime', 'timeToFull']) {
    assert.equal(result(key).minutes, null);
    assert.equal(result(key).reason, '待刷新');
  }
  data.value.timestamp = freshnessNow.value;
  assert.equal(result('runtime').minutes, null, 'a newer enclosing snapshot cannot renew an old calculation');
  battery.value.calculatedAt = freshnessNow.value;
  assert.equal(result('runtime'), runtime);
  data.value.timestamp = capturedAt;
  assert.equal(result('runtime').minutes, null, 'a recomputed summary cannot renew an old acquisition');
  data.value.timestamp = freshnessNow.value;
  data.value.status.battery_gauge = { state: 'valid', validUntil: freshnessNow.value + 1000 };
  freshnessNow.value += 1000;
  assert.equal(result('runtime'), runtime);
  freshnessNow.value++;
  assert.equal(result('runtime').minutes, null, 'the gauge deadline expires before the enclosing five-second window');
  data.value.status = {};
  data.value.timestamp = undefined;
  assert.equal(result('runtime').minutes, null, 'missing acquisition time cannot make an estimate live');
});

test('battery diagnostics preserve signed currents, convert units and distinguish missing input from zero', () => {
  const diagnostics = pageFunction('buildBatteryDiagnostics');
  const entries = diagnostics({ netCurrentMa: -283.813, netPowerW: -1.204, voltageMv: 4256.711,
    usableCapacityMah: 8780, capacityBasis: 'fixture-basis', fullStableSeconds: 600, fullConfirmed: false, fullAnchorValid: true },
  { usb_online: 0, input_current_ma: null, input_voltage_mv: null, input_power_w: null, input_data_quality: 'disconnected',
    system_voltage_mv: 4252.032, system_current_ma: null, charge_uah: 1234000, discharge_uah: 5678000,
    missing_s: 0, gap_events: 0, data_quality: 'ok' }, { windowSeconds: 60 });
  const values = Object.fromEntries(Array.from(entries, item => [item.label, item.value]));
  assert.equal(values['电池净电流'], '-283.81 mA');
  assert.equal(values['电池电压'], '4.257 V');
  assert.equal(values['USB 总输入电流'], '—');
  assert.equal(values['USB 输入质量'], '已断开');
  assert.equal(values['系统轨电压'], '4.252 V');
  assert.equal(values['累计充入'], '1234.00 mAh');
  assert.equal(values['累计放出'], '5678.00 mAh');
  assert.equal(values['采样缺失'], '0 秒');
  assert.equal(values['满充观察'], '10.0 / 20 分钟');
  assert.equal(values['历史满充基准'], '存在');
});

test('battery detail temperature follows the active SOC source and never falls back from a gauge to factory temperature', () => {
  const now = 1700000000000;
  const context = {
    data: { value: { timestamp: now } }, freshnessNow: { value: now },
    battery: { value: { percentSource: 'gauge88' } },
    status: { value: { battery_gauge: { state: 'valid', validUntil: now + 5000, raw: { temp_c: 31 } } } },
    temperature: { value: { battery_temp: '45' } }, temperatureReading, withUnit,
    batteryPercentText: { value: '50.00%' }, batterySourceNote: { value: '软件估算' },
    batteryStateText: { value: '放电中' }, batteryTimeToFullText: { value: '—' },
    batteryTimeToFullReason: { value: '' }, batteryRuntimeText: { value: '约 10 小时' }, batteryRuntimeReason: { value: '' }
  };
  context.batteryTemperatureReading = { get value() { return pageComputed('batteryTemperatureReading', context); } };
  const metric = () => pageComputed('batteryMetrics', context).find(item => item.label === '电池温度');
  assert.equal(metric().value, '31°C');
  context.status.value.battery_gauge.raw.temp_c = 0;
  assert.equal(metric().value, '0°C');
  context.status.value.battery_gauge.raw.temp_c = -80;
  assert.equal(metric().value, '—');
  assert.equal(metric().note, '读数异常');
  context.status.value.battery_gauge = { state: 'unavailable' };
  assert.equal(metric().value, '—');
  context.status.value = {};
  assert.equal(metric().value, '—', 'a compact gauge summary without raw temperature must not use the factory reading');
  context.battery.value.percentSource = 'router';
  assert.equal(metric().value, '45°C');
});

test('battery temperature expires with its measurement and rejects retained invalid gauge raw values', () => {
  const now = 1700000000000;
  const context = { data: { value: { timestamp: now, stale: false } }, freshnessNow: { value: now },
    battery: { value: { percentSource: 'gauge88' } }, temperature: { value: { battery_temp: 45 } }, temperatureReading,
    status: { value: { battery_gauge: { state: 'valid', validUntil: now, raw: { temp_c: 31 } } } } };
  const reading = () => pageComputed('batteryTemperatureReading', context);
  assert.equal(reading().value, 31, 'validUntil is inclusive');
  context.freshnessNow.value++;
  assert.equal(reading().value, null, 'an expired raw temperature is diagnostic only');
  context.freshnessNow.value = now;
  for (const marker of [
    { state: 'stale', validUntil: now + 5000 }, { state: 'unavailable', validUntil: now + 5000 },
    { state: 'valid' }, { state: 'valid', validUntil: 'not-a-time' }
  ]) {
    context.status.value.battery_gauge = { ...marker, raw: { temp_c: 31 } };
    assert.equal(reading().value, null);
  }
  context.status.value = {};
  context.battery.value.percentSource = 'router';
  assert.equal(reading().value, 45);
  context.data.value.timestamp = now - 5001;
  assert.equal(reading().value, null, 'factory temperature shares battery measurement expiry');
  context.data.value.timestamp = now;
  context.data.value.stale = true;
  assert.equal(reading().value, null);
});

test('complete dashboard capture metadata survives newer battery-only recovery and stale polling', async () => {
  const now = 1700000000000;
  const merge = pageFunction('mergeDashboard');
  const previous = merge({}, { timestamp: now - 60000, source: 'foreground', login: { loggedIn: true },
    signal: { network_type: 'LTE', lte_rsrp: -103 }, temperature: { wifi_chip_temp: 46 }, status: {} });
  assert.equal(previous.telemetryTimestamp, now - 60000);
  const context = { backfillingBackground: false, backgroundState: { available: true }, syncState: { role: 'direct' },
    data: { value: previous }, messages: { value: [] }, collectionSourceLabels: {}, backgroundSourceCounts: {}, backgroundBackfill: { value: '' },
    routerApi: { getBackgroundHistory: async () => ({ live: { timestamp: now, source: 'screenOff', status: {}, battery: {} } }),
      restoreBatterySummary: () => ({ measurement: { percentageSource: 'router' }, calculatedAt: now }) }, syncBackgroundState() {} };
  await pageFunction('backfillBackgroundHistory', context)();
  assert.equal(previous.timestamp, now);
  assert.equal(previous.telemetryTimestamp, now - 60000, 'battery recovery cannot refresh signal and Wi-Fi capture time');
  assert.equal(previous.telemetrySource, 'foreground');
  const display = { data: context.data, connected: { value: true }, freshnessNow: { value: now }, describeFreshness: pageFunction('describeFreshness') };
  assert.equal(pageComputed('freshness', display).state, 'stale');
  const cached = merge(previous, { stale: true, timestamp: now + 1000, source: 'lan' });
  assert.equal(cached.telemetryTimestamp, now - 60000);
  assert.equal(cached.telemetryStale, true);
  const full = merge(cached, { timestamp: now, source: 'screenOn', login: { loggedIn: true }, signal: {}, temperature: {} });
  assert.equal(full.telemetryTimestamp, now);
  assert.equal(full.telemetrySource, 'screenOn');
  assert.equal(full.telemetryStale, false);
  assert.deepEqual(Object.keys(full.signal), []);
  assert.deepEqual(Object.keys(full.temperature), []);
});

test('background recovery replaces the complete battery summary and prefers a newer foreground measurement', async () => {
  const current = { timestamp: 3000, battery: { runtime: { minutes: 120 }, measurement: { rawSoc: 40 } } };
  const native = { timestamp: 2000, battery: { currentStats: [{ blockId: 'native-live' }] } };
  const archive = [{ timestamp: 1000, percent: 41, currentStats: { blockId: 'native-archive' } }];
  const replacement = { samples: archive, measurement: { rawSoc: 40 }, runtime: { minutes: 100 }, calculatedAt: 3000 };
  const calls = [];
  const context = {
    backfillingBackground: false, backgroundState: { available: true }, syncState: { role: 'direct' },
    data: { value: current }, messages: { value: [] }, collectionSourceLabels: {}, backgroundSourceCounts: {}, backgroundBackfill: { value: '' },
    routerApi: { getBackgroundHistory: async () => ({ live: native, battery: archive }), mergeExternalBattery: () => archive,
      restoreBatterySummary(snapshot, stats) { calls.push({ snapshot, stats }); return replacement; } }, syncBackgroundState() {}
  };
  const recover = pageFunction('backfillBackgroundHistory', context);
  await recover();
  assert.equal(calls[0].snapshot, current);
  assert.equal(calls[0].stats, native.battery.currentStats);
  assert.equal(context.data.value.battery, replacement, 'recovery must replace measurement/results as well as samples');
  context.data.value = { timestamp: 1000, battery: {} };
  await recover();
  assert.equal(calls[1].snapshot, native);
  context.syncState.role = 'viewer';
  const collectorRuntime = { minutes: 123.456, state: 'estimated' };
  context.data.value = { timestamp: 3000, battery: { runtime: collectorRuntime } };
  await recover();
  assert.equal(calls.length, 2, 'a LAN viewer must never recompute the collector result from native history');
  assert.equal(context.data.value.battery.runtime, collectorRuntime);
  assert.equal(context.data.value.battery.samples, archive);
});

test('validated newer native battery recovery updates SOC and freshness together without importing unrelated status', async () => {
  const now = 1700000000000;
  const previous = { timestamp: now - 60000, stale: true, source: 'foreground',
    status: { network_type: 'LTE', battery_vol_percent: '10', battery_gauge: { state: 'valid', percent: 10 } }, battery: {} };
  const marker = { state: 'valid', percent: 50, validUntil: now + 5000, raw: { soc: 50, temp_c: 31 } };
  const native = { timestamp: now, stale: false, source: 'screenOff',
    status: { network_type: 'untrusted-native-network', battery_gauge: marker }, battery: {} };
  let restored = { percent: 50, percentSource: 'gauge88', measurement: { percentageSource: 'gauge88', rawSoc: 50 },
    calculatedAt: now, runtime: { state: 'estimated', minutes: 600 } };
  const context = { backfillingBackground: false, backgroundState: { available: true }, syncState: { role: 'direct' },
    data: { value: previous }, messages: { value: [] }, collectionSourceLabels: {}, backgroundSourceCounts: {}, backgroundBackfill: { value: '' },
    routerApi: { getBackgroundHistory: async () => ({ live: native }), restoreBatterySummary: () => restored }, syncBackgroundState() {} };
  const recover = pageFunction('backfillBackgroundHistory', context);
  await recover();
  assert.equal(context.data.value.timestamp, now);
  assert.equal(context.data.value.stale, false);
  assert.equal(context.data.value.source, 'screenOff');
  assert.equal(context.data.value.status.network_type, 'LTE');
  assert.equal(context.data.value.status.battery_gauge, marker);
  const display = { data: context.data, freshnessNow: { value: now },
    battery: { get value() { return context.data.value.battery; } }, status: { get value() { return context.data.value.status; } }, numeric, firstValue };
  assert.equal(pageComputed('batteryPercentText', display), '50.00%');
  assert.equal(pageFunction('batteryTimeResult', display)('runtime').minutes, 600);
  const savedStatus = context.data.value.status;
  native.timestamp = now + 1000;
  restored = { measurement: null, runtime: { state: 'unavailable', minutes: null } };
  await recover();
  assert.equal(context.data.value.timestamp, now, 'invalid native measurement cannot refresh metadata');
  assert.equal(context.data.value.status, savedStatus);
  restored = { measurement: { percentageSource: 'router', rawSoc: 60 }, percent: 60, calculatedAt: now + 1000 };
  native.status = { network_type: 'untrusted-native-network', battery_vol_percent: '60', battery_charging: '0' };
  await recover();
  assert.equal(Object.hasOwn(context.data.value.status, 'battery_gauge'), false, 'factory recovery must clear the previous gauge source');
  assert.equal(pageComputed('batteryPercentText', display), '60.00%');
  assert.equal(context.data.value.status.network_type, 'LTE');
});

test('battery collection resets at native ownership boundaries and page hide while viewers remain passive', () => {
  let resets = 0;
  const context = { syncState: { role: 'direct' }, backgroundState: { background: false },
    routerApi: { getBackgroundMonitorState: () => ({ background: true }), getBatteryOptimizationState: () => ({}),
      resetBatteryCollection() { resets++; } } };
  const update = pageFunction('syncBackgroundState', context);
  const hide = pageFunction('handlePageHide', context);
  update();
  assert.equal(resets, 1);
  update();
  assert.equal(resets, 1, 'unchanged background state must not interrupt the current window');
  hide();
  assert.equal(resets, 2);
  context.syncState.role = 'viewer';
  context.backgroundState.background = false;
  update(); hide();
  assert.equal(resets, 2);
});

test('automatic polling stays quiet while manual refresh shows progress and clears on failure', async () => {
  const create = () => {
    let finish;
    const context = {
      refreshing: { value: false }, manualRefreshing: { value: false }, actionBusy: { value: false },
      pendingRefresh: false, pendingManualRefresh: false,
      data: { value: {} }, errorMessage: { value: '' }, freshnessNow: { value: 0 },
      syncClient: { dashboard: () => new Promise((resolve, reject) => { finish = { resolve, reject }; }), afterTick: async () => {} },
      mergeDashboard: (_current, payload) => payload, applyDashboardData: Object.assign,
      updateCellDisplay() {}, syncTrafficPlanForm() {}, captureHistory() {}, applyInitialBands() {}, syncCandidate() {}, refreshSyncState() {},
      uni: { showToast() {} }, setTimeout() {},
    };
    return { context, refresh: pageFunction('refresh', context), complete: (failed = false) => failed ? finish.reject(Error('offline')) : finish.resolve({ timestamp: 1 }) };
  };
  const automatic = create();
  const poll = automatic.refresh();
  assert.equal(automatic.context.refreshing.value, true);
  assert.equal(automatic.context.manualRefreshing.value, false);
  automatic.complete(); await poll;
  const manual = create();
  const request = manual.refresh(true);
  assert.equal(manual.context.manualRefreshing.value, true);
  manual.complete(true); await request;
  assert.equal(manual.context.manualRefreshing.value, false);
  assert.equal(manual.context.refreshing.value, false);
  assert.equal(manual.context.errorMessage.value, 'offline');
  assert.equal(manual.context.data.value.telemetryStale, true);
  const queued = create();
  const background = queued.refresh();
  await queued.refresh(true);
  assert.equal(queued.context.pendingManualRefresh, true, 'a tap during polling must keep manual intent');
  queued.complete(); await background;
});
