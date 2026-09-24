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
