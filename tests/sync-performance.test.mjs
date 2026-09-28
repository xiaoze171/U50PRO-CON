import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyChartHistory } from '../src/utils/history.js';

let now = 1800000000000;
const realNow = Date.now;
Date.now = () => now;
const publications = [];
let failPublication = false;
let inbound = [];
const fetchedPaths = [];
let remoteHistory;
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
        : path.startsWith('/sync/live') ? { live: { timestamp: now, battery: { percent: 37, charging: false } } }
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
    const live = { timestamp: now, source: 'foreground', status: { realtime_rx_thrpt: '2048' }, battery: { percent: 48, samples: battery } };

    await syncClient.afterTick({ live, localStore: { chart, battery } });
    const first = publications.at(-1);
    assert.equal(first.live.battery.samples, undefined, 'live must not carry a second copy of the battery archive');
    assert.equal(first.battery[0].source, 'foreground');
    assert.deepEqual(first.chart.rsrp, [[now, -95, 'foreground']]);
    assert.equal(live.battery.samples, battery, 'publication must not modify the dashboard');

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
    const viewed = await syncClient.dashboard();
    assert.equal(viewed.battery.samples.at(-1).source, 'screenOff', 'compact live values must use the separately synced battery archive');
    assert.ok(fetchedPaths.includes('/sync/live?history=0'));
    now += 20000;
    await syncClient.afterTick({ live: viewed, localStore });
    const since = Number(new URL(fetchedPaths.at(-1), 'http://localhost').searchParams.get('since'));
    assert.ok(since <= now - 80000, 'the history cursor must overlap minute buckets published after the previous request');
  } finally {
    Date.now = realNow;
  }
});
