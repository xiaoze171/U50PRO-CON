import { formatDate } from './format.js';

export const collectionSourceLabels = Object.freeze({
  device: '设备记录',
  foreground: '前台', background: '后台', overlay: '悬浮窗', screenOff: '息屏', unknown: '未标记'
});

export function collectionSourceLabel(source) {
  return Object.hasOwn(collectionSourceLabels, source) ? collectionSourceLabels[source] : collectionSourceLabels.unknown;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function finiteNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function measurementText(value) {
  // Format only the label. Small speeds must remain nonzero, without rounding
  // the data used by the chart or inventing precision for ordinary readings.
  const number = Number(value);
  if (number !== 0 && Math.abs(number) < 0.01) return String(Number(number.toPrecision(3)));
  return number.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function historyTooltip(params) {
  const candidates = Array.isArray(params) ? params : [params];
  const validPoints = candidates.filter(item => {
    if (!Array.isArray(item?.value) || finiteNumber(item.value[1]) === null) return false;
    const timestamp = finiteNumber(item.value[0]);
    return timestamp !== null && Number.isFinite(new Date(timestamp).getTime());
  });
  if (!validPoints.length) return '';
  // At a midpoint ECharts can return equally distant readings from different
  // times. Only label samples that actually belong to the snapped axis time.
  const axisTimestamp = candidates.map(item => finiteNumber(item?.axisValue))
    .find(value => value !== null && Number.isFinite(new Date(value).getTime()));
  const timestamp = axisTimestamp ?? Number(validPoints[0].value[0]);
  const points = validPoints.filter(item => Number(item.value[0]) === timestamp);
  if (!points.length) return '';
  const time = points[0].value[2] === 'device' ? formatDate(timestamp, 'device')
    : new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
  const rows = points.map(item => {
    // ECharts marker HTML may contain external values. Build a small swatch
    // ourselves and accept only a plain hexadecimal color.
    const color = typeof item.color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(item.color)
      ? item.color : '#64748b';
    const unit = typeof item.value[3] === 'string' && item.value[3] ? ` ${escapeHtml(item.value[3])}` : '';
    const reading = `${escapeHtml(measurementText(item.value[1]))}${unit} · ${collectionSourceLabel(item.value[2])}`;
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:2px 0;line-height:1.5">'
      + `<span style="min-width:0;white-space:normal;overflow-wrap:anywhere"><span aria-hidden="true" style="display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;background-color:${color}"></span>${escapeHtml(item.seriesName)}</span>`
      + `<span style="white-space:nowrap;font-weight:600;font-variant-numeric:tabular-nums">${reading}</span></div>`;
  });
  return `<div style="margin-bottom:5px;color:#475569;font-size:11px">${escapeHtml(time)}</div>${rows.join('')}`;
}
