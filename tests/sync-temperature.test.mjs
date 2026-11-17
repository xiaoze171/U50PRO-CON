import assert from 'node:assert/strict';
import { test } from 'node:test';

const T = Math.floor(Date.now() / 60000) * 60000;
const storage = new Map([['mu5120-battery-history', [
  { timestamp: T - 120000, percent: 50, charging: false, temperature: 33, source: 'foreground' }
]]]);
let batteryWrites = 0;
let remoteLive = {
  timestamp: T,
  temperature: { wifi_chip_temp: '-80' },
  battery: { percent: 48, charging: null, samples: [
    { timestamp: T - 60000, percent: 49, charging: false, temperature: -80, source: 'screenOff' },
    { timestamp: T, percent: 48, charging: null, temperature: '35broken', source: 'background' }
  ] }
};

globalThis.uni = {
  getStorageSync: key => storage.get(key),
  setStorageSync(key, value) {
    storage.set(key, value);
    if (key === 'mu5120-battery-history') batteryWrites++;
  }
};
globalThis.window = {
  AndroidRouter: {
    syncGetSelf: () => JSON.stringify({ id: 'phone', platform: 'android' }),
    syncGetPeers: () => JSON.stringify([{ id: 'collector', platform: 'desktop', host: '192.168.0.2', port: 51200 }]),
    syncSetEnabled() {},
    syncSetAdvertise() {},
    syncFetch(id, raw) {
      const options = JSON.parse(raw);
      assert.equal(options.path, '/sync/live?history=0');
      assert.equal(options.method, 'GET');
      queueMicrotask(() => window.__mu5120SyncResponse(id, JSON.stringify({
        ok: true, status: 200, body: JSON.stringify({ live: remoteLive })
      })));
    }
  }
};
const { syncClient } = await import('../src/services/sync.js');
const { routerApi } = await import('../src/services/router-client.js');

test('legacy live battery archives are sanitized and merged before display; compact ticks reuse that archive without traversing or saving it', async () => {
  syncClient.init();
  assert.equal(syncClient.getState().role, 'viewer');
  const legacy = await syncClient.dashboard();
  assert.equal(legacy.battery.samples.find(sample => sample.timestamp === T - 60000).temperature, null);
  assert.equal(legacy.battery.samples.find(sample => sample.timestamp === T).temperature, null);
  assert.equal(legacy.battery.samples.find(sample => sample.timestamp === T).charging, null);
  assert.deepEqual(legacy.battery.samples.map(sample => sample.source), ['foreground', 'screenOff', 'background']);
  assert.equal(legacy.battery.samples[0].temperature, 33, 'the local archive must not be replaced by peer history');
  assert.equal(storage.get('mu5120-battery-history')[1].temperature, null);
  assert.equal(legacy.temperature.wifi_chip_temp, '-80', 'raw diagnostics remain untouched');
  assert.equal(remoteLive.battery.samples[0].temperature, -80, 'input fixture remains an unmodified raw peer payload');

  const archive = routerApi.getBatteryHistory();
  let temperatureReads = 0;
  const originalTemperature = archive[0].temperature;
  Object.defineProperty(archive[0], 'temperature', {
    configurable: true, enumerable: true,
    get() { temperatureReads++; return originalTemperature; }
  });
  const writesBeforeCompact = batteryWrites;
  remoteLive = { timestamp: T + 1000, battery: { percent: 48, charging: null } };
  try {
    const compact = await syncClient.dashboard();
    assert.equal(compact.battery.samples, archive, 'compact viewing must reuse the existing sanitized archive');
    assert.equal(temperatureReads, 0, 'a compact tick must not traverse or serialize a day of history');
    assert.equal(batteryWrites, writesBeforeCompact, 'a compact tick must not rewrite the battery archive');
  } finally {
    Object.defineProperty(archive[0], 'temperature', { configurable: true, enumerable: true, writable: true, value: originalTemperature });
  }
});
