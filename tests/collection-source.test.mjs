import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePoints, mergeChartHistory, mergeBatterySamples } from '../src/utils/history.js';

const T = 1800000000000;

test('minute normalization keeps the source paired with the winning value', () => {
  assert.deepEqual(normalizePoints([
    [T + 1000, -93, 'screenOff'], [T + 2000, -90, 'foreground'],
    [T + 61000, -95, 'overlay']
  ]), [[T, -90, 'foreground'], [T + 60000, -95, 'overlay']]);
});

test('native backfill retains source tags in every chart group through persistence and repeated merges', () => {
  const local = { rsrp: [[T, -90, 'foreground']] };
  const native = { rsrp: [[T + 60000, -95, 'screenOff']], down: [[T + 60000, 2048, 'background']],
    temperatures: { battery_temp: [[T + 60000, 33, 'overlay']] } };
  const merged = mergeChartHistory(local, native);
  assert.deepEqual(merged.rsrp, [[T, -90, 'foreground'], [T + 60000, -95, 'screenOff']]);
  assert.deepEqual(merged.down, [[T + 60000, 2048, 'background']]);
  assert.deepEqual(merged.temperatures.battery_temp, [[T + 60000, 33, 'overlay']]);
  assert.deepEqual(mergeChartHistory(JSON.parse(JSON.stringify(merged)), native), merged);
});

test('legacy chart values remain untagged instead of inheriting a different sample source', () => {
  assert.deepEqual(normalizePoints([[T, 1, 'screenOff'], [T + 1, 2]]), [[T, 2]]);
});

test('a replacement battery sample cannot inherit an older sample source', () => {
  const merged = mergeBatterySamples([
    [{ timestamp: T, percent: 50, charging: false, source: 'screenOff' }],
    [{ timestamp: T + 1000, percent: 51, charging: false }]
  ]);
  assert.equal(merged[0].percent, 51);
  assert.equal(merged[0].source, undefined);
});

const identity = { percentageSource: 'gauge88', endpoint: 'http://gauge.test:88/state.json',
  mode: 'discharging', bootId: 'test-boot', usableCapacityMah: 8000, capacityBasis: 'fixture', anchorIdentity: 'test-anchor' };
const measurement = { schemaVersion: 2, rawSoc: 50, ...identity, netCurrentMa: -400, voltageMv: 4000,
  netPowerW: -1.6, externalPower: false, fullConfirmed: false, fullAnchorValid: true,
  fullStableSeconds: 0, eodImminent: false, eodClamp: false, sampleMonoSeconds: 60 };
const stat = (segment, start, end, revision = 1) => ({ segmentId: segment, blockId: `${segment}:minute`, revision,
  startAt: T + start, endAt: T + end, integralMaMs: -400 * (end - start),
  observedDurationMs: end - start, sampleCount: 3, identity });
const sample = (currentStats, mode = 'discharging') => ({ timestamp: currentStats?.endAt ?? T,
  percent: 50, charging: mode === 'charging', percentSource: 'gauge88', percentEndpoint: identity.endpoint,
  measurement: { ...measurement, mode }, currentStats });

test('same-minute foreground background foreground statistics retain all three blocks', () => {
  const first = sample(stat('front-a', 0, 15000));
  const second = sample(stat('native', 15000, 40000));
  const third = sample(stat('front-b', 40000, 59000));
  const merged = mergeBatterySamples([[first, second], [third, first]]);
  assert.equal(merged.length, 3);
  assert.equal(merged.reduce((sum, item) => sum + item.currentStats.observedDurationMs, 0), 59000);
  assert.deepEqual(merged.map(item => item.currentStats.segmentId), ['front-a', 'native', 'front-b']);
});

test('same block uses highest revision regardless of arrival order and never adds integrals', () => {
  const older = sample(stat('front-a', 0, 10000, 1));
  const newer = sample(stat('front-a', 0, 30000, 2));
  const merged = mergeBatterySamples([[newer], [older]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].currentStats.revision, 2);
  assert.equal(merged[0].currentStats.integralMaMs, -12000000);
});

test('charging full and direct-supply boundaries are not collapsed into a minute point', () => {
  const entries = ['charging', 'confirming', 'full', 'external'].map((mode, index) => ({
    ...sample(null, mode), timestamp: T + index * 1000, charging: mode === 'charging' ? true : null
  }));
  assert.deepEqual(mergeBatterySamples([entries]).map(item => item.measurement.mode), entries.map(item => item.measurement.mode));
});

test('legacy replacements have explicit null measurement and stats instead of inherited readings', () => {
  const old = { timestamp: T, percent: 50, charging: false, measurement, currentStats: null };
  const legacy = { timestamp: T + 1000, percent: 49, charging: false };
  const newest = mergeBatterySamples([[old], [legacy]]).at(-1);
  assert.equal(newest.measurement, null);
  assert.equal(newest.currentStats, null);
  assert.equal(newest.measurementIdentity, 'legacy');
});

test('malformed statistics cannot enter the archive as valid current coverage', () => {
  const malformed = { ...stat('bad', 0, 10000), observedDurationMs: 20000 };
  const [result] = mergeBatterySamples([[sample(malformed)]]);
  assert.equal(result.currentStats, null);
});
