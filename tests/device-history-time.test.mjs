import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseJs } from '@babel/parser';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';
import { renderToString } from '@vue/server-renderer';
import { buildDeviceHistory } from '../src/utils/device-history.js';
import { formatDate } from '../src/utils/format.js';
import { historyTooltip } from '../src/utils/collection-source.js';
import { lineOption } from '../src/utils/chart-options.js';
const factoryDateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false });

const page = readFileSync(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8').split('<script setup>')[1].split('</script>')[0];
const ast = parseJs(page, { sourceType: 'module' });
const runPage = (name, context) => {
  const node = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  return new Function(...Object.keys(context), `return (${page.slice(node.start, node.end)});`)(...Object.values(context));
};

test('device calendar ordering and every displayed history time ignore viewer DST and timezone', async () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['America/New_York', 'Europe/Berlin', 'Asia/Shanghai', 'UTC']) {
      process.env.TZ = zone;
      const history = buildDeviceHistory({ rows: [
        { ts_iso: '2026-03-08 02:59:00', ts: 1772938740, soc: 50, download_bps: 1024, net_interval_s: 60 },
        { ts_iso: '2026-03-08 03:00:00', ts: 1772938800, soc: 49, download_bps: 0, net_interval_s: 60 }
      ] });
      assert.equal(history.snapshotCount, 2, zone);
      assert.equal(history.diagnostics.reversedRows, 0, zone);
      assert.equal(history.latestTimestamp, 1772938800000, zone);
      assert.equal(formatDate(history.battery[0].timestamp, 'device'), '2026-03-08 02:59:00', zone);
      const behavior = runPage('chartHistoryBehavior', { usesDeviceHistory: true, deviceHistory: { value: history }, Date })(7200000, 'throughput');
      const option = lineOption([{ name: '下载', data: history.chart.down }], false, {}, behavior);
      assert.equal(option.xAxis.axisLabel.formatter(1772938740000), '02:59', zone);
      const dayOption = lineOption([], false, {}, { ...behavior, windowMs: 86400000 });
      assert.equal(dayOption.xAxis.axisLabel.formatter(1772938740000), '3/8\n02:59', zone);
      assert.match(historyTooltip({ seriesName: '下载', value: history.chart.down[0] }), /2026-03-08 02:59:00/, zone);

      const hint = ast.program.body.find(item => item.type === 'VariableDeclaration' && item.declarations[0].id.name === 'deviceHistoryHint').declarations[0].init.arguments[0];
      const hintValue = new Function('deviceHistory', 'formatDate', `return (${page.slice(hint.start, hint.end)})();`)({ value: history }, formatDate);
      assert.match(hintValue, /截至 2026-03-08 03:00:00/, zone);

      const template = readFileSync(new URL('../src/components/BatteryHistory.vue', import.meta.url), 'utf8').split('<template>')[1].split('</template>')[0];
      const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(Vue);
      const html = await renderToString(Vue.createSSRApp({ render, data: () => ({ root: null, virtualized: false, visibleSamples: history.battery, formatDate, collectionSourceLabel: () => '设备记录' }) }));
      assert.match(html, /2026-03-08 02:59:00/, zone);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('missing device battery reading displays a missing value in the history list', async () => {
  const template = readFileSync(new URL('../src/components/BatteryHistory.vue', import.meta.url), 'utf8').split('<template>')[1].split('</template>')[0];
  const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(Vue);
  const html = await renderToString(Vue.createSSRApp({ render, data: () => ({ root: null, virtualized: false,
    visibleSamples: [{ timestamp: 1772938740000, percent: null, source: 'device' }], formatDate, collectionSourceLabel: () => '设备记录' }) }));
  assert.match(html, /<b>—<\/b>/);
});

test('factory axes, tooltips and date formatting retain viewer local time', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const timestamp = new Date(2026, 2, 8, 3, 1, 0).getTime();
    const option = lineOption([{ name: '温度', data: [[timestamp, 30, 'foreground']] }], false, {}, { now: timestamp, windowMs: 7200000 });
    assert.equal(option.xAxis.axisLabel.formatter(timestamp), '03:01');
    assert.match(historyTooltip({ seriesName: '温度', value: [timestamp, 30, 'foreground'] }), /03:01:00/);
    assert.equal(formatDate(timestamp), factoryDateFormatter.format(new Date(timestamp)));
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
