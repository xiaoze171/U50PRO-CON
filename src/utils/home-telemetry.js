import { TEMPERATURE_LABELS, temperatureReading } from './temperature.js';

const MISSING = '—';
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const SIGNAL_SLOTS = [
  { key: 'rsrp', label: 'RSRP', unit: 'dBm', min: -120, max: -70, bars: [-80, -90, -100, -110] },
  { key: 'rsrq', label: 'RSRQ', unit: 'dB', min: -24, max: -5, bars: [-10, -14, -18, -22] },
  { key: 'sinr', label: 'SINR', unit: 'dB', min: -10, max: 25, bars: [20, 13, 0, -5] },
  { key: 'rssi', label: 'RSSI', unit: 'dBm', min: -100, max: -60, bars: [-65, -75, -85, -95] }
];
const QUALITY_LEVELS = ['excellent', 'good', 'fair', 'weak'];
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function decimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!DECIMAL.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function firstValid(parser, ...values) {
  for (const value of values) {
    const parsed = parser(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function nonnegative(value) {
  const parsed = decimal(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function integer(value) {
  const parsed = nonnegative(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nrPci(value) {
  if (typeof value !== 'string') return integer(value);
  const text = value.trim();
  if (/^[+-]?\d+$/.test(text)) return integer(text);
  if (!/^(?:0x[0-9a-f]+|[0-9a-f]*[a-f][0-9a-f]*)$/i.test(text)) return null;
  const parsed = Number.parseInt(text.replace(/^0x/i, ''), 16);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function band(value, rat) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  const pattern = rat === 'nr' ? /^(?:(?:NR\s*)?(?:BAND\s*)?|n)(\d+)$/i
    : /^(?:(?:LTE\s*)?(?:BAND\s*)?|b)(\d+)$/i;
  const match = text.match(pattern);
  const number = match ? integer(match[1]) : null;
  return number !== null && number > 0 ? `${rat === 'nr' ? 'n' : 'B'}${number}` : null;
}

function radioGroups(network) {
  const text = typeof network === 'string' ? network.trim().toUpperCase() : '';
  if (text.includes('NSA')) return [{ key: 'nr', label: '5G NR', nsa: true }, { key: 'lte', label: 'LTE 锚点' }];
  if (/NR5G|5G|(?:^|[\s_-])SA(?:$|[\s_-])/.test(text)) return [{ key: 'nr', label: '5G NR' }];
  if (/LTE|4G/.test(text)) return [{ key: 'lte', label: '4G LTE' }];
  return [{ key: 'unknown', label: '信号' }];
}

function carrierPayload(value) {
  if (typeof value !== 'string') return false;
  const fields = value.trim().split(/[;,|]/).map(item => item.trim()).filter(Boolean);
  return fields.length >= 3 && fields.every(item => /^(?:[bn])?[+-]?\d+(?:\.\d+)?$/i.test(item));
}

function caState(fields, rat) {
  if (rat === 'nr') {
    if (carrierPayload(fields.nr_multi_ca_scell_info)
        || fields.nr_ca_dl_state === 'ca_activated' || fields.nr_ca_ul_state === 'ca_activated') return 'NR CA';
    return fields.nr_ca_dl_state === 'ca_deactivated' && fields.nr_ca_ul_state === 'ca_deactivated' ? '未启用' : MISSING;
  }
  if (rat === 'lte') {
    if (fields.wan_lte_ca === 'ca_activated') return 'LTE CA';
    if (fields.wan_lte_ca === 'ca_deactivated') return '未启用';
    if (carrierPayload(fields.lte_multi_ca_scell_info) || carrierPayload(fields.lte_ca_scell_info)) return 'LTE CA';
  }
  return MISSING;
}

function signalValues(fields, rat) {
  if (rat === 'nr') return {
    rsrp: decimal(fields.Z5g_rsrp), rsrq: decimal(fields.Z5g_rsrq),
    sinr: firstValid(decimal, fields.Z5g_SINR, fields.Z5g_snr), rssi: decimal(fields.Z5g_rssi)
  };
  if (rat === 'lte') return {
    rsrp: decimal(fields.lte_rsrp), rsrq: decimal(fields.lte_rsrq),
    sinr: decimal(fields.lte_snr), rssi: firstValid(decimal, fields.lte_rssi, fields.rssi)
  };
  return {};
}

function servingDetails(fields, group) {
  let activeBand = null, pci = null, arfcn = null, bandwidth = null;
  if (group.key === 'nr') {
    activeBand = band(fields.nr5g_action_band, 'nr');
    pci = nrPci(fields.nr5g_pci);
    arfcn = firstValid(integer, fields.nr5g_action_channel, fields.Z5g_dlEarfcn);
    // The collected NR bandwidth field is explicitly NSA-only.
    bandwidth = group.nsa ? nonnegative(fields.nr5g_nsa_bandwidth) : null;
  } else if (group.key === 'lte') {
    activeBand = firstValid(value => band(value, 'lte'), fields.lte_ca_pcell_band, fields.wan_active_band);
    pci = integer(fields.lte_pci);
    arfcn = firstValid(integer, fields.lte_ca_pcell_arfcn, fields.wan_active_channel);
    bandwidth = firstValid(nonnegative, fields.lte_ca_pcell_bandwidth, fields.bandwidth);
  }
  return [
    { label: '频段', value: activeBand ?? MISSING },
    { label: 'PCI', value: pci === null ? MISSING : String(pci) },
    { label: 'ARFCN', value: arfcn === null ? MISSING : String(arfcn) },
    { label: '带宽', value: bandwidth === null ? MISSING : `${bandwidth} MHz` },
    { label: 'CA', value: caState(fields, group.key) }
  ];
}

export function buildHomeSignalPanels(input, { network, live = true } = {}) {
  const fields = record(input);
  return radioGroups(network ?? fields.network_type).map(group => {
    const readings = live ? signalValues(fields, group.key) : {};
    const metrics = SIGNAL_SLOTS.map(slot => {
      const value = readings[slot.key] ?? null;
      const index = value === null ? -1 : slot.bars.findIndex(boundary => value >= boundary);
      return {
        key: slot.key, label: slot.label, value: value === null ? MISSING : String(value), unit: slot.unit,
        percent: value === null ? null : Math.round(Math.min(100, Math.max(0, (value - slot.min) / (slot.max - slot.min) * 100))),
        level: value === null ? 'unknown' : QUALITY_LEVELS[index] || 'bad'
      };
    });
    return { key: group.key, label: group.label, metrics,
      details: servingDetails(live ? fields : {}, group) };
  });
}

function selectedBatteryTemperature(reading) {
  if (!reading || reading.state === 'missing') return null;
  if (reading.state === 'invalid') return { value: null, state: 'invalid' };
  if (reading.state !== 'valid') return null;
  return temperatureReading('battery_temp', reading.value);
}

export function buildHomeTemperatureMetrics(input, { batteryReading, live = true } = {}) {
  if (!live) return [];
  const fields = record(input), metrics = [];
  for (const [key, label] of Object.entries(TEMPERATURE_LABELS)) {
    if (key === 'cpu_temperature') continue;
    let reading;
    if (key === 'battery_temp') reading = selectedBatteryTemperature(batteryReading);
    else if (key === 'cpu_temp') {
      const aliases = [temperatureReading(key, fields.cpu_temp), temperatureReading(key, fields.cpu_temperature)];
      reading = aliases.find(item => item.state === 'valid') || aliases.find(item => item.state === 'invalid');
    } else reading = temperatureReading(key, fields[key]);
    if (!reading || reading.state === 'missing') continue;
    metrics.push({ key, label, value: reading.state === 'valid' ? String(reading.value) : MISSING,
      unit: '°C', state: reading.state, note: reading.state === 'invalid' ? '读数异常' : '' });
  }
  return metrics;
}
