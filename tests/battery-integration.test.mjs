import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importBatteryProfileClient } from './helpers/battery-profile-client.mjs';

let now = 1800000000000;
const realNow = Date.now;
let gauge = {};
let unavailable = false;
let factoryPercent = 80;
let writes = 0;
let csvResponseDelayMs = 0;
const storage = new Map([['mu5120-config', { routerUrl: 'http://router.test', batterySource: 'gauge' }]]);
const snapshots = [];
globalThis.uni = { getStorageSync: key => storage.get(key), setStorageSync(key, value) {
  storage.set(key, value); if (key === 'mu5120-battery-history') writes++;
} };
globalThis.window = { AndroidRouter: {
  updateBackgroundSnapshot(raw) { snapshots.push(JSON.parse(raw)); },
  request(id, raw) {
    const url = new URL(JSON.parse(raw).url);
    const fields = { loginfo: 'ok', battery_charging: '0', battery_vol_percent: String(factoryPercent),
      battery_temp: '45', battery_current: '999999', battery_voltage: '999999', battery_capacity: '999999' };
    const cmd = url.searchParams.get('cmd') || '';
    const csv = url.pathname === '/backup/battery-log.csv';
    const body = csv ? 'ts,ts_iso,soc,voltage_mv,current_ma,power_w,temp_c,status\n' +
      Array.from({ length: 61 }, (_, i) => `${gauge.ts - 3600 + i * 60},,${gauge.soc + (60 - i) / 12},4000,-400,-1.6,31,Discharging`).join('\n')
      : url.pathname === '/state.json' ? gauge
      : ['station_list', 'lan_station_list'].includes(cmd) ? { [cmd]: [] }
        : Object.fromEntries(cmd.split(',').map(key => [key, fields[key] ?? '']));
    const response = unavailable && url.pathname === '/state.json' ? { ok: false, status: 503 }
      : { ok: true, status: 200, headers: { 'X-Gauge-Age': '0' }, body: csv ? body : JSON.stringify(body) };
    const reply = () => window.__mu5120NativeResponse(id, JSON.stringify(response));
    if (csv && csvResponseDelayMs > 0) setImmediate(() => { now += csvResponseDelayMs; reply(); });
    else queueMicrotask(reply);
  }
} };
const { routerApi } = await importBatteryProfileClient('gauge88-csv');

function configure(seconds = 0, extra = {}) {
  now = 1800000000000 + seconds * 1000;
  gauge = { ts: 4600 + seconds, soc: 50, status: 'Discharging', current_ma: -400, capacity_mah_used: 8000,
    capacity_basis: 'fixture', boot_id: 'integration-boot', sample_mono_s: 4000 + seconds,
    voltage_mv: 4000, power_w: -1.6, temp_c: 31, data_quality: 'ok', usb_online: 1,
    full_confirmed: false, full_anchor_valid: true, full_anchor_ts: 100, ...extra };
}

test('88 foreground keeps same-source current statistics and compact diagnostics without writing phone history', async () => {
  Date.now = () => now;
  try {
    configure();
    const first = await routerApi.dashboard();
    assert.equal(first.battery.measurement.netCurrentMa, -400);
    assert.equal(first.battery.charging, false, 'factory charging must not override custom discharge');
    assert.equal(first.battery.samples.at(-1).temperature, 31);
    assert.equal(first.battery.samples.at(-1).current, -400);
    const initialWrites = writes;
    assert.equal(initialWrites, 0, 'the first foreground reading must not archive battery history');
    let result;
    for (let second = 1; second <= 60; second++) {
      configure(second);
      result = await routerApi.dashboard();
    }
    assert.equal(result.battery.runtime.minutes, 600);
    assert.equal(result.battery.timeToFull.minutes, null);
    assert.equal(result.battery.currentWindow.observedDurationMs, 60000);
    assert.equal(writes, 0, 'minute boundaries and current statistics stay in memory');
    assert.equal(storage.has('mu5120-battery-history'), false);
    const compact = snapshots.at(-1).battery;
    assert.equal(compact.samples, undefined);
    assert.equal(compact.measurement.netCurrentMa, -400);
    assert.equal(compact.runtime.minutes, 600);
    assert.ok(compact.currentStats.length > 0);
    assert.ok(compact.currentStatsUpdates.length > 0, 'foreground diagnostics keep revisions from this acquisition');
    for (const update of compact.currentStatsUpdates) assert.ok(compact.currentStats.some(block => block.blockId === update.blockId && block.revision === update.revision));
    assert.ok(routerApi.getBatteryHistory().some(item => item.currentStats?.observedDurationMs > 0));
  } finally { Date.now = realNow; }
});

test('history recovery requires a current reading and restores coverage once after a collection handoff', async () => {
  Date.now = () => now;
  try {
    configure(61);
    const live = await routerApi.dashboard();
    assert.equal(typeof routerApi.resetBatteryCollection, 'function');
    assert.equal(typeof routerApi.restoreBatterySummary, 'function');
    routerApi.resetBatteryCollection();
    const stale = routerApi.restoreBatterySummary({ ...live, timestamp: now - 6000 }, live.battery.currentStats);
    assert.equal(stale.runtime.minutes, null, 'valid saved marker does not establish freshness');
    assert.equal(stale.runtime.state, 'unavailable');
    configure(62);
    const current = await routerApi.dashboard();
    const recentStale = routerApi.restoreBatterySummary({ ...current, stale: true }, live.battery.currentStats);
    assert.equal(recentStale.runtime.state, 'unavailable');
    const restored = routerApi.restoreBatterySummary(current, live.battery.currentStats);
    assert.equal(restored.runtime.minutes, 600);
    assert.deepEqual(restored.currentStatsUpdates, [], 'restored coverage cannot be forwarded as a new observation');
    const repeated = routerApi.restoreBatterySummary(current, live.battery.currentStats);
    assert.equal(repeated.currentWindow.observedDurationMs, restored.currentWindow.observedDurationMs);
    assert.equal(repeated.currentWindow.meanCurrentMa, -400);
    unavailable = true;
    const failed = await routerApi.dashboard();
    assert.equal(failed.battery.measurement, null);
    assert.equal(failed.battery.runtime.minutes, null);
  } finally { unavailable = false; Date.now = realNow; }
});


test('a delayed CSV response cannot refresh an expired foreground gauge measurement', async () => {
  Date.now = () => now;
  try {
    configure(200);
    csvResponseDelayMs = 6000;
    const result = await routerApi.dashboard();
    assert.equal(result.status.battery_gauge.state, 'stale');
    assert.equal(result.battery.measurement, null);
    assert.equal(result.battery.runtime.minutes, null);
    assert.equal(result.battery.percent, null);
  } finally {
    csvResponseDelayMs = 0;
    Date.now = realNow;
  }
});

test('88 endpoint roundtrips reject phone SOC backfill and estimate independently from device CSV', async () => {
  Date.now = () => now;
  try {
    configure(1000);
    routerApi.updateConfig({ batteryHost: 'another.test' });
    const start = now;
    const phoneHistory = Array.from({ length: 11 }, (_, i) => ({
      timestamp: start + i * 60000, percent: 52 - i * 0.2, charging: false,
      percentSource: 'gauge88', percentEndpoint: 'http://another.test:88/state.json'
    }));
    const imported = routerApi.mergeBackgroundBatteryHistory(phoneHistory);
    assert.ok(!imported.some(item => item.timestamp === start), 'old phone SOC records are rejected before collection');
    configure(1600); factoryPercent = 50;
    const before = await routerApi.dashboard();
    assert.equal(before.battery.runtime.state, 'estimated');
    configure(1601);
    routerApi.updateConfig({ batteryHost: '' });
    routerApi.updateConfig({ batteryHost: 'another.test' });
    const after = await routerApi.dashboard();
    assert.equal(after.battery.runtime.state, 'estimated');
    assert.equal(after.battery.runtime.minutes, 600, 'new endpoint CSV is sufficient independently of app history');
    assert.ok(!after.battery.samples.some(item => item.timestamp === start), 'endpoint changes do not import old phone records');
    assert.ok(after.battery.samples.every(item => item.source === 'foreground'));
    assert.equal(writes, 0);
  } finally {
    routerApi.updateConfig({ batteryHost: '' });
    Date.now = realNow;
  }
});

test('88 rejects old native current blocks while retaining foreground measurements and coverage', async () => {
  Date.now = () => now;
  try {
    configure(1700);
    routerApi.resetBatteryCollection();
    const first = await routerApi.dashboard();
    const measurement = { ...first.battery.measurement, rawSoc: 51, sampleMonoSeconds: 5730 };
    const { batteryMeasurementIdentity } = await import('../src/utils/battery-current-window.js');
    const identity = batteryMeasurementIdentity({ measurement });
    const original = { timestamp: now + 30000, percent: 51, charging: false,
      source: 'background', percentSource: measurement.percentageSource, percentEndpoint: measurement.endpoint,
      measurement, currentStats: { segmentId: 'native-keep', blockId: 'native-keep:minute', revision: 1,
        startAt: now, endAt: now + 30000, integralMaMs: -12000000, observedDurationMs: 30000, sampleCount: 3, identity } };
    const originalCopy = structuredClone(original);
    const imported = routerApi.mergeBackgroundBatteryHistory([original]);
    assert.ok(!imported.some(item => item.currentStats?.blockId === 'native-keep:minute'));
    configure(1760);
    const forwarded = await routerApi.dashboard();
    assert.ok(!forwarded.battery.currentStats.some(block => block.blockId === 'native-keep:minute'));
    assert.ok(!forwarded.battery.currentStatsUpdates.some(block => block.blockId === 'native-keep:minute'), 'forwarding a remote block does not authorize a new archive observation');
    assert.equal(forwarded.battery.currentWindow.observedDurationMs, 60000, 'only foreground coverage contributes to the window');
    assert.equal(forwarded.battery.currentWindow.meanCurrentMa, -400);
    assert.equal(forwarded.battery.measurement.rawSoc, 50);
    assert.equal(forwarded.battery.measurement.sampleMonoSeconds, 5760);
    const restored = routerApi.getBatteryHistory().find(item => item.currentStats?.blockId === 'native-keep:minute');
    assert.equal(restored, undefined);
    assert.deepEqual(original, originalCopy, 'rejected old history retains its original measurement and source');
    assert.equal(writes, 0);
  } finally { Date.now = realNow; }
});

test('split minute statistics retain the actual observation time', async () => {
  Date.now = () => now;
  try {
    routerApi.resetBatteryCollection();
    for (const second of [2005, 2025, 2065]) { configure(second); await routerApi.dashboard(); }
    const records = routerApi.getBatteryHistory().filter(item => item.currentStats && item.measurement?.sampleMonoSeconds === 6065);
    assert.ok(records.some(item => item.currentStats.endAt < now), 'one completed minute ends before this acquisition');
    for (const item of records) assert.equal(item.timestamp, now, 'integral boundary is independent of sample reception');
  } finally { Date.now = realNow; }
});
