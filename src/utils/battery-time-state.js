export const batteryTimeResult = (state, reason, targetPercent, minutes = null, method = null) =>
  ({ minutes, state, method, reason, targetPercent });

// Shared presentation states depend only on the normalized live measurement.
// Each estimator supplies its own evidence and fitting for active power modes.
export function initializeBatteryTimeResults(measurement, { runtimeTargetPercent = 0, unavailableReason = '待刷新' } = {}) {
  const output = {
    timeToFull: batteryTimeResult('unavailable', unavailableReason, 100),
    runtime: batteryTimeResult('unavailable', unavailableReason, runtimeTargetPercent),
    canEstimate: false
  };
  if (!measurement) return output;
  output.timeToFull = batteryTimeResult('not-applicable', measurement.externalPower ? '未净充电' : '未充电', 100);
  output.runtime = batteryTimeResult('not-applicable', '充电中', runtimeTargetPercent);
  if (measurement.mode === 'unknown') {
    output.timeToFull = batteryTimeResult('unknown', '状态待确认', 100);
    output.runtime = batteryTimeResult('unknown', '状态待确认', runtimeTargetPercent);
  } else if (measurement.mode === 'full') {
    output.timeToFull = batteryTimeResult(measurement.fullConfirmed ? 'full' : 'confirming',
      measurement.fullConfirmed ? '已充满' : '满充确认中', 100);
    output.runtime = batteryTimeResult('not-applicable', '外接供电', runtimeTargetPercent);
  } else if (measurement.mode === 'confirming') {
    output.timeToFull = batteryTimeResult('confirming', '满充确认中', 100);
    output.runtime = batteryTimeResult('not-applicable', '满充确认中', runtimeTargetPercent);
  } else if (measurement.mode === 'external') {
    output.timeToFull = batteryTimeResult('external', '外接供电', 100);
    output.runtime = batteryTimeResult('external', '拔电后估算', runtimeTargetPercent);
  } else output.canEstimate = measurement.mode === 'charging' || measurement.mode === 'discharging';
  return output;
}
