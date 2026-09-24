import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { historyTooltip } from '../src/utils/collection-source.js';

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
