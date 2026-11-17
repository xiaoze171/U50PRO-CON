// 历史数据的共享合并/归一工具（无平台依赖，Vue 前端与 Node/Electron 主进程都能直接复用）。
//
// 关键性质：所有历史都按“分钟桶”存储，因此多设备合并 = 各分钟桶取并集、后写覆盖，
// 天然幂等、无冲突。这是局域网互通能把多台设备的碎片曲线拼成完整曲线的基础。
//
// 由 index.vue（图表历史）、router-client.js（电池历史）、services/sync.js（跨设备合并）、
// desktop 主进程（常驻采集器）四处共享。

import { normalizeTemperaturePoints, temperatureReading } from './temperature.js';
import { sanitizeBatteryMeasurement, normalizeBatteryEndpoint } from './battery-gauge.js';
import { batteryMeasurementIdentity, normalizeBatteryCurrentStats, sameBatteryIdentity } from './battery-current-window.js';

export const MINUTE_MS = 60 * 1000;

// 与 utils/format.js 的 numeric 完全一致，不引入展示层依赖。
function numeric(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// 把 [[ts,val],...] 序列按分钟桶归一：并集、后写覆盖、按时间升序、可限长。
// 传入拼接后的多来源即等于“跨设备合并”。
export function normalizePoints(list, options = {}) {
  const { cutoff = 0, sampleMs = MINUTE_MS, maxPoints = Infinity } = options;
  if (!Array.isArray(list)) return [];
  const buckets = new Map();
  list.forEach(item => {
    const timestamp = Number(item?.[0]);
    const pointValue = numeric(item?.[1]);
    if (!Number.isFinite(timestamp) || timestamp < cutoff || pointValue == null) return;
    const bucketTime = Math.floor(timestamp / sampleMs) * sampleMs;
    const point = [bucketTime, pointValue];
    if (typeof item[2] === 'string') point.push(item[2]);
    buckets.set(bucketTime, point);
  });
  const points = [...buckets.values()].sort((left, right) => left[0] - right[0]);
  return Number.isFinite(maxPoints) ? points.slice(-maxPoints) : points;
}

// 合并任意多个同名 [[ts,val],...] 序列（并集）。
export function mergePoints(seriesList, options = {}) {
  const all = [];
  (Array.isArray(seriesList) ? seriesList : []).forEach(series => {
    if (Array.isArray(series)) all.push(...series);
  });
  return normalizePoints(all, options);
}

export const CHART_SERIES_KEYS = ['rsrp', 'sinr', 'rsrq', 'down', 'up'];

export function emptyChartHistory() {
  return { rsrp: [], sinr: [], rsrq: [], down: [], up: [], temperatures: {} };
}

// 合并图表历史结构 {rsrp,sinr,rsrq,down,up,temperatures:{}}（每条序列各自按分钟桶并集）。
export function mergeChartHistory(left, right, options = {}) {
  const a = left && typeof left === 'object' ? left : {};
  const b = right && typeof right === 'object' ? right : {};
  const out = emptyChartHistory();
  CHART_SERIES_KEYS.forEach(key => { out[key] = mergePoints([a[key], b[key]], options); });
  const aTemps = a.temperatures && typeof a.temperatures === 'object' && !Array.isArray(a.temperatures) ? a.temperatures : {};
  const bTemps = b.temperatures && typeof b.temperatures === 'object' && !Array.isArray(b.temperatures) ? b.temperatures : {};
  const temperatures = {};
  new Set([...Object.keys(aTemps), ...Object.keys(bTemps)]).forEach(key => {
    const merged = mergePoints([
      normalizeTemperaturePoints(key, aTemps[key]), normalizeTemperaturePoints(key, bTemps[key])
    ], options);
    if (merged.length) temperatures[key] = merged;
  });
  out.temperatures = temperatures;
  return out;
}

// 同一分钟内的不同电量来源/地址保留为独立样本。
// 从 router-client.js 抽取并参数化；sources 为一个或多个样本数组。
export function mergeBatterySamples(sources, options = {}) {
  const { cutoff = 0, maxPoints = Infinity } = options;
  const buckets = new Map();
  const all = [];
  (Array.isArray(sources) ? sources : []).forEach(list => {
    if (Array.isArray(list)) all.push(...list);
  });
  all.forEach(item => {
    const timestamp = Number(item?.timestamp);
    const percent = numeric(item?.percent);
    if (!Number.isFinite(timestamp) || timestamp < cutoff || percent == null) return;
    const charging = typeof item?.charging === 'boolean' ? item.charging : null;
    const measurement = sanitizeBatteryMeasurement(item.measurement);
    const identity = batteryMeasurementIdentity({ measurement });
    const candidateStats = normalizeBatteryCurrentStats(item.currentStats);
    const currentStats = candidateStats && identity && sameBatteryIdentity(candidateStats.identity, identity) ? candidateStats : null;
    const measurementIdentity = identity ? JSON.stringify(identity) : 'legacy';
    const key = currentStats ? 'block:' + currentStats.blockId : JSON.stringify([
      Math.floor(timestamp / MINUTE_MS), charging, item.percentSource || measurement?.percentageSource || 'router',
      normalizeBatteryEndpoint(item.percentEndpoint || measurement?.endpoint || ''), measurementIdentity
    ]);
    const previous = buckets.get(key);
    if (currentStats && previous?.currentStats && (previous.currentStats.revision > currentStats.revision
        || previous.currentStats.revision === currentStats.revision && previous.timestamp > timestamp)) return;
    const temperature = temperatureReading('battery_temp', item?.temperature).value;
    // Each record is atomic: legacy fields cannot inherit another reading's current or identity.
    buckets.set(key, { ...item, timestamp, percent, charging, temperature, measurement, currentStats, measurementIdentity });
  });
  const samples = [...buckets.values()].sort((left, right) => left.timestamp - right.timestamp);
  return Number.isFinite(maxPoints) ? samples.slice(-maxPoints) : samples;
}
