import { normalizeBatteryMeasurement, normalizeBatteryEndpoint } from './battery-gauge.js';

const enabled = value => value === '1' || value === 1 || value === true;
const time = (state, reason, targetPercent, minutes = null) => ({
  minutes, state, method: minutes === null ? null : 'soc-slope', reason, targetPercent
});

export function normalizeFactoryBatteryMeasurement(status, endpoint = '') {
  // Original firmware collection treats the external-power flag as charging.
  const charging = enabled(status?.battery_charging) || enabled(status?.external_charging_flag);
  const measurement = normalizeBatteryMeasurement({ ...status, battery_charging: charging ? '1' : '0' });
  if (measurement) { measurement.mode = charging ? 'charging' : 'discharging'; measurement.endpoint = normalizeBatteryEndpoint(endpoint); }
  return measurement;
}

export function estimateFactoryBatteryTimes({ measurement, samples = [], calculatedAt = Date.now() } = {}) {
  const output = { timeToFull: time('unavailable', '待刷新', 100), runtime: time('unavailable', '待刷新', 0),
    calculatedAt, windowSeconds: 0, ratePerHour: null };
  if (!measurement || measurement.percentageSource !== 'router') return output;
  const charging = measurement.mode === 'charging';
  const key = charging ? 'timeToFull' : 'runtime';
  const target = charging ? 100 : 0;
  output[charging ? 'runtime' : 'timeToFull'] = time('not-applicable', charging ? '充电中' : '未在充电', charging ? 0 : 100);
  output[key] = time('collecting', '采集中', target);
  const cutoff = calculatedAt - 24 * 3600000;
  const endpoint = normalizeBatteryEndpoint(measurement.endpoint);
  const factory = samples.filter(item => item && (item.percentSource ?? item.measurement?.percentageSource ?? 'router') === 'router'
    && (!normalizeBatteryEndpoint(item.percentEndpoint ?? item.measurement?.endpoint ?? '')
      || normalizeBatteryEndpoint(item.percentEndpoint ?? item.measurement?.endpoint ?? '') === endpoint)
    && typeof item.timestamp === 'number' && item.timestamp <= calculatedAt);
  const recent = [];
  for (let index = factory.length - 1; index >= 0; index--) {
    const sample = factory[index];
    if (sample.timestamp < cutoff || sample.charging !== charging) break;
    recent.unshift(sample);
  }
  const first = recent[0], last = recent.at(-1);
  if (recent.length < 2) return output;
  const hours = (last.timestamp - first.timestamp) / 3600000;
  const delta = charging ? last.percent - first.percent : first.percent - last.percent;
  if (hours < 0.15 || !(delta > 0)) return output;
  const rate = delta / hours;
  const minutes = Math.max(0, charging ? 100 - measurement.rawSoc : measurement.rawSoc) / rate * 60;
  if (Number.isFinite(minutes)) {
    output[key] = time('estimated', '', target, minutes);
    output.windowSeconds = hours * 3600;
    output.ratePerHour = rate;
  }
  return output;
}
