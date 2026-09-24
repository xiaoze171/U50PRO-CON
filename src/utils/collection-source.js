export const collectionSourceLabels = Object.freeze({
  foreground: '前台', background: '后台', overlay: '悬浮窗', screenOff: '息屏', unknown: '未标记'
});

export function collectionSourceLabel(source) {
  return Object.hasOwn(collectionSourceLabels, source) ? collectionSourceLabels[source] : collectionSourceLabels.unknown;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function historyTooltip(params) {
  const points = (Array.isArray(params) ? params : [params]).filter(item => Array.isArray(item?.value));
  if (!points.length) return '';
  const timestamp = Number(points[0].value[0]);
  const time = Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '';
  return [escapeHtml(time), ...points.map(item =>
    `${escapeHtml(item.seriesName)}：${escapeHtml(item.value[1])} · ${collectionSourceLabel(item.value[2])}`
  )].join('<br/>');
}
