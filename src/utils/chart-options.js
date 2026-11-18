import { historyTooltip } from './collection-source.js';
import { TEMPERATURE_LABELS, normalizeTemperaturePoints } from './temperature.js';
import { normalizeBatteryEndpoint } from './battery-gauge.js';

const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;
const SENSOR_COLORS = Object.freeze({
  battery_temp: '#167d79', wifi_chip_temp: '#4267ed', wifi_temp_level_1: '#8b5cc4',
  wifi_temp_level_2: '#d05c94', pm_sensor_pa1: '#bb731b', pm_sensor_mdm: '#cb5666',
  pm_modem_5g: '#447ba5', cpu_temp: '#687f30', soc_temp: '#97573b',
  board_temp: '#61728b', modem_temp: '#188aa0'
});

// Input histories are already sorted by the shared minute-bucket store.
export function chartWindowPoints(points, cutoff) {
  if (!Array.isArray(points) || !points.length || Number(points.at(-1)?.[0]) < cutoff) return [];
  let low = 0, high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (Number(points[middle]?.[0]) < cutoff) low = middle + 1;
    else high = middle;
  }
  return points.slice(Math.max(0, low - 1));
}

export function temperatureSeries(histories = {}) {
  return Object.entries(SENSOR_COLORS).flatMap(([key, color]) => {
    let data = normalizeTemperaturePoints(key, histories[key]);
    // Device CSV has one canonical CPU field and keeps every recorded second,
    // including null readings. Only factory aliases share a minute bucket.
    if (key === 'cpu_temp' && !data.some(point => point[2] === 'device')) {
      const buckets = new Map();
      // Firmware aliases represent the same sensor; prefer the canonical field.
      for (const point of [...normalizeTemperaturePoints('cpu_temperature', histories.cpu_temperature), ...data]) {
        buckets.set(Math.floor(point[0] / MINUTE), point);
      }
      data = [...buckets.values()].sort((a, b) => a[0] - b[0]);
    }
    return data.some(point => point[1] != null) ? [{ id: key, name: TEMPERATURE_LABELS[key], unit: '°C', color, data }] : [];
  });
}

export function throughputSeries(histories, cutoff) {
  const down = chartWindowPoints(histories.down, cutoff), up = chartWindowPoints(histories.up, cutoff);
  let peak = 0;
  for (const points of [down, up]) for (const point of points) {
    if (Number.isFinite(point[1])) peak = Math.max(peak, point[1]);
  }
  const divisor = peak >= 1024 ** 2 ? 1024 ** 2 : peak >= 1024 ? 1024 : 1;
  const unit = divisor === 1 ? 'B/s' : divisor === 1024 ? 'KB/s' : 'MB/s';
  const convert = points => points.map(point => [point[0], point[1] == null ? null : point[1] / divisor, ...point.slice(2)]);
  return [
    { id: 'download', name: '下载', color: '#4267ed', unit, data: convert(down), area: true },
    { id: 'upload', name: '上传', color: '#167d79', unit, data: convert(up) }
  ];
}

export function batterySeries(samples = []) {
  const validPercent = item => item.percent != null && item.percent !== '' && Number.isFinite(Number(item.percent));
  const data = samples.filter(item => Number.isFinite(Number(item.timestamp))
    && (item.source === 'device' || validPercent(item)))
    .map(item => [Number(item.timestamp), validPercent(item) ? Number(item.percent) : null, item.source || 'unknown', '%',
      item.identity || JSON.stringify([item.percentSource || item.measurement?.percentageSource || 'router',
        normalizeBatteryEndpoint(item.percentEndpoint || item.measurement?.endpoint || '')])]);
  return [{ id: 'battery', name: '电量', unit: '%', color: '#167d79', area: true, data }];
}

function axisNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  if (number === 0) return '0';
  if (Math.abs(number) >= 10000) return `${Number((number / 1000).toPrecision(3))}k`;
  return String(Number(number.toPrecision(4)));
}

function buildLineSeries(item, maxGapMs = MINUTE * 1.5) {
  const input = (item.data || []).filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])));
  const data = [];
  const hasValue = point => point?.[1] != null && point[1] !== '' && Number.isFinite(Number(point[1]));
  const separated = (left, right) => !hasValue(left) || !hasValue(right)
    || Number(right[0]) - Number(left[0]) > maxGapMs || left[4] !== right[4];
  for (let index = 0; index < input.length; index++) {
    const point = input[index], previous = input[index - 1], next = input[index + 1];
    if (previous && hasValue(previous) && hasValue(point) && separated(previous, point)) {
      data.push([(Number(previous[0]) + Number(point[0])) / 2, null]);
    }
    const value = [Number(point[0]), hasValue(point) ? Number(point[1]) : null, point[2] || 'unknown', item.unit || point[3] || ''];
    const visible = hasValue(point) && (!next || (separated(previous, point) && separated(point, next)));
    data.push({ value, symbol: visible ? 'circle' : 'none', symbolSize: visible ? 6 : 0 });
  }
  return {
    id: item.id || item.name, name: item.name, type: 'line', data,
    encode: { x: 0, y: 1 }, yAxisIndex: item.axis || 0,
    showSymbol: true, showAllSymbol: true, symbol: 'circle', symbolSize: 0,
    smooth: false, connectNulls: false, clip: true,
    lineStyle: { width: 2.4, cap: 'round', join: 'round', color: item.color },
    itemStyle: { color: item.color, borderColor: '#ffffff', borderWidth: 1.5 },
    emphasis: { focus: 'series', lineStyle: { width: 3.2 }, scale: 1.4 },
    areaStyle: item.area ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [{ offset: 0, color: `${item.color}26` }, { offset: 1, color: `${item.color}00` }] } } : undefined
  };
}

export function lineOption(input, dualAxis = false, range = {}, behavior = {}) {
  const timestamp = behavior.now ?? Date.now();
  const now = behavior.deviceTime ? timestamp : Math.ceil(timestamp / MINUTE) * MINUTE;
  const windowMs = Number(behavior.windowMs) || DAY;
  const series = input.map(item => ({ ...item, data: chartWindowPoints(item.data, now - windowMs) }));
  const hasData = series.some(item => item.data.some(point => point[1] != null && Number.isFinite(Number(point[1]))));
  const axis = (limits, unit, secondary = false) => ({
    type: 'value', scale: limits.min == null, ...limits, splitNumber: 4,
    name: unit || '', nameLocation: 'end', nameGap: 14,
    nameTextStyle: { color: '#526177', fontSize: 11, align: 'left', padding: [0, 0, 0, 2] },
    axisLabel: { color: '#526177', fontSize: 11, margin: 10, formatter: axisNumber },
    axisTick: { show: false }, axisLine: { show: false },
    splitLine: { show: !secondary, lineStyle: { color: 'rgba(71,85,105,.12)', type: 'dashed' } }
  });
  return {
    chartContext: behavior.context || input.map(item => item.id || item.name).join('|'),
    useUTC: !!behavior.deviceTime,
    animation: false,
    color: series.map(item => item.color),
    grid: { left: 10, right: 16, top: 66, bottom: windowMs > 12 * 60 * MINUTE ? 12 : 16, containLabel: true },
    tooltip: {
      className: 'history-tooltip', renderMode: 'html', trigger: 'axis', triggerOn: 'mousemove|click', confine: true,
      enterable: true, transitionDuration: 0, hideDelay: 120, formatter: historyTooltip,
      backgroundColor: '#ffffff', borderColor: '#dde5ef', borderWidth: 1, padding: [9, 11],
      textStyle: { color: '#26364b', fontSize: 12 },
      extraCssText: 'max-width:calc(100% - 8px);max-height:72%;overflow-y:auto;box-sizing:border-box;overscroll-behavior:contain;border-radius:10px;box-shadow:0 5px 18px rgba(23,43,69,.13);',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#8291a6', width: 1, type: 'dashed' } }
    },
    legend: {
      id: 'history-legend', type: 'scroll', top: 2, left: 4, right: 4,
      icon: 'roundRect', itemWidth: 16, itemHeight: 5, itemGap: 15,
      textStyle: { color: '#43536a', fontSize: 12 },
      pageIconSize: 12, pageIconColor: '#4267ed', pageIconInactiveColor: '#c6ceda',
      pageTextStyle: { color: '#526177', fontSize: 11 }, animation: false
    },
    xAxis: {
      type: 'time', min: now - windowMs, max: now, boundaryGap: false, splitNumber: 3,
      axisLabel: { color: '#526177', fontSize: 11, hideOverlap: true, showMinLabel: false,
        showMaxLabel: true, margin: 12, lineHeight: 16,
        formatter: value => {
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return '';
          const field = name => date[`${behavior.deviceTime ? 'getUTC' : 'get'}${name}`]();
          const time = `${String(field('Hours')).padStart(2, '0')}:${String(field('Minutes')).padStart(2, '0')}`;
          return windowMs > 12 * 60 * MINUTE ? `${field('Month') + 1}/${field('Date')}\n${time}` : time;
        }
      },
      axisTick: { show: false }, axisLine: { lineStyle: { color: '#d9e1eb' } }, splitLine: { show: false }
    },
    yAxis: dualAxis ? [axis(behavior.yAxisRanges?.[0] || {}, series[0]?.unit),
      axis(behavior.yAxisRanges?.[1] || {}, series[1]?.unit, true)] : [axis(range, behavior.unit || series[0]?.unit)],
    dataZoom: [],
    graphic: [{ id: 'empty-history', type: 'text', left: 'center', top: 'middle', silent: true,
      invisible: hasData, style: { text: '此时段暂无有效采样', fill: '#67768b', fontSize: 13 } }],
    series: series.map(item => buildLineSeries(item, behavior.maxGapMs || MINUTE * 1.5))
  };
}
