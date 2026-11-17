import { sanitizeBatteryMeasurement, normalizeBatteryEndpoint } from './battery-gauge.js';
import { batteryMeasurementIdentity, sameBatteryIdentity } from './battery-current-window.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const result = (state, reason, targetPercent, minutes = null, method = null) => ({ minutes, state, method, reason, targetPercent });

function compatibleSocSlope(measurement, currentWindow, samples, calculatedAt) {
  const source = measurement.percentageSource ?? currentWindow?.identity?.percentageSource;
  const endpoint = normalizeBatteryEndpoint(measurement.endpoint || currentWindow?.identity?.endpoint || '');
  const identity = batteryMeasurementIdentity({ measurement, endpoint, percentageSource: source });
  const isGauge = source === 'gauge88';
  const expectedSign = measurement.mode === 'charging' ? 1 : -1;
  const currentSource = sample => (sample.percentSource ?? sample.measurement?.percentageSource ?? 'router') === source
    && normalizeBatteryEndpoint(sample.percentEndpoint ?? sample.measurement?.endpoint ?? '') === endpoint;
  // Foreign sources must be removed before looking for gaps or state boundaries.
  const candidates = (Array.isArray(samples) ? samples : []).filter(sample => sample && currentSource(sample)
    && finite(sample.timestamp) && sample.timestamp >= calculatedAt - 1800000 && sample.timestamp <= calculatedAt);
  let segment = [];
  for (const sample of candidates) {
    const normalized = sanitizeBatteryMeasurement(sample.measurement);
    const percent = normalized?.rawSoc ?? sample.percent;
    const mode = normalized?.mode ?? (sample.charging === true ? 'charging' : sample.charging === false ? 'discharging' : 'unknown');
    if (!finite(percent) || percent < 0 || percent > 100 || mode !== measurement.mode
        || isGauge && finite(normalized?.netCurrentMa) && normalized.netCurrentMa * expectedSign <= -50
        || normalized && !sameBatteryIdentity(identity, batteryMeasurementIdentity({ measurement: normalized, endpoint }))) {
      segment = []; continue;
    }
    const point = { timestamp: sample.timestamp, percent, measurement: normalized };
    const previous = segment.at(-1);
    if (previous) {
      const elapsed = point.timestamp - previous.timestamp;
      const mono = normalized?.sampleMonoSeconds, lastMono = previous.measurement?.sampleMonoSeconds;
      if (elapsed === 0 || finite(mono) && finite(lastMono) && mono === lastMono) continue;
      if (elapsed < 0 || finite(mono) && finite(lastMono) && mono < lastMono) { segment = [point]; continue; }
      const delta = percent - previous.percent;
      let correction = !isGauge && elapsed <= 120000 && Math.abs(delta) > 10;
      if (isGauge) {
        const capacity = measurement.usableCapacityMah;
        const firstCurrent = previous.measurement?.netCurrentMa, lastCurrent = normalized?.netCurrentMa;
        let expectedDelta = 0;
        if (finite(capacity) && capacity > 0 && finite(firstCurrent) && finite(lastCurrent)) {
          expectedDelta = Math.abs((firstCurrent + lastCurrent) / 2 * elapsed / 3600000 / capacity * 100);
        }
        correction = Math.abs(delta) > Math.max(0.5, 3 * expectedDelta + 0.15)
          || delta * expectedSign < -0.15;
      }
      if (elapsed > 120000 || finite(mono) && finite(lastMono) && (mono - lastMono) * 1000 > 120000 || correction) segment = [];
    }
    segment.push(point);
  }
  const first = segment[0], last = segment.at(-1);
  if (segment.length < 6 || !first || last.timestamp - first.timestamp < 600000
      || calculatedAt - last.timestamp > 120000 || (last.percent - first.percent) * expectedSign < (isGauge ? 0.2 : 1)) return null;
  const rates = [];
  for (let firstIndex = 0; firstIndex < segment.length; firstIndex += 1) {
    for (let lastIndex = firstIndex + 1; lastIndex < segment.length; lastIndex += 1) {
      const from = segment[firstIndex], to = segment[lastIndex], elapsed = to.timestamp - from.timestamp;
      if (elapsed >= 300000) rates.push((to.percent - from.percent) / (elapsed / 60000));
    }
  }
  rates.sort((a, b) => a - b);
  const middle = Math.floor(rates.length / 2);
  const rate = rates.length % 2 ? rates[middle] : (rates[middle - 1] + rates[middle]) / 2;
  return finite(rate) && rate * expectedSign > 0 ? { rate: Math.abs(rate), seconds: (last.timestamp - first.timestamp) / 1000 } : null;
}

export function estimateBatteryTimes({ measurement: rawMeasurement, currentWindow = {}, samples = [], calculatedAt = Date.now(), runtimeTargetPercent = 0 } = {}) {
  const measurement = sanitizeBatteryMeasurement(rawMeasurement);
  const target = finite(runtimeTargetPercent) && runtimeTargetPercent >= 0 && runtimeTargetPercent <= 100 ? runtimeTargetPercent : 0;
  const output = {
    timeToFull: result('unavailable', '待刷新', 100), runtime: result('unavailable', '待刷新', target),
    calculatedAt, windowSeconds: 0
  };
  if (!measurement || !finite(calculatedAt)) return output;
  const mode = measurement.mode;
  output.timeToFull = result('not-applicable', measurement.externalPower ? '未净充电' : '未充电', 100);
  output.runtime = result('not-applicable', '充电中', target);
  if (mode === 'unknown') {
    output.timeToFull = result('unknown', '状态待确认', 100);
    output.runtime = result('unknown', '状态待确认', target);
  } else if (mode === 'full') {
    output.timeToFull = result(measurement.fullConfirmed ? 'full' : 'confirming', measurement.fullConfirmed ? '已充满' : '满充确认中', 100);
    output.runtime = result('not-applicable', '外接供电', target);
  } else if (mode === 'confirming') {
    output.timeToFull = result('confirming', '满充确认中', 100);
    output.runtime = result('not-applicable', '满充确认中', target);
  } else if (mode === 'external') {
    output.timeToFull = result('external', '外接供电', 100);
    output.runtime = result('external', '拔电后估算', target);
  } else {
    const charging = mode === 'charging', key = charging ? 'timeToFull' : 'runtime';
    const resultTarget = charging ? 100 : target;
    const current = measurement.netCurrentMa;
    const sign = charging ? 1 : -1;
    const expectedIdentity = batteryMeasurementIdentity({ measurement, endpoint: measurement.endpoint || currentWindow.identity?.endpoint || '' });
    const freshWindow = finite(currentWindow.windowEnd) && currentWindow.windowEnd <= calculatedAt
      && calculatedAt - currentWindow.windowEnd <= 120000;
    const matchingWindow = !currentWindow.identity || sameBatteryIdentity(currentWindow.identity, expectedIdentity);
    const average = freshWindow && matchingWindow && finite(currentWindow.meanCurrentMa) ? currentWindow.meanCurrentMa : null;
    const enoughWindow = average !== null && finite(currentWindow.observedDurationMs) && currentWindow.observedDurationMs >= 60000
      && Number.isSafeInteger(currentWindow.sampleCount) && currentWindow.sampleCount >= 3;
    const hasPrimaryFields = finite(measurement.usableCapacityMah) && finite(current);
    output.windowSeconds = freshWindow && matchingWindow && finite(currentWindow.observedDurationMs) ? currentWindow.observedDurationMs / 1000 : 0;
    if (finite(current) && current * sign <= -50 || average !== null && average * sign <= -50) {
      output[key] = result('unknown', '状态待确认', resultTarget);
    } else if (average !== null ? Math.abs(average) < 50 : finite(current) && Math.abs(current) < 50) {
      output[key] = result('low-current', '待估算', resultTarget);
    } else if (charging && measurement.rawSoc >= 95) {
      output[key] = result('tapering', '充满时间随电流变化', resultTarget);
    } else if (hasPrimaryFields) {
      output[key] = result('collecting', '采集中', resultTarget);
      if (enoughWindow && average * sign >= 50) {
        const delta = charging ? 100 - measurement.rawSoc : Math.max(0, measurement.rawSoc - target);
        const minutes = delta / 100 * measurement.usableCapacityMah / Math.abs(average) * 60;
        if (finite(minutes)) output[key] = result('estimated', '', resultTarget, minutes, 'net-current');
      }
    } else {
      const slope = compatibleSocSlope(measurement, currentWindow, samples, calculatedAt);
      output[key] = result('collecting', '采集中', resultTarget);
      if (slope) {
        const delta = charging ? 100 - measurement.rawSoc : Math.max(0, measurement.rawSoc - target);
        const minutes = delta / slope.rate;
        if (finite(minutes)) output[key] = result('estimated', '', resultTarget, minutes, 'soc-slope');
        output.windowSeconds = slope.seconds;
      }
    }
  }
  if (measurement.eodImminent || measurement.eodClamp) output.runtime = result('low-battery', '请尽快充电', target);
  return output;
}
