import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { historyTooltip } from '../src/utils/collection-source.js';
import { reactive, toRaw } from 'vue';

// Exercise the page's actual pure functions, without starting its router polling lifecycle.
const page = readFileSync(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8');
const script = page.split('<script setup>')[1].split('</script>')[0];
const ast = parse(script, { sourceType: 'module' });
function pageFunction(name, context = {}) {
  const node = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  return runInNewContext(`(${script.slice(node.start, node.end)})`, context);
}

test('switching to an older collector cannot relabel new data with the previous source', () => {
  const merge = pageFunction('mergeDashboard');
  const previous = { source: 'screenOff', status: { value: 1 } };
  const fresh = merge(previous, { status: { value: 2 } });
  assert.equal(fresh.source, 'unknown');
  assert.equal(fresh.status.value, 2);
  const stale = merge(previous, { stale: true, source: 'foreground' });
  assert.equal(stale.source, 'screenOff');
  assert.equal(stale.status.value, 1);
});

test('temperature smoothing does not blend different collection sources', () => {
  const smooth = pageFunction('smoothSeries', { numeric: Number.parseFloat });
  const points = smooth([[60000, 30, 'foreground'], [120000, 40, 'screenOff']]);
  assert.equal(points[0][1], 30);
  assert.equal(points[0][2], 'foreground');
  assert.equal(points[1][1], 40);
  assert.equal(points[1][2], 'screenOff');
});

test('chart tooltip displays each sample source and safely handles legacy or external names', () => {
  const html = historyTooltip([
    { seriesName: '<img src=x>', value: [1800000000000, 30, 'screenOff'] },
    { seriesName: '电池', value: [1800000000000, 50] }
  ]);
  assert.ok(html.includes('30 · 息屏'));
  assert.ok(html.includes('50 · 未标记'));
  assert.ok(!html.includes('<img'));
});

test('unchanged battery archives are compared without traversing Vue proxy getters', () => {
  const compare = pageFunction('sameDashboardValue', { toRaw });
  const raw = { percent: 48, samples: [{ timestamp: 1800000000000, percent: 48 }] };
  const current = reactive(raw);
  let serializedProxy = false;
  const realStringify = JSON.stringify;
  const json = { stringify(value) { if (value === current) serializedProxy = true; return realStringify(value); } };
  const measuredCompare = pageFunction('sameDashboardValue', { toRaw, JSON: json });
  assert.equal(measuredCompare(current, { ...raw }), true);
  assert.equal(serializedProxy, false, 'serializing the proxy visits the full reactive archive on every poll');
  assert.equal(compare(current, { ...raw, percent: 47 }), false);
});

test('two-hour charts exclude expired points but retain the boundary segment and sample sources', () => {
  const node = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === 'chartWindowPoints');
  assert.ok(node, 'charts must clip their input before building and smoothing series');
  const select = pageFunction('chartWindowPoints');
  const points = [[60, 10, 'screenOff'], [120, 20, 'background'], [180, 30, 'foreground'], [240, 40, 'foreground']];
  assert.deepEqual(Array.from(select(points, 180), item => Array.from(item)), points.slice(1));
  assert.deepEqual(Array.from(select(points, 300)), []);
  assert.equal(points.length, 4, 'display clipping must not prune the saved archive');
});
