import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/components/AppChart.vue', import.meta.url), 'utf8')
  .split('<script module="chart" lang="renderjs">')[1].split('</script>')[0]
  .replace(/import[^;]+;/, '').replace('export default', 'globalThis.chartComponent =');

function chartHarness() {
  const frames = [];
  const calls = [];
  const context = { requestAnimationFrame: callback => (frames.push(callback), frames.length), cancelAnimationFrame() {}, setTimeout, clearTimeout };
  runInNewContext(source, context);
  const instance = {
    isDisposed: () => false,
    resize: options => calls.push(['resize', options]),
    setOption: option => calls.push(['option', option]),
    getOption: () => (calls.push(['getOption']), { dataZoom: [] }),
    getZr: () => ({ refreshImmediately: () => calls.push(['refresh']) })
  };
  const chart = { ...context.chartComponent.methods, instance, $el: { clientWidth: 360, clientHeight: 230, getBoundingClientRect: () => ({ top: 0, width: 360, height: 230 }) } };
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
