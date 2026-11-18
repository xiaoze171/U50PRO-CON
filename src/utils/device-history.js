import { normalizeBatteryEndpoint } from './battery-gauge.js';

const MAX_GAP_MS = 120000;
const SIGNAL_FIELDS = {
  lte_rsrp: ['lte_rsrp_dbm', 'dBm'], lte_rsrq: ['lte_rsrq_db', 'dB'], lte_snr: ['lte_snr_db', 'dB'],
  nr_rsrp: ['nr_rsrp_dbm', 'dBm'], nr_rsrq: ['nr_rsrq_db', 'dB'], nr_sinr: ['nr_sinr_db', 'dB']
};
const TEMPERATURE_FIELDS = {
  battery_temp: 'temp_c', cpu_temp: 'cpu_temp_c', pm_sensor_mdm: 'modem_temp_c', pm_sensor_pa1: 'pa_temp_c'
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const metric = value => finite(value) ? value : null;

// Device ts is a pseudo Unix clock, observed about eight hours ahead of UTC.
// UTC fields are a timezone-neutral coordinate for the device's wall clock,
// never a conversion to an instant. Raw device seconds remain sample identity.
function calendarTimestamp(text) {
  if (typeof text !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (year < 100) calendar.setUTCFullYear(year);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour
    || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) return null;
  return calendar.getTime();
}

function stateEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    url.pathname = '/state.json';
    return normalizeBatteryEndpoint(url.toString());
  } catch { return ''; }
}

function throughput(row, field) {
  return finite(row.net_interval_s) && row.net_interval_s > 0
    && finite(row[field]) && row[field] >= 0 ? row[field] : null;
}

// Rows stay in file order. Reversed clocks discard the earlier prefix instead
// of sorting it into a later boot/clock segment. Diagnostics account for every
// discarded record; invalid rows create boundaries without invented samples.
export function buildDeviceHistory(csv, { endpoint = '' } = {}) {
  const input = Array.isArray(csv?.rows) ? csv.rows : [];
  const diagnostics = { sourceRows: input.length, invalidRows: 0, invalidTimestampRows: 0,
    reversedRows: 0, duplicateRows: 0, droppedRows: 0 };
  let records = [], segment = 0, pendingBoundary = false;
  for (const row of input) {
    if (!row || !Number.isSafeInteger(row.ts) || row.ts < 0) {
      diagnostics.invalidRows++;
      diagnostics.droppedRows++;
      pendingBoundary = true;
      continue;
    }
    const timestamp = calendarTimestamp(row.ts_iso);
    if (timestamp === null) {
      diagnostics.invalidTimestampRows++;
      diagnostics.droppedRows++;
      pendingBoundary = true;
      continue;
    }
    let previous = records.at(-1);
    if (previous && (timestamp < previous.timestamp || row.ts < previous.row.ts)) {
      diagnostics.reversedRows++;
      diagnostics.droppedRows += records.length;
      records = [];
      previous = null;
      pendingBoundary = true;
    }
    if (pendingBoundary || previous && (timestamp - previous.timestamp > MAX_GAP_MS
      || (row.ts - previous.row.ts) * 1000 > MAX_GAP_MS)) segment++;
    pendingBoundary = false;
    const record = { row, timestamp, segment };
    if (previous && (timestamp === previous.timestamp || row.ts === previous.row.ts)) {
      records[records.length - 1] = record;
      diagnostics.duplicateRows++;
      diagnostics.droppedRows++;
    } else records.push(record);
  }

  const percentEndpoint = stateEndpoint(endpoint);
  const chart = { rsrp: [], sinr: [], rsrq: [], down: [], up: [],
    temperatures: Object.fromEntries(Object.keys(TEMPERATURE_FIELDS).map(key => [key, []])),
    signals: Object.fromEntries(Object.keys(SIGNAL_FIELDS).map(key => [key, []])) };
  const battery = [];
  for (const { row, timestamp, segment: recordSegment } of records) {
    const identity = JSON.stringify([percentEndpoint, recordSegment]);
    const network = typeof row.network_type === 'string' && row.network_type.trim() ? row.network_type.trim() : null;
    const signalIdentity = JSON.stringify([percentEndpoint, recordSegment, network]);
    const point = (value, unit, sampleIdentity = identity) => [timestamp, value, 'device', unit, sampleIdentity];
    chart.down.push(point(throughput(row, 'download_bps'), 'B/s'));
    chart.up.push(point(throughput(row, 'upload_bps'), 'B/s'));
    for (const [key, field] of Object.entries(TEMPERATURE_FIELDS)) {
      chart.temperatures[key].push(point(metric(row[field]), '°C'));
    }
    for (const [key, [field, unit]] of Object.entries(SIGNAL_FIELDS)) {
      chart.signals[key].push(point(network ? metric(row[field]) : null, unit, signalIdentity));
    }
    const activeSignal = network && /^(SA|NSA)$/i.test(network) ? 'nr' : 'lte';
    chart.rsrp.push(point(network ? metric(row[`${activeSignal}_rsrp_dbm`]) : null, 'dBm', signalIdentity));
    chart.rsrq.push(point(network ? metric(row[`${activeSignal}_rsrq_db`]) : null, 'dB', signalIdentity));
    chart.sinr.push(point(network ? metric(row[activeSignal === 'nr' ? 'nr_sinr_db' : 'lte_snr_db']) : null, 'dB', signalIdentity));
    battery.push({
      timestamp, wallClock: row.ts_iso, deviceTimestamp: row.ts, percent: metric(row.soc), percentSource: 'gauge88', percentEndpoint,
      source: 'device', charging: row.status === 'Charging' ? true : row.status === 'Discharging' ? false : null,
      temperature: metric(row.temp_c), voltage: metric(row.voltage_mv), current: metric(row.current_ma),
      chargeType: row.status, externalPower: row.usb_online === 1 ? true : row.usb_online === 0 ? false : null, identity
    });
  }
  const latest = records.at(-1);
  return { chart, battery, sourceCounts: { device: records.length }, snapshotCount: records.length,
    latestTimestamp: latest?.timestamp ?? null, latestWallClock: latest?.row.ts_iso ?? null,
    deviceTimestamp: latest?.row.ts ?? null, diagnostics };
}
