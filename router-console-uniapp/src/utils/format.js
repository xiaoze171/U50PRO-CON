export function firstValue(...values) {
  for (const value of values) if (value !== undefined && value !== null && value !== '') return value;
  return '—';
}

export function operatorName(raw, mcc, mnc) {
  const source = String(raw ?? '').trim();
  const compact = source.replace(/[ -]/g, '');
  const numericCode = /^460(?:0\d|1\d|2\d|3\d|5\d|6\d|7\d|8\d|9\d)$/.test(compact) ? compact.slice(3) : '';
  const carrierByMnc = {
    '00': '中国移动', '02': '中国移动', '04': '中国移动', '07': '中国移动', '08': '中国移动', '13': '中国移动',
    '01': '中国联通', '06': '中国联通', '09': '中国联通', '10': '中国联通', '11': '中国电信', '20': '中国铁通',
    '03': '中国电信', '05': '中国电信'
  };
  if (String(mcc ?? '').trim() === '460' && carrierByMnc[String(mnc ?? '').trim()]) return carrierByMnc[String(mnc ?? '').trim()];
  if (/^460\d{2}$/.test(compact) && carrierByMnc[compact.slice(3)]) return carrierByMnc[compact.slice(3)];
  if (source && /[\u3400-\u9fff]/.test(source)) return source;
  if (source && /[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßäåæçèéêëìíîïðñòóôõö÷øùúûüýþ]/.test(source) && typeof TextDecoder !== 'undefined') {
    try {
      const bytes = Uint8Array.from([...source].map(char => char.charCodeAt(0) & 0xff));
      const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (/[\u3400-\u9fff]/.test(repaired)) return repaired;
    } catch {}
  }
  return source || '未知运营商';
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
