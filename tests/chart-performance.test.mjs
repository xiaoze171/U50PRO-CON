import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as echarts from 'echarts';

const source = readFileSync(new URL('../src/components/AppChart.vue', import.meta.url), 'utf8')
  .split('<script module="chart" lang="renderjs">')[1].split('</script>')[0]
  .replace(/import[^;]+;/, '').replace('export default', 'globalThis.chartComponent =');

function chartHarness(realInstance = null, runtime = {}) {
  const frames = [];
  const calls = [];
  // Execute the renderjs methods in ECharts' realm: its option normalizer uses
  // instanceof Array, which rejects array literals created in a VM context.
  const component = new Function('requestAnimationFrame', 'cancelAnimationFrame', 'echarts', 'window', 'document', source.replace('globalThis.chartComponent =', 'return '))(
    callback => (frames.push(callback), frames.length), () => {}, runtime.echarts || echarts, runtime.window, runtime.document
  );
  const instance = realInstance || {
    isDisposed: () => false,
    resize: options => calls.push(['resize', options]),
    setOption: option => calls.push(['option', option]),
    dispatchAction: action => calls.push(['action', action]),
    getOption: () => (calls.push(['getOption']), { dataZoom: [] }),
    getZr: () => ({ refreshImmediately: () => calls.push(['refresh']) })
  };
  const chart = { ...component.methods, instance, $el: { clientWidth: 360, clientHeight: 230, getBoundingClientRect: () => ({ top: 0, width: 360, height: 230 }) } };
  return { chart, calls, frame: () => frames.shift()?.() };
}

test('a data update does not resize and force-paint an unchanged chart again', () => {
  const { chart, calls, frame } = chartHarness();
  chart.update({ series: [{ data: [[1, 10]] }] });
  frame();
  calls.length = 0;
  chart.update({ series: [{ data: [[1, 11]] }] });
  frame();
  assert.deepEqual(calls.map(item => item[0]), ['option']);
  chart.$el.clientWidth = 400;
  chart.scheduleRender(true);
  frame();
  assert.equal(calls.filter(item => item[0] === 'resize').length, 1, 'real size changes still resize the canvas');
});

test('single-finger scrolling over a non-zoomable chart never clones its full option', () => {
  const { chart, calls } = chartHarness();
  chart.lastOption = { dataZoom: [] };
  chart.handleTouchStart({ touches: [{ clientX: 10, clientY: 20 }] });
  assert.equal(calls.filter(item => item[0] === 'getOption').length, 0);
});

function metricOption(ids) {
  return {
    animation: false,
    xAxis: { type: 'value' },
    yAxis: { type: 'value' },
    dataZoom: [{ type: 'inside', start: 0, end: 100 }],
    series: ids.map(id => ({ id, name: id, type: 'line', data: [[0, 10], [1, 20], [2, 15], [3, 25]] }))
  };
}

test('switching a reused chart removes every series from the previous metric', () => {
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 360, height: 230 });
  try {
    const { chart, frame } = chartHarness(instance);
    for (const ids of [['download', 'upload'], ['battery'], ['battery_temp', 'wifi_temp'], ['rsrp']]) {
      chart.update(metricOption(ids));
      frame();
      assert.deepEqual(instance.getOption().series.filter(Boolean).map(series => series.id), ids);
      assert.equal(chart.instance, instance, 'metric changes reuse the existing chart');
      assert.equal(Boolean(instance.isDisposed()), false);
    }
  } finally {
    instance.dispose();
  }
});

test('series replacement preserves the current zoom range on the reused chart', () => {
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 360, height: 230 });
  try {
    const { chart, frame } = chartHarness(instance);
    chart.update(metricOption(['download', 'upload']));
    frame();
    chart.zoomState = { start: 25, end: 75 };
    chart.update(metricOption(['battery']));
    frame();
    const zoom = instance.getOption().dataZoom[0];
    assert.equal(zoom.start, 25);
    assert.equal(zoom.end, 75);
    assert.equal(chart.instance, instance);
  } finally {
    instance.dispose();
  }
});

test('live updates and forced recovery keep hidden sensors and the legend page', () => {
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 360, height: 230 });
  try {
    const { chart, frame } = chartHarness(instance);
    const ids = Array.from({ length: 12 }, (_, index) => `sensor-${index}`);
    const option = { ...metricOption(ids), chartContext: 'temperature',
      legend: { type: 'scroll', data: ids } };
    chart.update(option);
    frame();
    instance.dispatchAction({ type: 'legendUnSelect', name: ids[0] });
    instance.dispatchAction({ type: 'legendScroll', scrollDataIndex: 4 });
    chart.update({ ...option, series: option.series.map(series => ({ ...series, data: [[0, 20], [1, 30]] })) });
    frame();
    assert.equal(instance.getOption().legend[0].selected[ids[0]], false);
    chart.$el.clientWidth = 400;
    chart.scheduleRender(true);
    frame();
    const legend = instance.getOption().legend[0];
    assert.equal(legend.selected[ids[0]], false, 'a resize/recovery must not reveal a hidden sensor');
    assert.equal(legend.scrollDataIndex, 4, 'a resize/recovery must not jump to the first legend page');
  } finally { instance.dispose(); }
});

test('changing chart context resets old axis limits and interaction state while reusing the canvas', () => {
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 360, height: 230 });
  try {
    const { chart, frame } = chartHarness(instance);
    const battery = { ...metricOption(['reading']), chartContext: 'battery',
      legend: { data: ['reading'] }, yAxis: { type: 'value', min: 0, max: 100 } };
    chart.update(battery);
    frame();
    instance.dispatchAction({ type: 'legendUnSelect', name: 'reading' });
    instance.dispatchAction({ type: 'dataZoom', start: 25, end: 75 });
    chart.update({ ...metricOption(['reading']), chartContext: 'signal-rsrp', legend: { data: ['reading'] } });
    frame();
    const option = instance.getOption();
    assert.equal(option.yAxis[0].max, undefined, 'battery percent range must not leak into signal');
    assert.notEqual(option.legend[0].selected.reading, false);
    assert.equal(option.dataZoom[0].start, 0);
    assert.equal(option.dataZoom[0].end, 100);
    assert.equal(chart.instance, instance);
  } finally { instance.dispose(); }
});

test('vertical page scrolling dismisses the tooltip once without cancelling native scroll', () => {
  const { chart, calls } = chartHarness();
  chart.lastOption = { dataZoom: [] };
  chart.handleTouchStart({ touches: [{ clientX: 10, clientY: 20 }] });
  let cancelled = 0;
  const move = y => chart.handleTouchMove({ touches: [{ clientX: 12, clientY: y }],
    stopPropagation() {}, preventDefault() { cancelled++; } });
  move(40);
  move(60);
  assert.equal(calls.filter(item => item[0] === 'action' && item[1].type === 'hideTip').length, 1);
  assert.equal(cancelled, 0);
  assert.equal(calls.filter(item => item[0] === 'getOption').length, 0);
});

test('scrolling inside an enterable tooltip keeps its rows open and leaves native scrolling alone', () => {
  const { chart, calls } = chartHarness();
  chart.lastOption = { dataZoom: [] };
  // A new tooltip touch must also forget any preceding chart gesture.
  chart.pageTouch = { x: 10, y: 10 };
  chart.handleTouchStart({ touches: [{ clientX: 10, clientY: 20 }],
    target: { closest: selector => selector === '.history-tooltip' ? {} : null } });
  let interrupted = 0;
  chart.handleTouchMove({ touches: [{ clientX: 10, clientY: 60 }],
    stopPropagation() { interrupted++; }, preventDefault() { interrupted++; } });
  assert.equal(calls.filter(item => item[0] === 'action').length, 0, 'tooltip scrolling must not dismiss its content');
  assert.equal(interrupted, 0, 'the tooltip keeps its native touch scroll');
});

test('a real browser with the uni wx shim initializes HTML tooltips with browser event support', () => {
  for (const touch of [false, true]) {
    const env = { wxa: true, domSupported: false, touchEventsSupported: true, pointerEventsSupported: false };
    const document = { nodeType: 9, documentElement: { nodeType: 1 }, createElement() {} };
    const window = { document, ...(touch ? { ontouchstart: null } : {}) };
    let initialized = false;
    const runtime = { env, init() {
      assert.equal(env.wxa, false, 'HTML tooltip construction must not take the mini-program early return');
      assert.equal(env.domSupported, true, 'the browser DOM must be available before chart construction');
      assert.equal(env.touchEventsSupported, touch, 'desktop mouse and mobile touch handling follow the real browser');
      initialized = true;
      return { isDisposed: () => false, setOption() {} };
    } };
    const { chart, frame } = chartHarness(null, { echarts: runtime, window, document });
    chart.instance = null;
    chart.update({ tooltip: { renderMode: 'html' }, series: [] });
    frame();
    assert.equal(initialized, true);
  }
});

test('actual mini-program and no-DOM environments retain their original rendering capabilities', () => {
  for (const runtime of [{}, { window: {}, document: { createElement() {} } }]) {
    const env = { wxa: true, domSupported: false, touchEventsSupported: true };
    const original = { ...env };
    const { chart } = chartHarness(null, { ...runtime, echarts: { env } });
    chart.ensureInstance();
    assert.deepEqual(env, original);
  }
});
