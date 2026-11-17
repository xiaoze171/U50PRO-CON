// Explicit Celsius sensors. Thermal protection levels are not temperatures.
export const TEMPERATURE_LABELS = Object.freeze({
  battery_temp: '电池温度',
  wifi_chip_temp: 'Wi-Fi 芯片',
  wifi_temp_level_1: 'Wi-Fi 传感器 1',
  wifi_temp_level_2: 'Wi-Fi 传感器 2',
  pm_sensor_pa1: '射频 PA',
  pm_sensor_mdm: 'Modem',
  pm_modem_5g: '5G Modem',
  cpu_temp: 'CPU 温度',
  cpu_temperature: 'CPU 温度',
  soc_temp: 'SoC 温度',
  board_temp: '主板温度',
  modem_temp: 'Modem 温度'
});

export function isTemperatureField(key) {
  return typeof key === 'string' && Object.hasOwn(TEMPERATURE_LABELS, key);
}

export function temperatureReading(key, input) {
  const raw = input == null ? '' : String(input);
  if (!isTemperatureField(key)) return { value: null, state: 'invalid', raw };
  if (input == null || (typeof input === 'string' && !input.trim())) {
    return { value: null, state: 'missing', raw };
  }
  const text = raw.trim();
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const value = Number(text);
  // Application plausibility guard, not a firmware sentinel or an operating rating.
  const valid = (typeof input === 'string' || typeof input === 'number')
    && decimal.test(text) && Number.isFinite(value) && value >= -40 && value <= 150;
  return { value: valid ? value : null, state: valid ? 'valid' : 'invalid', raw };
}

// Filter before bucketing or smoothing so an invalid peer sample cannot replace a valid one.
// Keep timestamps and source labels paired with their measurement; never change the raw input.
export function normalizeTemperaturePoints(key, list) {
  if (!isTemperatureField(key) || !Array.isArray(list)) return [];
  const points = [];
  for (const item of list) {
    if (!Array.isArray(item) || item[0] == null || item[0] === '') continue;
    const timestamp = Number(item[0]);
    const reading = temperatureReading(key, item[1]);
    if (!Number.isFinite(timestamp) || reading.state !== 'valid') continue;
    const point = [timestamp, reading.value];
    if (typeof item[2] === 'string') point.push(item[2]);
    points.push(point);
  }
  return points;
}
