import { sanitizeBatteryMeasurement } from './battery-gauge.js';
import { batteryTimeResult as timeResult, initializeBatteryTimeResults } from './battery-time-state.js';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 50000;
const REQUIRED = ['ts', 'soc', 'voltage_mv', 'current_ma', 'power_w', 'temp_c', 'status'];
const OPTIONAL = ['ts_iso', 'usb_online', 'input_voltage_mv', 'input_current_ma', 'input_power_w'];
const NUMERIC = ['ts', 'soc', 'voltage_mv', 'current_ma', 'power_w', 'temp_c'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const numeric = value => typeof value === 'string' && numberPattern.test(value.trim())
  && finite(Number(value.trim())) ? Number(value.trim()) : null;

function utf8Length(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
    if (bytes > MAX_BYTES) throw new Error('Battery CSV byte limit exceeded');
  }
  return bytes;
}

function parseRecord(cells, headers) {
  if (cells.length > headers.length) return null;
  const row = {};
  for (let index = 0; index < headers.length; index++) {
    const name = headers[index];
    if (!REQUIRED.includes(name) && !OPTIONAL.includes(name)) continue;
    const value = cells[index]?.trim() ?? '';
    if (NUMERIC.includes(name)) {
      row[name] = numeric(value);
      if (row[name] === null) return null;
    } else if (name === 'status') {
      if (!value) return null;
      row[name] = value;
    } else if (name === 'ts_iso') row[name] = cells[index] ?? '';
    else {
      row[name] = value ? numeric(value) : null;
      if (value && row[name] === null || name === 'usb_online' && row[name] !== null
        && row[name] !== 0 && row[name] !== 1) return null;
    }
  }
  if (!Number.isSafeInteger(row.ts) || row.ts < 0 || row.soc < 0 || row.soc > 100 || row.voltage_mv <= 0) return null;
  for (const name of OPTIONAL) if (!Object.hasOwn(row, name)) row[name] = null;
  return row;
}

// An invalid data record stays in its original position as null. Consumers must
// never join the valid records on either side of that boundary.
export function parseBatteryCsv(text) {
  if (typeof text !== 'string') throw new Error('Battery CSV must be text');
  utf8Length(text);
  if (text.startsWith('\ufeff')) text = text.slice(1);
  let headers = null, invalidRows = 0;
  const rows = [];
  function accept(cells) {
    if (!headers) {
      headers = cells.map(value => value.trim());
      for (const name of REQUIRED) {
        if (headers.filter(value => value === name).length !== 1) throw new Error('Battery CSV missing or duplicate required header');
      }
      for (const name of OPTIONAL) {
        if (headers.filter(value => value === name).length > 1) throw new Error('Battery CSV duplicate header');
      }
      return;
    }
    if (rows.length >= MAX_RECORDS) throw new Error('Battery CSV record limit exceeded');
    const row = parseRecord(cells, headers);
    if (!row) invalidRows++;
    rows.push(row);
  }
  let cells = [], start = 0, quoted = false, closed = false, fragments = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') continue;
      fragments.push(text.slice(start, index));
      if (text[index + 1] === '"') { fragments.push('"'); start = index + 2; index++; }
      else { quoted = false; closed = true; }
      continue;
    }
    if (char === '"') {
      if (index !== start || closed) throw new Error('Battery CSV malformed quote');
      quoted = true; start = index + 1; continue;
    }
    const delimiter = char === ',' || char === '\r' || char === '\n';
    if (closed && !delimiter) throw new Error('Battery CSV characters after quoted field');
    if (!delimiter) continue;
    cells.push(closed ? fragments.join('') : text.slice(start, index));
    fragments = []; closed = false;
    if (char !== ',') {
      accept(cells); cells = [];
      if (char === '\r' && text[index + 1] === '\n') index++;
    }
    start = index + 1;
  }
  if (quoted) throw new Error('Battery CSV unterminated quoted field');
  if (start < text.length || cells.length || closed) {
    cells.push(closed ? fragments.join('') : text.slice(start));
    accept(cells);
  }
  if (!headers) throw new Error('Battery CSV missing header');
  return { rows, invalidRows };
}

function recordMode(row) {
  if (!row || !finite(row.current_ma)) return 'unknown';
  if (row.status === 'Charging' && row.current_ma > -50) return 'charging';
  if (row.status === 'Discharging' && row.current_ma < 50) return 'discharging';
  if (row.status === 'Not charging' && row.current_ma <= -50) return 'discharging';
  return 'unknown';
}

function compatibleRow(row, mode, sign) {
  return row && finite(row.ts) && finite(row.soc) && finite(row.power_w)
    && recordMode(row) === mode && row.current_ma * sign > -50 && row.power_w * sign >= 0;
}

function correction(fromSoc, toSoc, fromCurrent, toCurrent, seconds, capacity, sign) {
  const expected = finite(capacity) && capacity > 0
    ? Math.abs((fromCurrent / 2 + toCurrent / 2) * seconds / 3600 / capacity * 100) : 0;
  const delta = toSoc - fromSoc;
  return Math.abs(delta) > Math.max(0.5, 3 * expected + 0.15) || delta * sign < -0.15;
}

// All freshness calculations below use the state.json device clock. The live
// marker has its own freshness check before it is normalized into measurement.
// CSV has no boot/capacity identity; only an actual live uptime can bound a boot.
export function analyzeBatteryCsv({ csv, measurement: rawMeasurement, deviceNowSeconds } = {}) {
  const measurement = sanitizeBatteryMeasurement(rawMeasurement);
  const analysis = { state: 'unavailable', reason: 'missing', points: 0, windowSeconds: 0,
    invalidRows: Number.isSafeInteger(csv?.invalidRows) && csv.invalidRows >= 0 ? csv.invalidRows : 0,
    lastTimestampSeconds: null, socMovement: 0, energyWh: 0 };
  const unavailable = reason => ({ ...analysis, state: 'unavailable', reason });
  const collecting = reason => ({ ...analysis, state: 'collecting', reason });
  if (!measurement) return unavailable('live-measurement');
  if (!csv || !Array.isArray(csv.rows) || csv.rows.length === 0) return unavailable('missing');
  const last = csv.rows.at(-1);
  if (!last || !finite(last.ts)) return unavailable('invalid-latest');
  analysis.lastTimestampSeconds = last.ts;
  const age = deviceNowSeconds - last.ts;
  if (!finite(deviceNowSeconds) || deviceNowSeconds < 0 || age < 0) return unavailable('device-time');
  if (age > 120) return unavailable('stale');
  if (!finite(measurement.netCurrentMa)) return unavailable('live-current');
  const mode = measurement.mode, sign = mode === 'charging' ? 1 : -1;
  if (!['charging', 'discharging'].includes(mode)) return collecting('inactive');
  const bootStart = finite(measurement.sampleMonoSeconds) ? deviceNowSeconds - measurement.sampleMonoSeconds : -Infinity;
  if (last.ts < bootStart) return collecting('reboot');
  if (!compatibleRow(last, mode, sign) || measurement.netCurrentMa * sign <= -50
    || finite(measurement.netPowerW) && measurement.netPowerW * sign < 0
    || correction(last.soc, measurement.rawSoc, last.current_ma, measurement.netCurrentMa,
      age, measurement.usableCapacityMah, sign)
    || Math.abs(last.current_ma - measurement.netCurrentMa) > Math.max(100,
      0.5 * Math.max(Math.abs(last.current_ma), Math.abs(measurement.netCurrentMa)))) return collecting('live-discontinuity');
  let segment = [];
  for (const row of csv.rows) {
    if (!compatibleRow(row, mode, sign) || row.ts < bootStart) { segment = []; continue; }
    const previous = segment.at(-1);
    if (previous) {
      const interval = row.ts - previous.ts;
      if (interval <= 0 || interval > 120
        || correction(previous.soc, row.soc, previous.current_ma, row.current_ma,
          interval, measurement.usableCapacityMah, sign)) segment = [];
    }
    segment.push(row);
  }
  // Use observed CSV points; do not invent a partial record at the cutoff.
  segment = segment.filter(row => row.ts >= last.ts - 7200);
  analysis.points = segment.length;
  if (segment.length) {
    analysis.windowSeconds = last.ts - segment[0].ts;
    analysis.socMovement = (last.soc - segment[0].soc) * sign;
    for (let index = 1; index < segment.length; index++) {
      const from = segment[index - 1], to = segment[index];
      analysis.energyWh += (from.power_w / 2 + to.power_w / 2) * sign * (to.ts - from.ts) / 3600;
    }
  }
  if (analysis.points < 31 || analysis.windowSeconds < 3600) return collecting('short-window');
  if (analysis.socMovement + 1e-9 < 0.2) return collecting('soc-movement');
  if (analysis.energyWh + 1e-9 < 0.05) return collecting('energy');
  return { ...analysis, state: 'ready', reason: '' };
}

const reasons = {
  missing: 'CSV日志未获取', stale: 'CSV日志已过期', 'device-time': 'CSV设备时间异常',
  'invalid-latest': 'CSV最新记录无效', 'live-measurement': '实时电量不可用',
  'live-current': '实时电流不可用', 'live-discontinuity': 'CSV与实时状态不连续',
  reboot: '等待重启后CSV记录', 'short-window': 'CSV有效记录不足一小时',
  'soc-movement': 'CSV电量变化不足', energy: 'CSV能量变化不足', inactive: '当前状态不适用'
};

export function estimateCsvBatteryTimes({ csv, measurement: rawMeasurement, deviceNowSeconds, calculatedAt = Date.now() } = {}) {
  const measurement = sanitizeBatteryMeasurement(rawMeasurement);
  const csvAnalysis = analyzeBatteryCsv({ csv, measurement, deviceNowSeconds });
  const output = {
    timeToFull: timeResult('unavailable', reasons[csvAnalysis.reason] || 'CSV日志不可用', 100),
    runtime: timeResult('unavailable', reasons[csvAnalysis.reason] || 'CSV日志不可用', 0),
    calculatedAt, windowSeconds: csvAnalysis.windowSeconds, csvAnalysis
  };
  if (!measurement || !finite(calculatedAt)) return output;
  const mode = measurement.mode;
  const { canEstimate, ...timeStates } = initializeBatteryTimeResults(measurement);
  Object.assign(output, timeStates);
  if (canEstimate) {
    const charging = mode === 'charging', sign = charging ? 1 : -1;
    const key = charging ? 'timeToFull' : 'runtime', target = charging ? 100 : 0;
    const current = measurement.netCurrentMa;
    if (finite(current) && current * sign <= -50) output[key] = timeResult('unknown', '状态待确认', target);
    else if (finite(current) && Math.abs(current) < 50) output[key] = timeResult('low-current', '待估算', target);
    else if (charging && measurement.rawSoc >= 95) output[key] = timeResult('tapering', '充满时间随电流变化', target);
    else if (csvAnalysis.state === 'ready') {
      const delta = charging ? 100 - measurement.rawSoc : measurement.rawSoc;
      const minutes = delta / csvAnalysis.socMovement * csvAnalysis.windowSeconds / 60;
      output[key] = finite(minutes) ? timeResult('estimated', '', target, minutes, 'device-csv')
        : timeResult('unavailable', 'CSV估算不可用', target);
    } else output[key] = timeResult(csvAnalysis.state, reasons[csvAnalysis.reason] || 'CSV日志不可用', target);
  }
  if (measurement.eodImminent || measurement.eodClamp) output.runtime = timeResult('low-battery', '请尽快充电', 0);
  return output;
}
