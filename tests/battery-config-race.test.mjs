import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importBatteryProfileClient } from './helpers/battery-profile-client.mjs';

async function createClient(pauseAt) {
  const storage = new Map([['mu5120-config', { routerUrl: 'http://192.168.0.1:9461' }]]);
  let resume;
  let held = false;
  let notify;
  const paused = new Promise(resolve => { notify = resolve; });
  const snapshots = [];
  globalThis.uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) };
  globalThis.window = { AndroidRouter: {
    configureBackground() {}, clearSession() {},
    updateBackgroundSnapshot(raw) { snapshots.push(JSON.parse(raw)); },
    getBackgroundBatteryHistoryAsync(id) {
      const reply = () => window.__mu5120HistoryResponse(id, JSON.stringify([{ timestamp: Date.now() - 60000, percent: 49, charging: false }]));
      if (pauseAt === 'history') { resume = reply; notify(); }
      else queueMicrotask(reply);
    },
    request(id, raw) {
      const url = new URL(JSON.parse(raw).url);
      const gauge = url.pathname === '/state.json';
      const csv = url.pathname === '/backup/battery-log.csv';
      const fixtures = { loginfo: 'ok', battery_vol_percent: '50', battery_charging: '0', battery_temp: '32' };
      const cmd = url.searchParams.get('cmd');
      const body = csv ? 'ts,soc,voltage_mv,current_ma,power_w,temp_c,status\n1,22,4000,-400,-1.6,31,Discharging'
        : gauge ? { ts: 1, soc: 22, data_quality: 'ok', status: 'Discharging', current_ma: -400, voltage_mv: 4000, power_w: -1.6 }
        : cmd === 'station_list' || cmd === 'lan_station_list' ? { [cmd]: [] }
          : Object.fromEntries((cmd || '').split(',').map(key => [key, fixtures[key] ?? '']));
      const reply = () => window.__mu5120NativeResponse(id, JSON.stringify({ ok: true, status: 200, body: csv ? body : JSON.stringify(body), headers: { 'X-Gauge-Age': '0' } }));
      if (!held && ((gauge && pauseAt === 'gauge') || (csv && pauseAt === 'csv') || (cmd === 'loginfo' && pauseAt === 'login'))) {
        held = true; resume = reply; notify();
      }
      else queueMicrotask(reply);
    }
  } };
  const { routerApi } = await importBatteryProfileClient('gauge88-csv');
  return { api: routerApi, paused, resume: () => resume(), snapshots };
}

test('an endpoint saved during native history backfill discards the old poll and its imported history', async () => {
  const client = await createClient('history');
  const poll = client.api.dashboard();
  await client.paused;
  client.api.updateConfig({ batteryHost: '192.168.1.2' });
  client.resume();
  await assert.rejects(poll, /已更新/);
  assert.equal(client.api.getBatteryHistory().length, 0);
  assert.equal(client.snapshots.length, 0);
});

test('changing the endpoint while device CSV is downloading discards the old poll', async () => {
  const client = await createClient('csv');
  const poll = client.api.dashboard();
  await client.paused;
  client.api.updateConfig({ batteryHost: '192.168.1.2' });
  client.resume();
  await assert.rejects(poll, /已更新/);
  assert.equal(client.api.getBatteryHistory().length, 0);
  assert.equal(client.snapshots.length, 0);
});

test('a configuration roundtrip during device work cannot publish the first endpoint result', async () => {
  const client = await createClient('gauge');
  const poll = client.api.dashboard();
  await client.paused;
  client.api.updateConfig({ batteryHost: '192.168.1.2' });
  client.api.updateConfig({ batteryHost: '' });
  client.resume();
  await assert.rejects(poll, /已更新/);
  assert.equal(client.snapshots.length, 0);
});

test('configuration changes during login are included in the battery publication guard', async () => {
  const client = await createClient('login');
  const poll = client.api.dashboard();
  await client.paused;
  client.api.updateConfig({ routerUrl: 'http://192.168.1.2:9461' });
  client.resume();
  await assert.rejects(poll, /已更新/);
  assert.equal(client.snapshots.length, 0);
});

test('changing the followed router address discards an in-flight gauge poll', async () => {
  const client = await createClient('gauge');
  const poll = client.api.dashboard();
  await client.paused;
  client.api.updateConfig({ routerUrl: 'http://192.168.1.2:9461' });
  client.resume();
  await assert.rejects(poll, /已更新/);
  assert.equal(client.api.getBatteryHistory().length, 0);
  assert.equal(client.snapshots.length, 0);
});
