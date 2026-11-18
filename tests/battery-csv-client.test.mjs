import assert from 'node:assert/strict';
import { test } from 'node:test';

const header = 'ts,ts_iso,soc,voltage_mv,current_ma,power_w,temp_c,status';
const goodCsv = `${header}\n1000,,50,4000,-400,-1.6,31,Discharging\n`;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('device CSV caches one bounded parsed result for 60 seconds and coalesces readers', async () => {
  const { createBatteryCsvClient } = await import('../src/services/battery-csv-client.js');
  let now = 100000;
  const next = deferred();
  const requested = [];
  const client = createBatteryCsvClient({ now: () => now, request: async (url, options) => {
    requested.push({ url, options });
    await next.promise;
    return goodCsv;
  } });
  const first = client.get('http://router.test:88/state.json');
  const second = client.get('http://router.test:88/state.json');
  next.resolve();
  const result = await first;
  assert.equal((await second).csv.rows.length, 1);
  assert.equal(result.state, 'ready');
  assert.equal(requested.length, 1);
  assert.equal(new URL(requested[0].url).pathname, '/backup/battery-log.csv');
  assert.equal(requested[0].options.responseType, 'text');
  assert.ok(requested[0].options.timeoutMs <= 5000);
  now += 59999;
  assert.equal((await client.get('http://router.test:88/state.json')).fetchedAt, 100000);
  assert.equal(requested.length, 1);
  now += 1;
  await client.get('http://router.test:88/state.json');
  assert.equal(requested.length, 2);
});

test('CSV endpoint changes invalidate retained and in-flight results, including roundtrips', async () => {
  const { createBatteryCsvClient } = await import('../src/services/battery-csv-client.js');
  const next = deferred();
  let calls = 0;
  const client = createBatteryCsvClient({ request: async () => { calls++; return calls === 1 ? next.promise : goodCsv; } });
  const old = client.get('http://one.test:88/state.json');
  client.invalidate();
  await client.get('http://two.test:88/state.json');
  next.resolve(goodCsv);
  assert.equal((await old).state, 'invalidated');
  await client.get('http://one.test:88/state.json');
  assert.equal(calls, 3);
});

test('failed or malformed CSV never reuses a previous numeric analysis and retries at the cache cadence', async () => {
  const { createBatteryCsvClient } = await import('../src/services/battery-csv-client.js');
  let now = 0;
  let content = goodCsv;
  let calls = 0;
  const client = createBatteryCsvClient({ now: () => now, request: async () => {
    calls++;
    if (content instanceof Error) throw content;
    return content;
  } });
  assert.equal((await client.get('http://router.test:88/state.json')).state, 'ready');
  now = 60000;
  content = 'wrong,header\n1,2';
  const bad = await client.get('http://router.test:88/state.json');
  assert.equal(bad.state, 'unavailable');
  assert.equal(bad.reason, 'invalid-csv');
  assert.equal(bad.csv, null);
  content = new Error('offline');
  await client.get('http://router.test:88/state.json');
  assert.equal(calls, 2);
  now = 120000;
  assert.equal((await client.get('http://router.test:88/state.json')).reason, 'fetch-error');
});

test('CSV input is bounded and hanging transports settle as a timeout', async () => {
  const { createBatteryCsvClient } = await import('../src/services/battery-csv-client.js');
  const oversized = createBatteryCsvClient({ request: async () => 'x'.repeat(4 * 1024 * 1024 + 1) });
  assert.equal((await oversized.get('http://router.test:88/state.json')).reason, 'too-large');
  const hanging = createBatteryCsvClient({ request: () => new Promise(() => {}), timeoutMs: 10 });
  assert.equal((await hanging.get('http://router.test:88/state.json')).reason, 'timeout');
});

test('manual force refresh replaces a fresh cached CSV while preserving reader identity', async () => {
  const { createBatteryCsvClient } = await import('../src/services/battery-csv-client.js');
  let now = 1000;
  let content = goodCsv;
  const client = createBatteryCsvClient({ now: () => now, request: async () => content });
  const first = await client.get('http://router.test:88/state.json');
  assert.equal(await client.get('http://router.test:88/state.json'), first);
  now += 1000;
  content = goodCsv.replace(',50,', ',49,');
  const forced = await client.get('http://router.test:88/state.json', { force: true });
  assert.notEqual(forced, first);
  assert.equal(forced.csv.rows[0].soc, 49);
  assert.equal(await client.get('http://router.test:88/state.json'), forced);
});

test('force refresh coalesces with a running refresh and normal readers await that result', async () => {
  const { createBatteryCsvClient } = await import('../src/services/battery-csv-client.js');
  const next = deferred();
  let content = goodCsv;
  const client = createBatteryCsvClient({ request: async () => content });
  await client.get('http://router.test:88/state.json');
  content = next.promise;
  const first = client.get('http://router.test:88/state.json', { force: true });
  const second = client.get('http://router.test:88/state.json', { force: true });
  const reader = client.get('http://router.test:88/state.json');
  assert.equal(first, second);
  assert.equal(reader, first);
  next.resolve(goodCsv.replace(',50,', ',48,'));
  assert.equal((await reader).csv.rows[0].soc, 48);
});

test('a forced retry can recover immediately from a cached fetch failure', async () => {
  const { createBatteryCsvClient } = await import('../src/services/battery-csv-client.js');
  let offline = true;
  const client = createBatteryCsvClient({ request: async () => {
    if (offline) throw new Error('offline');
    return goodCsv;
  } });
  const failed = await client.get('http://router.test:88/state.json');
  assert.equal(failed.state, 'unavailable');
  offline = false;
  assert.equal(await client.get('http://router.test:88/state.json'), failed);
  assert.equal((await client.get('http://router.test:88/state.json', { force: true })).state, 'ready');
});

test('changing endpoint during a forced refresh prevents its late response from replacing the new cache', async () => {
  const { createBatteryCsvClient } = await import('../src/services/battery-csv-client.js');
  const oldRefresh = deferred();
  let oldRequests = 0;
  const client = createBatteryCsvClient({ request: async url => {
    if (new URL(url).hostname === 'one.test' && ++oldRequests === 2) return oldRefresh.promise;
    return goodCsv;
  } });
  await client.get('http://one.test:88/state.json');
  const stale = client.get('http://one.test:88/state.json', { force: true });
  const current = await client.get('http://two.test:88/state.json');
  oldRefresh.resolve(goodCsv.replace(',50,', ',1,'));
  assert.equal((await stale).state, 'invalidated');
  assert.equal(await client.get('http://two.test:88/state.json'), current);
  assert.equal(current.csv.rows[0].soc, 50);
});
