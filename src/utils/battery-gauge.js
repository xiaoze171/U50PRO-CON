// The software gauge is independent of the factory percentage.
export function normalizeBatteryConfig(value = {}) {
  const batterySource = value.batterySource ?? 'gauge';
  if (!['gauge', 'factory'].includes(batterySource)) throw new Error('请选择有效的电量来源');
  const port = String(value.batteryPort ?? 88).trim();
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('端口必须是 1–65535 的整数');
  let batteryHost = String(value.batteryHost ?? '').trim();
  if (batteryHost) {
    try {
      if (batteryHost.includes(':') && !batteryHost.startsWith('[') && batteryHost.split(':').length > 2) batteryHost = `[${batteryHost}]`;
      if (/[\s/@?#\\]/.test(batteryHost)) throw new Error();
      const target = new URL(`http://${batteryHost}`);
      if (target.port || target.username || target.password || !target.hostname || target.pathname !== '/') throw new Error();
      batteryHost = target.hostname;
    } catch { throw new Error('IP 地址只填写 IP 或主机名，不包含协议、端口和路径'); }
  }
  return { batterySource, batteryHost, batteryPort: Number(port) };
}

export function batteryGaugeUrl(routerUrl, batteryHost = '', batteryPort = 88) {
  const target = new URL(routerUrl);
  const settings = normalizeBatteryConfig({ batteryHost, batteryPort });
  if (settings.batteryHost) target.hostname = settings.batteryHost;
  target.username = '';
  target.password = '';
  target.port = String(settings.batteryPort);
  target.pathname = '/state.json';
  target.search = '';
  target.hash = '';
  return target.toString();
}

export function batteryGaugeReading(raw, headers = {}, url = '', now = Date.now()) {
  const result = { percent: null, state: 'invalid', url, raw, capturedAt: now, validUntil: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const ageHeader = Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-gauge-age')?.[1];
  const hasAgeHeader = ageHeader != null && String(ageHeader).trim() !== '';
  // ts belongs to the device clock. Only a relative age can establish freshness
  // on a phone whose clock may differ from that device by hours.
  if (!hasAgeHeader) return { ...result, state: 'unavailable', error: '设备未提供相对数据时龄' };
  const age = Number(ageHeader);
  if (!Number.isFinite(age) || age < 0 || age > 5) return { ...result, state: 'stale' };
  result.validUntil = now + (5 - age) * 1000;
  if (raw.data_quality !== 'ok' || typeof raw.soc !== 'number' || !Number.isFinite(raw.soc) || raw.soc < 0 || raw.soc > 100) return result;
  const pendingFull = ['Charging', 'Full'].includes(raw.status) && raw.full_confirmed === false;
  return {
    ...result, state: 'valid',
    percent: Math.min(Number(raw.soc.toFixed(2)), raw.soc < 100 || pendingFull ? 99.99 : 100)
  };
}

export function freshBatteryGaugeReading(marker, now = Date.now()) {
  if (marker?.state !== 'valid' || typeof marker.validUntil !== 'number'
      || !Number.isFinite(marker.validUntil) || now <= marker.validUntil) return marker;
  return { ...marker, state: 'stale', percent: null };
}

export function batteryPercent(status = {}) {
  if (Object.hasOwn(status, 'battery_gauge')) {
    return status.battery_gauge?.state === 'valid' ? status.battery_gauge.percent : null;
  }
  const number = value => Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : null;
  return number(status.battery_vol_percent) ?? number(status.battery_value);
}

export function batteryPercentSource(status = {}) {
  return Object.hasOwn(status, 'battery_gauge') ? 'gauge88' : 'router';
}

export function batteryPercentEndpoint(status = {}) {
  return status.battery_gauge?.url || '';
}

const finiteNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonemptyString = value => typeof value === 'string' && value.trim() ? value : null;
const enabledFlag = value => value === true || value === 1 || value === '1';
const disabledFlag = value => value === false || value === 0 || value === '0';
const batteryModes = new Set(['charging', 'discharging', 'full', 'confirming', 'external', 'unknown']);

export function normalizeBatteryEndpoint(value = '') {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch { return value.trim().replace(/\/+$/, ''); }
}

// Used at history / bridge boundaries: an old or invalid object never inherits
// the previous reading's current, capacity or identity.
export function sanitizeBatteryMeasurement(value) {
  if (!value || value.schemaVersion !== 2 || finiteNumber(value.rawSoc) === null
      || value.rawSoc < 0 || value.rawSoc > 100) return null;
  const capacity = finiteNumber(value.usableCapacityMah);
  const stable = finiteNumber(value.fullStableSeconds);
  const mono = finiteNumber(value.sampleMonoSeconds);
  return {
    schemaVersion: 2,
    rawSoc: value.rawSoc,
    mode: batteryModes.has(value.mode) ? value.mode : 'unknown',
    netCurrentMa: finiteNumber(value.netCurrentMa),
    voltageMv: finiteNumber(value.voltageMv),
    netPowerW: finiteNumber(value.netPowerW),
    usableCapacityMah: capacity !== null && capacity > 0 ? capacity : null,
    capacityBasis: nonemptyString(value.capacityBasis),
    externalPower: value.externalPower === true,
    fullConfirmed: value.fullConfirmed === true,
    fullAnchorValid: value.fullAnchorValid === true,
    fullStableSeconds: stable !== null && stable >= 0 ? stable : null,
    eodImminent: value.eodImminent === true,
    eodClamp: value.eodClamp === true,
    bootId: nonemptyString(value.bootId),
    sampleMonoSeconds: mono !== null && mono >= 0 ? mono : null,
    anchorIdentity: nonemptyString(value.anchorIdentity),
    percentageSource: value.percentageSource === 'gauge88' ? 'gauge88' : value.percentageSource === 'router' ? 'router' : null,
    endpoint: normalizeBatteryEndpoint(value.endpoint)
  };
}

export function normalizeBatteryMeasurement(status = {}) {
  if (!status || typeof status !== 'object') return null;
  if (Object.hasOwn(status, 'battery_gauge')) {
    const marker = status.battery_gauge;
    const raw = marker?.raw;
    if (marker?.state !== 'valid' || raw?.data_quality !== 'ok' || finiteNumber(raw.soc) === null
        || raw.soc < 0 || raw.soc > 100) return null;
    const current = finiteNumber(raw.current_ma);
    const externalPower = raw.usb_online === 1 || raw.usb_online === true || raw.direct_supply === true;
    let mode = 'unknown';
    if (raw.status === 'Charging' && !(current !== null && current <= -50)) mode = 'charging';
    if (raw.status === 'Discharging' && !(current !== null && current >= 50)) mode = 'discharging';
    if (raw.status === 'Full' && !(current !== null && current <= -50)) mode = raw.full_confirmed === true ? 'full' : 'confirming';
    if (raw.status === 'Not charging') {
      if (current !== null && current <= -50) mode = 'discharging';
      else if (!(current !== null && current >= 50) && externalPower) mode = 'external';
    }
    return sanitizeBatteryMeasurement({
      schemaVersion: 2, rawSoc: raw.soc, mode, netCurrentMa: current,
      voltageMv: raw.voltage_mv, netPowerW: raw.power_w, usableCapacityMah: raw.capacity_mah_used,
      capacityBasis: raw.capacity_basis, externalPower, fullConfirmed: raw.full_confirmed,
      fullAnchorValid: raw.full_anchor_valid, fullStableSeconds: raw.full_stable_s,
      eodImminent: raw.eod_imminent, eodClamp: raw.eod_clamp,
      bootId: raw.boot_id, sampleMonoSeconds: raw.sample_mono_s,
      anchorIdentity: JSON.stringify([raw.full_anchor_valid === true, finiteNumber(raw.full_anchor_ts), finiteNumber(raw.full_anchor_voltage_mv)]),
      percentageSource: 'gauge88', endpoint: marker.url
    });
  }
  const factoryNumber = value => finiteNumber(value) ?? (typeof value === 'string' && value.trim()
    && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? finiteNumber(Number(value)) : null);
  const rawSoc = factoryNumber(status.battery_vol_percent) ?? factoryNumber(status.battery_value);
  if (rawSoc === null || rawSoc < 0 || rawSoc > 100) return null;
  const externalPower = enabledFlag(status.external_charging_flag);
  const mode = enabledFlag(status.battery_charging) ? 'charging'
    : disabledFlag(status.battery_charging) && !externalPower ? 'discharging'
      : externalPower ? 'external' : 'unknown';
  return sanitizeBatteryMeasurement({ schemaVersion: 2, rawSoc, mode, externalPower,
    percentageSource: 'router', endpoint: status.percentEndpoint || '' });
}
