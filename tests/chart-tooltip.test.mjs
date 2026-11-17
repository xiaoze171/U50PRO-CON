import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as echarts from 'echarts';
import { historyTooltip } from '../src/utils/collection-source.js';
import { lineOption } from '../src/utils/chart-options.js';

const timestamp = new Date(2026, 10, 16, 12, 34, 56).getTime();
const point = (name, value, unit, extra = {}) => ({
  seriesName: name, color: '#4267ed', value: [timestamp, value, 'foreground', unit], ...extra
});

test('tooltip gives every metric its unit and preserves the sample collection source', () => {
  const html = historyTooltip([
    point('下载', 2.375, 'MB/s'), point('RSRP', -102.5, 'dBm'),
    point('电池温度', 33.84, '°C'), point('电量', 87.12, '%', {
      value: [timestamp, 87.12, 'screenOff', '%']
    })
  ]);
  assert.match(html, /2\.38 MB\/s/);
  assert.match(html, /-102\.5 dBm/);
  assert.match(html, /33\.84 °C/);
  assert.match(html, /87\.12 % · 息屏/);
  assert.match(html, /前台/);
  assert.match(html, /2026/);
  assert.match(html, /12:34:56/);
});

test('small nonzero speeds remain visible while a measured zero is still zero', () => {
  for (const value of [0.0005, 0.000000001]) {
    const html = historyTooltip(point('下载', value, 'MB/s'));
    assert.ok(!html.includes('>0 MB/s'), 'a tiny measured value must not round down to zero');
    assert.match(html, value === 0.0005 ? /0\.0005 MB\/s/ : /1e-9 MB\/s/);
  }
  assert.match(historyTooltip(point('上传', 0, 'B/s')), /0 B\/s · 前台/);
});

test('gap markers and malformed points cannot appear as measured zero', () => {
  const invalid = [null, undefined, '', ' ', NaN, Infinity, true, {}, []];
  assert.equal(historyTooltip(invalid.map(value => point('缺口', value, '°C'))), '');
  assert.equal(historyTooltip(point('错误时间', 30, '°C', { value: ['', 30, 'foreground', '°C'] })), '');
  const html = historyTooltip([point('缺口', null, '°C'), point('有效', 0, '°C')]);
  assert.ok(!html.includes('缺口'));
  assert.match(html, /有效/);
  assert.match(html, /0 °C/);
});

test('tooltip escapes external labels and units and never interpolates marker HTML or unsafe colors', () => {
  const html = historyTooltip(point('<img src=x onerror=alert(1)>', 23, '<svg onload=x>', {
    color: '#fff;position:fixed', marker: '<script>alert(1)</script>'
  }));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<svg'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('position:fixed'));
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;svg/);
  assert.match(historyTooltip(point('温度', 23, '°C')), /background-color:#4267ed/);
});

test('legacy tooltips keep readable source tags and do not mutate ECharts input', () => {
  const params = [point('旧数据', 50, undefined, { value: [timestamp, 50] })];
  const before = JSON.stringify(params);
  assert.match(historyTooltip(params), /50 · 未标记/);
  assert.equal(JSON.stringify(params), before);
});

test('real ECharts midpoint tooltip only shows readings at the snapped axis time', () => {
  const now = 1800000000000;
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 390, height: 300 });
  try {
    chart.setOption(lineOption([
      { id: 'early', name: '早采样', color: '#4267ed', unit: '°C', data: [[now - 120000, 30, 'foreground']] },
      { id: 'late', name: '晚采样', color: '#167d79', unit: '°C', data: [[now, 40, 'foreground']] }
    ], false, {}, { now, windowMs: 7200000 }));
    let axisPayload;
    chart.on('showtip', event => { axisPayload = event.dataByCoordSys?.[0]?.dataByAxis?.[0]; });
    chart.dispatchAction({ type: 'updateAxisPointer',
      x: chart.convertToPixel({ xAxisIndex: 0 }, now - 60000),
      y: chart.convertToPixel({ yAxisIndex: 0 }, 35) });
    assert.equal(axisPayload.value, now - 120000);
    assert.equal(axisPayload.seriesDataIndices.length, 2, 'ECharts returns equally distant readings from two timestamps');
    const params = axisPayload.seriesDataIndices.map(item => ({
      ...chart.getModel().getSeriesByIndex(item.seriesIndex).getDataParams(item.dataIndexInside),
      axisValue: axisPayload.value
    }));
    const html = historyTooltip(params);
    assert.match(html, /早采样/);
    assert.match(html, /30 °C/);
    assert.ok(!html.includes('晚采样'), 'a later reading must not be labelled with the snapped earlier time');
    assert.ok(!html.includes('40 °C'));
  } finally { chart.dispose(); }
});

test('without an axis time, mixed legacy timestamps are never grouped under one timestamp', () => {
  const html = historyTooltip([
    point('同刻 A', 30, '°C'), point('另一时刻', 40, '°C', { value: [timestamp + 60000, 40, 'foreground', '°C'] }),
    point('同刻 B', 35, '°C')
  ]);
  assert.match(html, /同刻 A/);
  assert.match(html, /同刻 B/);
  assert.ok(!html.includes('另一时刻'));
});

test('an axis snapped to a gap cannot borrow a valid reading from another timestamp', () => {
  assert.equal(historyTooltip([
    point('缺口', null, '°C', { axisValue: timestamp }),
    point('晚采样', 40, '°C', { axisValue: timestamp, value: [timestamp + 60000, 40, 'foreground', '°C'] })
  ]), '');
});
