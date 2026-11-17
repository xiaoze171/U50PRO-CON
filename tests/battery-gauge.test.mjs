import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import * as batteryGauge from '../src/utils/battery-gauge.js';
import { importBatteryProfileClient } from './helpers/battery-profile-client.mjs';

test('gauge age header fixes expiry at capture and later checks cannot renew it', () => {
  const capturedAt = 1700000000000;
  const raw = { soc: 45, data_quality: 'ok', ts: capturedAt / 1000 + 28800 };
  const marker = batteryGauge.batteryGaugeReading(raw, { 'X-Gauge-Age': '4' }, 'http://fixture.invalid:88/state.json', capturedAt);
  assert.equal(marker.state, 'valid');
  assert.equal(marker.capturedAt, capturedAt);
  assert.equal(marker.validUntil, capturedAt + 1000);
  assert.equal(typeof batteryGauge.freshBatteryGaugeReading, 'function');
  assert.equal(batteryGauge.freshBatteryGaugeReading(marker, capturedAt + 1000), marker, 'exact expiry is still valid');
  const stale = batteryGauge.freshBatteryGaugeReading(marker, capturedAt + 2000);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.percent, null);
  assert.equal(stale.validUntil, capturedAt + 1000);
  assert.equal(stale.raw, raw);
  assert.equal(marker.state, 'valid', 'validation does not mutate an archived marker');
  assert.equal(batteryGauge.normalizeBatteryMeasurement({ battery_gauge: stale, battery_vol_percent: 80 }), null);
});

test('device timestamps never establish live freshness without a relative age header', () => {
  const capturedAt = 1700000000123;
  for (const offset of [0, -28800, 28800]) {
    const raw = { soc: 0, data_quality: 'ok', ts: capturedAt / 1000 + offset };
    const marker = batteryGauge.batteryGaugeReading(raw, {}, '', capturedAt);
    assert.equal(marker.percent, null);
    assert.equal(marker.state, 'unavailable');
    assert.equal(marker.validUntil, null);
    const valid = batteryGauge.batteryGaugeReading(raw, { 'x-gauge-age': '4' }, '', capturedAt);
    assert.equal(valid.percent, 0);
    assert.equal(valid.validUntil, capturedAt + 1000);
    assert.equal(batteryGauge.freshBatteryGaugeReading(valid, capturedAt + 1001).state, 'stale');
    assert.equal(batteryGauge.batteryGaugeReading(raw, { 'x-gauge-age': 'broken' }, '', capturedAt).state, 'stale');
  }
});

test('freshness checks preserve legacy and already invalid markers', () => {
  const legacy = { state: 'valid', percent: 50 };
  const invalid = { state: 'unavailable', percent: null, validUntil: 1 };
  assert.equal(typeof batteryGauge.freshBatteryGaugeReading, 'function');
  assert.equal(batteryGauge.freshBatteryGaugeReading(legacy, 10000), legacy);
  assert.equal(batteryGauge.freshBatteryGaugeReading(invalid, 10000), invalid);
  assert.equal(batteryGauge.freshBatteryGaugeReading(null, 10000), null);
});

const measurementFixtures = JSON.parse(readFileSync(new URL('./fixtures/battery-estimate-cases.json', import.meta.url), 'utf8'));
for (const fixture of measurementFixtures.measurementCases) {
  test(`normalized measurement: ${fixture.name}`, () => {
    assert.equal(typeof batteryGauge.normalizeBatteryMeasurement, 'function');
    const actual = batteryGauge.normalizeBatteryMeasurement(fixture.status);
    if (fixture.expected === null) assert.equal(actual, null);
    else for (const [key, value] of Object.entries(fixture.expected)) assert.deepEqual(actual[key], value, key);
  });
}

test('factory normalized SOC rejects malformed strings without changing the legacy display API', () => {
  assert.equal(batteryGauge.normalizeBatteryMeasurement({ battery_vol_percent: '50junk' }), null);
  assert.equal(batteryGauge.normalizeBatteryMeasurement({ battery_vol_percent: '' }), null);
  assert.equal(batteryGauge.normalizeBatteryMeasurement({ battery_vol_percent: null }), null);
});

test('measurement sanitizer replaces nullable fields atomically and rejects wrong versions', () => {
  const normalized = batteryGauge.sanitizeBatteryMeasurement({ ...measurementFixtures.measurementCases[0].expected,
    netCurrentMa: '400', usableCapacityMah: 0, fullStableSeconds: -1, sampleMonoSeconds: null });
  assert.equal(normalized.netCurrentMa, null);
  assert.equal(normalized.usableCapacityMah, null);
  assert.equal(normalized.fullStableSeconds, null);
  assert.equal(normalized.sampleMonoSeconds, null);
  assert.equal(batteryGauge.sanitizeBatteryMeasurement({ schemaVersion: 1, rawSoc: 50 }), null);
});

const now = Date.now();
const storage = new Map([
  ['mu5120-config', { routerUrl: 'http://192.168.0.1:9461' }],
  ['mu5120-battery-history', [
    { timestamp: now - 1200000, percent: 80, charging: false },
    { timestamp: now - 600000, percent: 50, charging: false }
  ]]
]);
let gauge = { soc: 22.6088, data_quality: 'ok', ts: now / 1000 + 28800, status: 'Discharging', full_confirmed: false };
let age = '0.890';
let failed = false;
const gaugeUrls = [];
const backgroundConfigs = [];
let clearedSessions = 0;
globalThis.uni = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value)
};
globalThis.window = { AndroidRouter: {
  configureBackground(routerUrl, password, settings) { backgroundConfigs.push(JSON.parse(settings || '{}')); },
  clearSession() { clearedSessions++; },
  request(id, raw) {
    const input = JSON.parse(raw), url = new URL(input.url);
    let response;
    if (url.pathname === '/state.json') {
      gaugeUrls.push(url);
      response = failed ? { ok: false, status: 503 } : {
        ok: true, status: 200, body: JSON.stringify(gauge),
        headers: age === undefined ? {} : { 'X-Gauge-Age': age }
      };
    } else {
      const cmd = url.searchParams.get('cmd');
      const fixtures = { loginfo: 'ok', battery_vol_percent: '50', battery_value: '50', battery_charging: '0', battery_temp: '32' };
      const body = cmd === 'station_list' || cmd === 'lan_station_list' ? { [cmd]: [] }
        : Object.fromEntries((cmd || '').split(',').map(key => [key, fixtures[key] ?? '']));
      response = { ok: true, status: 200, body: JSON.stringify(body) };
    }
    queueMicrotask(() => window.__mu5120NativeResponse(id, JSON.stringify(response)));
  }
} };
const { routerApi } = await importBatteryProfileClient('gauge88-csv');

test('port 88 SOC replaces the locked factory percentage and never mixes old percentages into runtime estimates', async () => {
  const result = await routerApi.dashboard();
  assert.equal(result.battery.percent, 22.61);
  assert.equal(result.status.battery_vol_percent, '50', 'keep factory raw diagnostics');
  assert.equal(gaugeUrls.at(-1).origin, 'http://192.168.0.1:88');
  assert.equal(gaugeUrls.at(-1).pathname, '/state.json');
  assert.equal(result.battery.samples.at(-1).percent, 22.61);
  assert.equal(result.battery.samples.at(-1).percentSource, 'gauge88');
  assert.equal(result.battery.ratePerHour, null);
  assert.equal(result.battery.remainingHours, null);
  assert.equal(result.status.battery_gauge.raw.soc, 22.6088);
});

test('unavailable, old or malformed gauge data never falls back to factory percentage or creates samples', async () => {
  const count = routerApi.getBatteryHistory().length;
  for (const scenario of [
    { failed: true, state: 'unavailable' },
    { age: '5.001', state: 'stale' },
    { age: '-1', state: 'stale' },
    { age: 'broken', state: 'stale' },
    { soc: null, state: 'invalid' },
    { soc: '22.6', state: 'invalid' },
    { soc: 101, state: 'invalid' },
    { soc: -1, state: 'invalid' },
    { quality: 'error', state: 'invalid' }
  ]) {
    failed = scenario.failed || false;
    age = scenario.age ?? '0.2';
    gauge = { soc: Object.hasOwn(scenario, 'soc') ? scenario.soc : 22.6, data_quality: scenario.quality || 'ok', ts: now / 1000 };
    const result = await routerApi.dashboard();
    assert.equal(result.battery.percent, null, JSON.stringify(scenario));
    assert.equal(result.status.battery_gauge.state, scenario.state);
    assert.equal(result.battery.remainingHours, null);
    assert.equal(result.battery.samples.length, count);
  }
});

test('fresh gauge zero is a real measurement and unconfirmed full charging remains below 100', async () => {
  failed = false;
  age = '0';
  gauge = { soc: 0, data_quality: 'ok', ts: Date.now() / 1000, status: 'Discharging' };
  assert.equal((await routerApi.dashboard()).battery.percent, 0);
  age = '0';
  gauge = { soc: 100, data_quality: 'ok', status: 'Full', full_confirmed: false };
  assert.equal((await routerApi.dashboard()).battery.percent, 99.99);
  gauge.full_confirmed = true;
  assert.equal((await routerApi.dashboard()).battery.percent, 100);
});

test('battery display uses a native gauge snapshot and does not resurrect the factory value when the gauge fails', () => {
  const script = readFileSync(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8').split('<script setup>')[1].split('</script>')[0];
  const ast = parse(script, { sourceType: 'module' });
  const callback = ast.program.body.flatMap(item => item.declarations || []).find(item => item.id.name === 'batteryPercentText').init.arguments[0];
  const source = `(${script.slice(callback.start, callback.end)})()`;
  const render = gaugeValue => runInNewContext(source, {
    battery: { value: {} }, status: { value: { battery_vol_percent: 50, battery_gauge: gaugeValue } },
    numeric: value => Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : null,
    firstValue: (...values) => values.find(value => value != null && value !== '')
  });
  assert.equal(render({ percent: 22.61, state: 'valid' }), '22.61%');
  assert.equal(render({ percent: null, state: 'unavailable' }), '—');
  assert.equal(render({ percent: 0, state: 'valid' }), '0.00%');
  assert.equal(render({ percent: 50, state: 'valid' }), '50.00%');
});

test('factory profile skips the gauge and saved settings cannot override the effective source', async () => {
  const before = gaugeUrls.length;
  const factoryApi = (await importBatteryProfileClient('factory')).routerApi;
  const config = factoryApi.updateConfig({ batterySource: 'gauge' });
  assert.equal(config.batterySource, 'factory');
  assert.equal(clearedSessions, 0);
  assert.equal(backgroundConfigs.at(-1).batterySource, 'factory');
  const result = await factoryApi.dashboard();
  assert.equal(result.battery.percent, 50);
  assert.equal(result.battery.percentSource, 'router');
  assert.equal(Object.hasOwn(result.status, 'battery_gauge'), false);
  assert.equal(gaugeUrls.length, before);
  assert.equal(result.battery.measurement.percentageSource, 'router');
  delete window.__mu5120NativeResponse;
});

test('custom host survives reload while branch source and port override saved settings', async () => {
  gauge = { soc: 24, data_quality: 'ok', status: 'Discharging' };
  age = '0';
  const config = routerApi.updateConfig({ batterySource: 'gauge', batteryHost: ' 192.168.1.2 ', batteryPort: '8088' });
  assert.equal(config.batteryHost, '192.168.1.2');
  assert.equal(config.batterySource, 'gauge');
  assert.equal(config.batteryPort, 88);
  const result = await routerApi.dashboard();
  assert.equal(gaugeUrls.at(-1).origin, 'http://192.168.1.2:88');
  assert.equal(result.battery.percentEndpoint, 'http://192.168.1.2:88/state.json');
  storage.set('mu5120-config', { ...storage.get('mu5120-config'), batteryPort: 188, batterySource: 'factory' });
  const reloaded = (await importBatteryProfileClient('gauge88-csv')).routerApi;
  assert.equal(reloaded.getConfig().batteryHost, '192.168.1.2');
  assert.equal(reloaded.getConfig().batterySource, 'gauge');
  assert.equal(reloaded.getConfig().batteryPort, 88);
  const old = Date.now() - 1200000;
  routerApi.mergeExternalBattery([
    { timestamp: old, percent: 80, charging: false, percentSource: 'gauge88', percentEndpoint: 'http://192.168.1.2:88/state.json' },
    { timestamp: old + 600000, percent: 60, charging: false, percentSource: 'gauge88', percentEndpoint: 'http://192.168.1.2:88/state.json' }
  ]);
  routerApi.updateConfig({ batteryHost: '' });
  const switched = await routerApi.dashboard();
  assert.equal(gaugeUrls.at(-1).origin, 'http://192.168.0.1:88');
  assert.equal(switched.battery.remainingHours, null);
  assert.equal(switched.battery.ratePerHour, null);
  assert.equal(switched.battery.samples.at(-1).percentEndpoint, 'http://192.168.0.1:88/state.json');
});

test('invalid gauge settings are rejected without changing saved or background configuration', () => {
  const saved = JSON.stringify(storage.get('mu5120-config'));
  const synced = backgroundConfigs.length;
  for (const batteryPort of ['', '0', '-1', '65536', '88.5', '88abc']) {
    assert.throws(() => batteryGauge.normalizeBatteryConfig({ batteryPort }), /端口/);
  }
  for (const batteryHost of ['http://192.168.1.2', '192.168.1.2:88', '192.168.1.2/state.json', 'user@192.168.1.2', '999.999.999.999', 'a b']) {
    assert.throws(() => routerApi.updateConfig({ batteryHost }), /IP|地址/);
  }
  assert.throws(() => batteryGauge.normalizeBatteryConfig({ batterySource: 'soc' }), /来源/);
  assert.equal(JSON.stringify(storage.get('mu5120-config')), saved);
  assert.equal(backgroundConfigs.length, synced);
  assert.equal(routerApi.updateConfig({ batterySource: 'soc', batteryPort: 'broken' }).batteryPort, 88);
});

test('merging history keeps source transitions inside the same minute', async () => {
  const { mergeBatterySamples } = await import('../src/utils/history.js');
  const timestamp = Math.floor(Date.now() / 60000) * 60000;
  const samples = mergeBatterySamples([[
    { timestamp, percent: 50, charging: false },
    { timestamp: timestamp + 1, percent: 22, charging: false, percentSource: 'gauge88', percentEndpoint: 'http://192.168.0.1:88/state.json' },
    { timestamp: timestamp + 2, percent: 80, charging: false, percentSource: 'gauge88', percentEndpoint: 'http://192.168.1.2:88/state.json' }
  ]]);
  assert.equal(samples.length, 3);
  assert.deepEqual(samples.map(sample => sample.percent), [50, 22, 80]);
});
