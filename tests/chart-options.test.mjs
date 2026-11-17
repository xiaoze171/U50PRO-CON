import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as echarts from 'echarts';
import { lineOption, chartWindowPoints, temperatureSeries, throughputSeries, batterySeries } from '../src/utils/chart-options.js';

const minute = 60000;
const now = 1800000000000;
const values = series => series.data.map(point => point.value || point);
const option = series => lineOption(series, false, {}, { now, windowMs: 24 * 60 * minute });

test('temperature charts preserve peaks, source tags and stable sensor colors', () => {
  const history = { battery_temp: [[now - minute, 30, 'foreground'], [now, 90, 'screenOff']], pm_sensor_pa1: [[now, 42]] };
  const series = temperatureSeries(history);
  assert.deepEqual(series.find(item => item.id === 'battery_temp').data, history.battery_temp);
  assert.equal(temperatureSeries({ pm_sensor_pa1: history.pm_sensor_pa1 })[0].color, series.find(item => item.id === 'pm_sensor_pa1').color);
  assert.deepEqual(history.battery_temp[0], [now - minute, 30, 'foreground']);
});

test('CPU aliases produce one series with canonical priority and historical fallback', () => {
  const series = temperatureSeries({ cpu_temp: [[now, 41, 'foreground']], cpu_temperature: [[now - minute, 40, 'screenOff'], [now, 85, 'background']] });
  assert.equal(series.length, 1);
  assert.equal(series[0].id, 'cpu_temp');
  assert.deepEqual(series[0].data, [[now - minute, 40, 'screenOff'], [now, 41, 'foreground']]);
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 320, height: 280 });
  try { instance.setOption(option(series)); assert.match(instance.renderToSVGString(), /<path/); }
  finally { instance.dispose(); }
});

test('missing minutes break lines and keep every measured value including isolated points', () => {
  const data = [[now - 4 * minute, 32, 'screenOff'], [now - 3 * minute, 33, 'screenOff'], [now, 39, 'foreground']];
  const rendered = option([{ id: 'temperature', name: '温度', unit: '°C', color: '#4267ed', data }]).series[0];
  assert.equal(rendered.connectNulls, false);
  const actual = values(rendered);
  assert.equal(actual.filter(point => point[1] === null).length, 1);
  assert.deepEqual(actual.filter(point => point[1] !== null).map(point => point.slice(0, 3)), data);
  assert.ok(rendered.data.at(-1).symbolSize > 0, 'isolated actual sample remains visible');
});

test('a lone sample is visible without fabricating an earlier measurement', () => {
  const rendered = option([{ id: 'battery', name: '电量', color: '#167d79', data: [[now, 58, 'foreground']] }]).series[0];
  assert.equal(rendered.data.length, 1);
  assert.equal(values(rendered)[0][0], now);
  assert.ok(rendered.showSymbol && rendered.data[0].symbolSize > 0);
});

test('a full day chart does not allocate invisible symbols for every sample', () => {
  const data = Array.from({ length: 1440 }, (_, index) => [now - (1439 - index) * minute, 30 + index % 8]);
  const series = Array.from({ length: 11 }, (_, index) => ({ id: `sensor-${index}`, name: `sensor ${index}`, color: '#4267ed', data }));
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 390, height: 280 });
  try {
    instance.setOption(option(series));
    assert.ok(instance.getZr().storage.getDisplayList().length < 200, 'hidden data symbols must not burden each live refresh');
  } finally { instance.dispose(); }
});

test('throughput uses suitable units without rounding away small nonzero rates', () => {
  const input = { down: [[now, 1, 'foreground']], up: [[now, 0, 'screenOff']] };
  const series = throughputSeries(input, now - minute);
  assert.equal(series[0].unit, 'B/s');
  assert.equal(series[0].data[0][1], 1);
  const fast = throughputSeries({ down: [[now, 1048576.1, 'foreground']], up: [[now, 1, 'screenOff']] }, now - minute);
  assert.equal(fast[0].unit, 'MB/s');
  assert.equal(fast[1].data[0][1], 1 / 1024 ** 2);
  assert.equal(input.down[0][1], 1);
});

test('battery curves break when percentage source or endpoint changes', () => {
  const points = [
    { timestamp: now - 2 * minute, percent: 60, percentSource: 'router', source: 'foreground' },
    { timestamp: now - minute, percent: 55, percentSource: 'gauge88', percentEndpoint: 'http://one:88', source: 'foreground' },
    { timestamp: now, percent: 54, percentSource: 'gauge88', percentEndpoint: 'http://two:88', source: 'foreground' }
  ];
  const plotted = values(option(batterySeries(points)).series[0]);
  assert.equal(plotted.filter(point => point[1] === null).length, 2);
  assert.deepEqual(plotted.filter(point => point[1] !== null).map(point => point[1]), [60, 55, 54]);
});

test('clipping preserves only the boundary sample and does not mutate archives', () => {
  const data = [[60, 10], [120, 20], [180, 30], [240, 40]];
  assert.deepEqual(chartWindowPoints(data, 180), data.slice(1));
  assert.deepEqual(chartWindowPoints(data, 300), []);
  assert.equal(data.length, 4);
});

test('all-missing charts communicate empty state and time ticks identify the date for 24h', () => {
  const result = option([{ id: 'empty', name: '信号', data: [], color: '#4267ed' }]);
  assert.ok(result.graphic.some(item => item.style.text.includes('暂无')));
  assert.match(result.xAxis.axisLabel.formatter(now), /\d{1,2}\/\d{1,2}/);
});
