import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyChartHistory } from '../src/utils/history.js';
import { sanitizeBatteryMeasurement } from '../src/utils/battery-gauge.js';
import { batteryMeasurementIdentity } from '../src/utils/battery-current-window.js';

let now = 1800000000000;
const realNow = Date.now;
Date.now = () => now;
const publications = [];
let failPublication = false;
let inbound = [];
const fetchedPaths = [];
let remoteHistory;
let remoteLive;
const peer = { id: 'z-peer', name: 'Viewer', platform: 'android', tokenFP: '12345678', host: '192.168.0.3', port: 51200 };
globalThis.uni = { getStorageSync: () => undefined, setStorageSync() {} };
globalThis.window = {
  AndroidRouter: {
    syncGetSelf: () => JSON.stringify({ id: 'a-self', name: 'Phone', platform: 'android', tokenFP: '12345678' }),
    syncGetPeers: () => JSON.stringify([peer]),
    syncSetEnabled() {},
    syncSetAdvertise() {},
    syncDrainInbound: () => JSON.stringify(inbound.splice(0)),
    syncFetch(id, raw) {
      const { path, method } = JSON.parse(raw);
      fetchedPaths.push(path);
      const body = method === 'POST' ? { ok: true }
        : path.startsWith('/sync/live') ? { live: remoteLive ?? { timestamp: now, battery: { percent: 37, charging: false } } }
        : { ...remoteHistory, now };
      queueMicrotask(() => window.__mu5120SyncResponse(id, JSON.stringify({ ok: true, status: 200, body: JSON.stringify(body) })));
    },
    syncPublish(raw) {
      if (failPublication) throw new Error('bridge unavailable');
      publications.push(JSON.parse(raw));
    }
  }
};
const { syncClient } = await import('../src/services/sync.js');

test('collector sends live values every tick without serializing a day of history every second', async () => {
  try {
    syncClient.init();
    assert.equal(syncClient.getState().role, 'collector');
    const battery = [{ timestamp: now, percent: 48, charging: false, source: 'foreground' }];
    const chart = { ...emptyChartHistory(), rsrp: [[now, -95, 'foreground']] };
    const measurement = sanitizeBatteryMeasurement({ schemaVersion: 2, rawSoc: 48, mode: 'discharging',
      netCurrentMa: -400, usableCapacityMah: 8000, percentageSource: 'gauge88', endpoint: 'http://collector:88/state.json',
      bootId: 'fixture-boot', capacityBasis: 'fixture', anchorIdentity: 'fixture-anchor' });
    const identity = batteryMeasurementIdentity({ measurement, endpoint: measurement.endpoint });
    const currentStats = [{ segmentId: 'fixture-segment', blockId: 'fixture-block', revision: 2,
      startAt: now - 60000, endAt: now, integralMaMs: -24000000, observedDurationMs: 60000, sampleCount: 3, identity }];
    const currentWindow = { meanCurrentMa: -400, observedDurationMs: 60000, sampleCount: 3,
      windowStart: now - 60000, windowEnd: now, identity, currentStats };
    const timeToFull = { targetPercent: 100, minutes: null, method: null, state: 'not-applicable', reason: '未充电' };
    // This intentionally differs from a local 48%/8000mAh/-400mA calculation.
    const runtime = { targetPercent: 0, minutes: 123.456, method: 'net-current', state: 'estimated', reason: '' };
    const live = { timestamp: now, source: 'foreground', status: { realtime_rx_thrpt: '2048' }, battery: {
      percent: 48, samples: battery, measurement, mode: measurement.mode, currentStats, currentWindow,
      currentStatsUpdates: [{ blockId: currentStats[0].blockId, revision: currentStats[0].revision }],
      timeToFull, runtime, calculatedAt: now - 5000, windowSeconds: 60
    } };

    await syncClient.afterTick({ live, localStore: { chart, battery } });
    const first = publications.at(-1);
    assert.equal(first.live.battery.samples, undefined, 'live must not carry a second copy of the battery archive');
    assert.equal(first.battery[0].source, 'foreground');
    assert.deepEqual(first.chart.rsrp, [[now, -95, 'foreground']]);
    assert.equal(live.battery.samples, battery, 'publication must not modify the dashboard');
    assert.deepEqual(first.live.battery.measurement, measurement);
    assert.deepEqual(first.live.battery.currentStats, currentStats);
    assert.equal(first.live.battery.currentStatsUpdates, undefined, 'LAN publication cannot transfer local acquisition ownership');
    assert.deepEqual(first.live.battery.currentWindow, currentWindow);
    assert.deepEqual(first.live.battery.timeToFull, timeToFull);
    assert.deepEqual(first.live.battery.runtime, runtime);
    assert.equal(first.live.battery.calculatedAt, live.battery.calculatedAt);

    now += 1000;
    let historyReads = 0;
    const localStore = () => { historyReads++; return { chart, battery }; };
    await syncClient.afterTick({ live: { ...live, timestamp: now }, localStore });
    const next = publications.at(-1);
    assert.equal(next.live.timestamp, now);
    assert.equal(Object.hasOwn(next, 'chart'), false);
    assert.equal(Object.hasOwn(next, 'battery'), false);
    assert.equal(historyReads, 0, 'a live-only tick must not even copy the archive');

    now += 60000;
    await syncClient.afterTick({ live, localStore });
    assert.equal(historyReads, 1);
    assert.equal(publications.at(-1).battery.length, 1);

    syncClient.setEnabled(false);
    syncClient.setEnabled(true);
    now += 1000;
    await syncClient.afterTick({ live, localStore });
    assert.ok(publications.at(-1).chart, 're-enabling must publish a complete archive immediately');

    now += 60000;
    failPublication = true;
    await syncClient.afterTick({ live, localStore });
    failPublication = false;
    now += 1000;
    await syncClient.afterTick({ live, localStore });
    assert.ok(publications.at(-1).chart, 'failed history publication must be retried');

    remoteHistory = { chart: emptyChartHistory(), battery: [{ timestamp: now - 1000, percent: 37, charging: false, source: 'screenOff' }] };
    syncClient.setPreferredCollector(peer.id);
    await syncClient.afterTick({ live, localStore });
    remoteLive = { ...live, timestamp: now, battery: { ...live.battery, samples: undefined } };
    const viewed = await syncClient.dashboard();
    assert.equal(viewed.battery.samples.at(-1).source, 'screenOff', 'compact live values must use the separately synced battery archive');
    assert.ok(fetchedPaths.includes('/sync/live?history=0'));
    assert.deepEqual(viewed.battery.timeToFull, timeToFull);
    assert.deepEqual(viewed.battery.runtime, runtime, 'viewers must preserve collector estimates instead of recalculating from their archive');
    assert.equal(viewed.battery.calculatedAt, live.battery.calculatedAt);
    assert.deepEqual(viewed.battery.currentStats, currentStats);
    assert.equal(viewed.battery.currentStatsUpdates, undefined, 'viewer data cannot claim native archive ownership');
    assert.deepEqual(viewed.battery.currentWindow, currentWindow);
    for (const invalid of [
      { percent: 37, charging: false, remainingHours: 9 },
      { ...live.battery, measurement: { schemaVersion: 2, rawSoc: '48' } },
      { ...live.battery, currentStats: { integralMaMs: -24000000 }, runtime: { ...runtime, minutes: '123' } },
      { ...live.battery, currentStats: [{ ...currentStats[0], observedDurationMs: 60001 }], calculatedAt: '1800000000000' },
      { ...live.battery, measurement: null, currentStats: null },
      { ...live.battery, runtime: { ...runtime, state: 'constructor' } }
    ]) {
      remoteLive = { timestamp: now, battery: { ...invalid, samples: undefined } };
      const legacy = (await syncClient.dashboard()).battery;
      assert.equal(legacy.runtime.minutes, null);
      assert.equal(legacy.runtime.state, 'unavailable');
      assert.equal(legacy.runtime.reason, '待刷新');
      if (!invalid.measurement || typeof invalid.measurement.rawSoc !== 'number') assert.equal(legacy.measurement, null);
      if (!Array.isArray(invalid.currentStats) || invalid.currentStats[0]?.observedDurationMs > 60000) assert.equal(legacy.currentStats, null);
      assert.equal(legacy.samples.at(-1).source, 'screenOff', 'invalid live fields must not discard the separate archive');
    }
    now += 20000;
    await syncClient.afterTick({ live: viewed, localStore });
    const since = Number(new URL(fetchedPaths.at(-1), 'http://localhost').searchParams.get('since'));
    assert.ok(since <= now - 80000, 'the history cursor must overlap minute buckets published after the previous request');
  } finally {
    Date.now = realNow;
  }
});
