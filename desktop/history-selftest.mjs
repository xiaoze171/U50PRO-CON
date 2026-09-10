// 历史合并的纯逻辑自测（无需 Electron/路由器/显示器）。
// 运行：node desktop/history-selftest.mjs
// 这是“局域网互通消除断层”的地基：多设备碎片按分钟桶取并集 = 完整曲线，且幂等无冲突。
import {
  MINUTE_MS, normalizePoints, mergePoints, mergeChartHistory,
  mergeBatterySamples, emptyChartHistory, CHART_SERIES_KEYS
} from '../src/utils/history.js';

let passed = 0, failed = 0;
function check(name, condition) {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const M = MINUTE_MS;
const t0 = Math.floor(Date.now() / M) * M; // 对齐到分钟桶

console.log('== normalizePoints ==');

// 同一分钟内多点 → 后写覆盖为单桶
check('同分钟多点归一为 1 桶（后写覆盖）', (() => {
  const out = normalizePoints([[t0 + 1000, -100], [t0 + 5000, -95]]);
  return out.length === 1 && out[0][0] === t0 && out[0][1] === -95;
})());

// 升序排序
check('输出按时间升序', (() => {
  const out = normalizePoints([[t0 + M, 2], [t0, 1], [t0 + 2 * M, 3]]);
  return eq(out, [[t0, 1], [t0 + M, 2], [t0 + 2 * M, 3]]);
})());

// cutoff 丢弃过旧桶
check('cutoff 丢弃早于阈值的桶', (() => {
  const out = normalizePoints([[t0 - 10 * M, 1], [t0, 2]], { cutoff: t0 - 5 * M });
  return out.length === 1 && out[0][0] === t0;
})());

// 非有限值/空值被剔除
check('剔除非数值点', (() => {
  const out = normalizePoints([[t0, null], [t0 + M, 'x'], [t0 + 2 * M, 7]]);
  return out.length === 1 && out[0][1] === 7;
})());

// maxPoints 保留最近 N 桶
check('maxPoints 保留最近 N 桶', (() => {
  const out = normalizePoints([[t0, 1], [t0 + M, 2], [t0 + 2 * M, 3]], { maxPoints: 2 });
  return eq(out, [[t0 + M, 2], [t0 + 2 * M, 3]]);
})());

console.log('== mergePoints（跨设备并集）==');

// 关键场景：设备 A 有 [t0, t0+2M]，设备 B 有 [t0+M]（A 的空洞）→ 并集补齐为连续三桶
check('并集补齐断层（A 缺 t0+M，B 提供）', (() => {
  const a = [[t0, 1], [t0 + 2 * M, 3]];
  const b = [[t0 + M, 2]];
  const out = mergePoints([a, b]);
  return eq(out, [[t0, 1], [t0 + M, 2], [t0 + 2 * M, 3]]);
})());

// 幂等：重复并入同一片段不改变结果（回补可安全重放）
check('幂等：重复并入同一片段结果不变', (() => {
  const a = [[t0, 1], [t0 + M, 2]];
  const b = [[t0 + M, 2], [t0 + 2 * M, 3]];
  const once = mergePoints([a, b]);
  const twice = mergePoints([once, b]);
  const thrice = mergePoints([twice, b]);
  return eq(once, twice) && eq(twice, thrice);
})());

// 重叠桶后写覆盖（合并顺序决定同桶取值）
check('重叠桶后写覆盖', (() => {
  const out = mergePoints([[[t0, 1]], [[t0, 9]]]);
  return out.length === 1 && out[0][1] === 9;
})());

console.log('== mergeChartHistory ==');

check('图表各序列独立并集 + 温度子序列合并', (() => {
  const left = { rsrp: [[t0, -100]], sinr: [[t0, 10]], rsrq: [], down: [[t0, 500]], up: [], temperatures: { cpu: [[t0, 40]] } };
  const right = { rsrp: [[t0 + M, -95]], sinr: [], rsrq: [[t0, 8]], down: [], up: [[t0, 100]], temperatures: { cpu: [[t0 + M, 42]], modem: [[t0, 55]] } };
  const out = mergeChartHistory(left, right);
  return out.rsrp.length === 2 && out.rsrp[1][1] === -95
    && out.sinr.length === 1 && out.rsrq.length === 1
    && out.down.length === 1 && out.up.length === 1
    && out.temperatures.cpu.length === 2 && out.temperatures.modem.length === 1;
})());

check('空历史结构安全（不抛异常，返回空骨架）', (() => {
  const out = mergeChartHistory(null, undefined);
  return CHART_SERIES_KEYS.every(k => Array.isArray(out[k]) && out[k].length === 0)
    && out.temperatures && Object.keys(out.temperatures).length === 0;
})());

check('mergeChartHistory 幂等', (() => {
  const a = emptyChartHistory(); a.rsrp = [[t0, -100]];
  const b = emptyChartHistory(); b.rsrp = [[t0 + M, -95]];
  const once = mergeChartHistory(a, b);
  const twice = mergeChartHistory(once, b);
  return eq(once, twice);
})());

console.log('== mergeBatterySamples ==');

// 同一分钟、不同充电状态 → 两个桶（充电与否分开记录）
check('同分钟不同充电态 → 分桶', (() => {
  const out = mergeBatterySamples([[
    { timestamp: t0 + 1000, percent: 80, charging: false },
    { timestamp: t0 + 2000, percent: 81, charging: true }
  ]]);
  return out.length === 2;
})());

// 跨设备电池并集补齐 + 幂等
check('电池跨设备并集补齐断层', (() => {
  const a = [{ timestamp: t0, percent: 80, charging: false }, { timestamp: t0 + 2 * M, percent: 78, charging: false }];
  const b = [{ timestamp: t0 + M, percent: 79, charging: false }];
  const out = mergeBatterySamples([a, b]);
  return out.length === 3 && out[0].timestamp === t0 && out[2].timestamp === t0 + 2 * M;
})());

check('电池合并幂等（重复回补不重复计数）', (() => {
  const a = [{ timestamp: t0, percent: 80, charging: false }];
  const b = [{ timestamp: t0 + M, percent: 79, charging: false }];
  const once = mergeBatterySamples([a, b]);
  const twice = mergeBatterySamples([once, b]);
  return once.length === 2 && eq(once, twice);
})());

check('电池同桶后写覆盖 percent', (() => {
  const out = mergeBatterySamples([[
    { timestamp: t0 + 1000, percent: 80, charging: false },
    { timestamp: t0 + 30000, percent: 83, charging: false }
  ]]);
  return out.length === 1 && out[0].percent === 83;
})());

check('电池 cutoff 丢弃过旧样本', (() => {
  const out = mergeBatterySamples([[
    { timestamp: t0 - 100 * M, percent: 50, charging: false },
    { timestamp: t0, percent: 60, charging: false }
  ]], { cutoff: t0 - 10 * M });
  return out.length === 1 && out[0].percent === 60;
})());

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) { console.log('HISTORY_SELFTEST_FAIL'); process.exit(1); }
console.log('HISTORY_SELFTEST_ALL_PASS');
