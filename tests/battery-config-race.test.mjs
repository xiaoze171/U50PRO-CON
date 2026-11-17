import assert from 'node:assert/strict';
import { test } from 'node:test';

let serial = 0;
async function createClient(pauseAt) {
  const storage = new Map([['mu5120-config', { routerUrl: 'http://192.168.0.1:9461' }]]);
  let resume;
  let notify;
  const paused = new Promise(resolve => { notify = resolve; });
  const snapshots = [];
  globalThis.uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) };
  globalThis.window = { AndroidRouter: {
    configureBackground() {}, clearSession() {},
    updateBackgroundSnapshot(raw) { snapshots.push(JSON.parse(raw)); },
    getBackgroundBatteryHistoryAsync(id) {
      const reply = () => window.__mu5120HistoryResponse(id, '[]');
      if (pauseAt === 'history') { resume = reply; notify(); }
      else queueMicrotask(reply);
    },
    request(id, raw) {
      const url = new URL(JSON.parse(raw).url);
      const gauge = url.pathname === '/state.json';
      const fixtures = { loginfo: 'ok', battery_vol_percent: '50', battery_charging: '0', battery_temp: '32' };
      const cmd = url.searchParams.get('cmd');
      const body = gauge ? { soc: 22, data_quality: 'ok' }
        : cmd === 'station_list' || cmd === 'lan_station_list' ? { [cmd]: [] }
          : Object.fromEntries((cmd || '').split(',').map(key => [key, fixtures[key] ?? '']));
      const reply = () => window.__mu5120NativeResponse(id, JSON.stringify({ ok: true, status: 200, body: JSON.stringify(body), headers: { 'X-Gauge-Age': '0' } }));
      if (gauge && pauseAt === 'gauge') { resume = reply; notify(); }
      else queueMicrotask(reply);
    }
  } };
  const { routerApi } = await import(`../src/services/router-client.js?race=${++serial}`);
  return { api: routerApi, paused, resume: () => resume(), snapshots };
}

test('a battery source saved during native history backfill discards the old poll', async () => {
  const client = await createClient('history');
  const poll = client.api.dashboard();
  await client.paused;
  client.api.updateConfig({ batterySource: 'factory' });
  client.resume();
  await assert.rejects(poll, /已更新/);
  assert.equal(client.api.getBatteryHistory().length, 0);
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
