import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importBatteryProfileClient } from './helpers/battery-profile-client.mjs';

const T = 1800000000000;
const csv = 'ts,ts_iso,soc,voltage_mv,current_ma,power_w,temp_c,status\n' +
  Array.from({ length: 61 }, (_, i) => `${1000 + i * 60},,${55 - i / 12},4000,-400,-1.6,31,Discharging`).join('\n');

async function createClient(mode, stored = {}, history = []) {
  const storage = new Map([['mu5120-config', { routerUrl: 'http://router.test', ...stored }], ['mu5120-battery-history', history]]);
  const requests = [];
  const snapshots = [];
  const log = { text: csv, error: null };
  const fields = { loginfo: 'ok', battery_vol_percent: '50', battery_charging: '0', battery_temp: '35',
    battery_current: '123', battery_voltage: '4010', battery_capacity: '9800', external_charging_flag: '0' };
  const state = { ts: 4600, soc: 50, data_quality: 'ok', status: 'Discharging', current_ma: -400,
    voltage_mv: 4000, power_w: -1.6, temp_c: 31, sample_mono_s: 4000 };
  globalThis.uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) };
  globalThis.window = { AndroidRouter: {
    updateBackgroundSnapshot(raw) { snapshots.push(JSON.parse(raw)); },
    request(id, raw) {
      const payload = JSON.parse(raw);
      requests.push(payload);
      const url = new URL(payload.url);
      const cmd = url.searchParams.get('cmd') || '';
      if (url.pathname === '/backup/battery-log.csv' && log.error) {
        queueMicrotask(() => window.__mu5120NativeResponse(id, JSON.stringify({ ok: false, status: 503, error: log.error })));
        return;
      }
      const body = url.pathname === '/state.json' ? JSON.stringify(state)
        : url.pathname === '/backup/battery-log.csv' ? log.text
          : JSON.stringify(['station_list', 'lan_station_list'].includes(cmd) ? { [cmd]: [] }
            : Object.fromEntries(cmd.split(',').map(key => [key, fields[key] ?? ''])));
      queueMicrotask(() => window.__mu5120NativeResponse(id, JSON.stringify({ ok: true, status: 200, body, headers: { 'X-Gauge-Age': '0' } })));
    }
  } };
  return { api: (await importBatteryProfileClient(mode)).routerApi, storage, requests, snapshots, fields, state, log };
}

async function nativeCsvSnapshot(client, capturedAt, { calculatedAt = capturedAt, dropPerHour = 5 } = {}) {
  const { batteryGaugeReading, normalizeBatteryMeasurement } = await import('../src/utils/battery-gauge.js');
  const { parseBatteryCsv, estimateCsvBatteryTimes } = await import('../src/utils/battery-csv.js');
  const marker = batteryGaugeReading(client.state, { 'X-Gauge-Age': '0' }, 'http://router.test:88/state.json', capturedAt);
  const measurement = normalizeBatteryMeasurement({ battery_gauge: marker });
  const nativeCsv = 'ts,ts_iso,soc,voltage_mv,current_ma,power_w,temp_c,status\n' +
    Array.from({ length: 61 }, (_, i) => `${client.state.ts - 3600 + i * 60},,${client.state.soc + dropPerHour * (60 - i) / 60},4000,-400,-1.6,31,Discharging`).join('\n');
  const estimates = estimateCsvBatteryTimes({ csv: parseBatteryCsv(nativeCsv), measurement,
    deviceNowSeconds: client.state.ts, calculatedAt });
  return { timestamp: capturedAt, status: { battery_gauge: marker }, battery: {
    ...estimates, measurement, csvAnalysis: { ...estimates.csvAnalysis, source: 'device-csv',
      url: 'http://router.test:88/backup/battery-log.csv', fetchedAt: calculatedAt },
    remainingHours: estimates.runtime.minutes / 60
  } };
}

test('gauge build overrides saved source and port and immediately estimates from device CSV without app history', async () => {
  const realNow = Date.now;
  Date.now = () => T;
  try {
    const client = await createClient('gauge88-csv', { batterySource: 'factory', batteryPort: 188 });
    const result = await client.api.dashboard();
    assert.equal(result.battery.runtime.minutes, 600);
    assert.equal(result.battery.runtime.method, 'device-csv');
    assert.equal(result.battery.csvAnalysis.state, 'ready');
    assert.equal(client.api.getConfig().batterySource, 'gauge');
    assert.equal(client.api.getConfig().batteryPort, 88);
    assert.equal(client.api.getConfig().batteryProfile, 'gauge88-csv');
    assert.equal(client.requests.filter(item => new URL(item.url).pathname === '/backup/battery-log.csv').length, 1);
    assert.equal(client.requests.filter(item => new URL(item.url).pathname === '/state.json')[0].headers.Cookie, undefined);
    assert.equal(result.battery.samples.length, 1, 'device CSV stays separate from local monitoring history');
    assert.equal(client.snapshots.at(-1).battery.csvAnalysis.state, 'ready');
    assert.equal(client.snapshots.at(-1).battery.samples, undefined);
    const forced = client.api.updateConfig({ batterySource: 'factory', batteryPort: 'not-a-port' });
    assert.equal(forced.batterySource, 'gauge');
    assert.equal(forced.batteryPort, 88);
    const restored = client.api.restoreBatterySummary(result);
    assert.equal(restored.runtime.minutes, 600);
    assert.equal(restored.csvAnalysis.state, 'ready');
  } finally { Date.now = realNow; }
});

test('bad CSV and later fetch failure stay unavailable despite complete local current/SOC history', async () => {
  const realNow = Date.now;
  let now = T;
  Date.now = () => now;
  try {
    const client = await createClient('gauge88-csv');
    client.log.text = 'unrecognized,header\n1,2';
    const bad = await client.api.dashboard();
    assert.equal(bad.battery.runtime.minutes, null);
    assert.equal(bad.battery.csvAnalysis.reason, 'invalid-csv');
    for (let second = 1; second <= 59; second++) {
      now = T + second * 1000;
      client.state.ts = 4600 + second;
      client.state.sample_mono_s = 4000 + second;
      await client.api.dashboard();
    }
    assert.equal(client.requests.filter(item => new URL(item.url).pathname === '/backup/battery-log.csv').length, 1);
    client.log.text = csv;
    now = T + 60000; client.state.ts = 4660; client.state.sample_mono_s = 4060;
    const recovered = await client.api.dashboard();
    assert.equal(recovered.battery.runtime.minutes, 600);
    client.log.error = 'offline';
    now = T + 120000; client.state.ts = 4720; client.state.sample_mono_s = 4120;
    const failed = await client.api.dashboard();
    assert.ok(failed.battery.currentWindow.observedDurationMs >= 60000, 'the app has enough current coverage for its former estimator');
    assert.equal(failed.battery.runtime.minutes, null);
    assert.equal(failed.battery.csvAnalysis.reason, 'fetch-error');
  } finally { Date.now = realNow; }
});

test('fresh native CSV summaries survive handoff but cannot replace a different live measurement', async () => {
  const realNow = Date.now;
  Date.now = () => T;
  try {
    const client = await createClient('gauge88-csv');
    const { batteryGaugeReading, normalizeBatteryMeasurement } = await import('../src/utils/battery-gauge.js');
    const marker = batteryGaugeReading(client.state, { 'X-Gauge-Age': '0' }, 'http://router.test:88/state.json', T);
    const measurement = normalizeBatteryMeasurement({ battery_gauge: marker });
    const snapshot = { timestamp: T, status: { battery_gauge: marker }, battery: {
      measurement, calculatedAt: T, windowSeconds: 3600,
      csvAnalysis: { source: 'device-csv', state: 'ready', points: 61 },
      runtime: { state: 'estimated', minutes: 600, method: 'device-csv', targetPercent: 0 },
      timeToFull: { state: 'not-applicable', minutes: null, targetPercent: 100 }, remainingHours: 10
    } };
    assert.equal(client.api.restoreBatterySummary(snapshot).runtime.minutes, 600);
    const other = { ...snapshot, status: { battery_gauge: { ...marker, raw: { ...marker.raw, soc: 49 } } } };
    assert.equal(client.api.restoreBatterySummary(other).runtime.minutes, null);
    assert.equal(client.requests.length, 0, 'handoff remains synchronous and keeps device history separate');
  } finally { Date.now = realNow; }
});

for (const localState of ['failed', 'stale', 'insufficient']) {
  test(`a fresh matching native CSV estimate replaces a retained ${localState} foreground analysis`, async () => {
    const realNow = Date.now;
    let now = T;
    Date.now = () => now;
    try {
      const client = await createClient('gauge88-csv');
      if (localState === 'failed') client.log.text = 'bad,header\n1,2';
      if (localState === 'insufficient') client.log.text = csv.split('\n').slice(0, 1).concat(csv.split('\n').slice(-5)).join('\n');
      const foreground = await client.api.dashboard();
      if (localState === 'stale') {
        assert.equal(foreground.battery.runtime.minutes, 600);
        now += 180000;
        client.state.ts += 180;
        client.state.sample_mono_s += 180;
      } else now += 2000;
      const native = await nativeCsvSnapshot(client, now);
      assert.equal(native.battery.runtime.minutes, 600);
      const requestsBeforeRestore = client.requests.length;
      const restored = client.api.restoreBatterySummary(native);
      assert.equal(restored.runtime.minutes, 600);
      assert.equal(restored.csvAnalysis.state, 'ready');
      assert.equal(restored.csvAnalysis.fetchedAt, now, 'native provenance stays with the selected native calculation');
      assert.equal(restored.calculatedAt, now);
      assert.equal(client.requests.length, requestsBeforeRestore, 'recovery uses the available collector result synchronously');
      assert.deepEqual(restored.measurement, native.battery.measurement);
    } finally { Date.now = realNow; }
  });
}

test('retained failed CSV never accepts a stale, future, mismatched, or unusable native estimate', async () => {
  const realNow = Date.now;
  let now = T;
  Date.now = () => now;
  try {
    const client = await createClient('gauge88-csv');
    client.log.text = 'bad,header\n1,2';
    await client.api.dashboard();
    now += 2000;
    const good = await nativeCsvSnapshot(client, now);
    const rejected = [
      { ...good, battery: { ...good.battery, calculatedAt: now - 5001 } },
      { ...good, battery: { ...good.battery, calculatedAt: now + 1 } },
      { ...good, battery: { ...good.battery, measurement: { ...good.battery.measurement, rawSoc: 49 } } },
      { ...good, battery: { ...good.battery, measurement: { ...good.battery.measurement, endpoint: 'http://other.test:88/state.json' } } },
      { ...good, battery: { ...good.battery, csvAnalysis: { ...good.battery.csvAnalysis, state: 'unavailable', reason: 'stale' } } }
    ];
    for (const snapshot of rejected) {
      const restored = client.api.restoreBatterySummary(snapshot);
      assert.equal(restored.runtime.minutes, null);
      assert.equal(restored.csvAnalysis.reason, 'invalid-csv');
    }
  } finally { Date.now = realNow; }
});

test('a valid current foreground CSV analysis keeps precedence over an older native calculation', async () => {
  const realNow = Date.now;
  Date.now = () => T;
  try {
    const client = await createClient('gauge88-csv');
    const foreground = await client.api.dashboard();
    assert.equal(foreground.battery.runtime.minutes, 600);
    const native = await nativeCsvSnapshot(client, T, { calculatedAt: T - 4000, dropPerHour: 10 });
    assert.equal(native.battery.runtime.minutes, 300);
    const restored = client.api.restoreBatterySummary(native);
    assert.equal(restored.runtime.minutes, 600);
    assert.equal(restored.csvAnalysis.fetchedAt, T);
    assert.equal(restored.calculatedAt, T);
  } finally { Date.now = realNow; }
});

test('factory build ignores gauge settings/history and preserves the original 24 hour endpoint SOC slope', async () => {
  const realNow = Date.now;
  Date.now = () => T;
  try {
    const history = [
      { timestamp: T - 6 * 3600000, percent: 80, charging: false },
      { timestamp: T - 5 * 3600000, percent: 5, charging: true, percentSource: 'gauge88' },
      { timestamp: T - 60000, percent: 50.1, charging: false }
    ];
    const client = await createClient('factory', { batterySource: 'gauge', batteryPort: 188 }, history);
    const result = await client.api.dashboard();
    assert.equal(result.battery.runtime.minutes, 600);
    assert.equal(result.battery.ratePerHour, 5);
    assert.equal(result.battery.samples.at(-1).current, '123');
    assert.equal(result.battery.samples.at(-1).voltage, '4010');
    assert.equal(client.api.getConfig().batterySource, 'factory');
    assert.equal(client.api.updateConfig({ batterySource: 'gauge' }).batterySource, 'factory');
    assert.equal(client.requests.some(item => new URL(item.url).port === '88'), false);
    assert.equal(client.requests.some(item => ['/state.json', '/backup/battery-log.csv'].includes(new URL(item.url).pathname)), false);
  } finally { Date.now = realNow; }
});

test('factory external-power flag keeps legacy charging semantics even when battery_charging is zero', async () => {
  const realNow = Date.now;
  Date.now = () => T;
  try {
    const client = await createClient('factory', {}, [
      { timestamp: T - 3600000, percent: 45, charging: true },
      { timestamp: T - 60000, percent: 49.9, charging: true }
    ]);
    client.fields.external_charging_flag = '1';
    const result = await client.api.dashboard();
    assert.equal(result.battery.charging, true);
    assert.equal(result.battery.timeToFull.minutes, 600);
    assert.equal(result.battery.runtime.minutes, null);
    assert.equal(result.battery.measurement.mode, 'charging');
  } finally { Date.now = realNow; }
});
