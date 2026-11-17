const TIME_STATES = {
  collecting: '采集中',
  'low-current': '待估算',
  tapering: '缓充中',
  confirming: '满充确认中',
  full: '已充满',
  'low-battery': '请尽快充电'
};
const INACTIVE_REASONS = new Set(['未充电', '未净充电', '充电中', '外接供电', '拔电后估算', '满充确认中']);

function validMinutes(minutes) {
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0;
}

/** Format one independent result without turning absent minutes into zero. */
export function formatBatteryTime(result) {
  if (!result || result.state !== 'estimated') return Object.hasOwn(TIME_STATES, result?.state) ? TIME_STATES[result.state] : '—';
  if (!validMinutes(result.minutes)) return '—';
  if (result.minutes === 0) return '0 分钟';
  if (result.minutes < 5) return '少于 5 分钟';
  if (result.minutes > 4320) return '超过 72 小时';
  const rounded = Math.round(result.minutes / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (!hours) return `约 ${minutes} 分钟`;
  return minutes ? `约 ${hours} 小时 ${minutes} 分钟` : `约 ${hours} 小时`;
}

/** Home hints accept known user-facing reasons; raw interface errors stay in details. */
export function batteryTimeReason(result) {
  if (!result) return '读数不可用';
  switch (result.state) {
    case 'estimated': return validMinutes(result.minutes) ? '' : '待估算';
    case 'not-applicable': return INACTIVE_REASONS.has(result.reason) ? result.reason : '';
    case 'external': return INACTIVE_REASONS.has(result.reason) ? result.reason : result.targetPercent === 0 ? '拔电后估算' : '外接供电';
    case 'tapering': return '充满时间随电流变化';
    case 'collecting': return '等待有效采样';
    case 'low-current': return '电流较低';
    case 'unknown': return '状态待确认';
    case 'unavailable': return result.reason === '待刷新' ? '待刷新' : '读数不可用';
    default: return '';
  }
}

/** The normalized battery mode has priority over the presence of a USB connection. */
export function batteryModeText(measurement) {
  if (!measurement) return '暂无读数';
  switch (measurement.mode) {
    case 'charging': return '充电中';
    case 'discharging': return measurement.externalPower === true ? '插电 · 仍在放电' : '放电中';
    case 'external': return '外接供电';
    case 'full': return measurement.fullConfirmed === true ? '已充满' : '满充确认中';
    case 'confirming': return '满充确认中';
    default: return '状态待确认';
  }
}
