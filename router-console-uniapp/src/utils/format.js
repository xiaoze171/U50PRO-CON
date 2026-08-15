export function firstValue(...values) {
  for (const value of values) if (value !== undefined && value !== null && value !== '') return value;
  return '—';
}

export function numeric(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function withUnit(value, suffix = '') {
  return value === '—' || value === '' || value == null ? '—' : `${value}${suffix}`;
}

export function formatBytes(raw) {
  const number = numeric(raw);
  if (number == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = number;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

export function bytesPerSecond(raw) {
  const number = numeric(raw);
  if (number == null) return '—';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = number;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDuration(raw) {
  const total = numeric(raw);
  if (total == null) return '—';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  return `${days ? `${days}天 ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatHours(hours) {
  if (!Number.isFinite(hours)) return '数据不足';
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return `${whole}小时 ${minutes}分钟`;
}

export function formatMonth(raw) {
  const value = String(raw || '');
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}` : firstValue(raw);
}

export function formatDate(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export function displayPci(nrRaw, lteRaw) {
  if (nrRaw !== undefined && nrRaw !== null && nrRaw !== '') {
    const text = String(nrRaw).trim();
    const parsed = Number.parseInt(text, /[a-f]/i.test(text) ? 16 : 10);
    return Number.isInteger(parsed) ? parsed : nrRaw;
  }
  return firstValue(lteRaw);
}

export function compactEntries(object) {
  return Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== '—');
}
