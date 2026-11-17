import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeChartHistory, mergeBatterySamples } from '../src/utils/history.js';
import { formatHours, numeric } from '../src/utils/format.js';
import { TEMPERATURE_LABELS, isTemperatureField, temperatureReading, normalizeTemperaturePoints } from '../src/utils/temperature.js';

const T = 1800000000000;

test('old and peer temperature archives discard suspect readings before minute merging while retaining raw input and negative signals', () => {
  const local = { rsrp: [[T, -93, 'foreground']], temperatures: {
    wifi_chip_temp: [[T, 40, 'foreground'], [T + 60000, -80, 'screenOff']],
    therm_pa_level: [[T, 1, 'foreground']], unexpected_temp: [[T, 30]]
  } };
  const peer = { temperatures: {
    wifi_chip_temp: [[T + 1000, '40broken', 'background'], [T + 120000, 41, 'overlay']],
    wifi_temp_level_1: [[T, '37.5', 'screenOff']],
    wifi_temp_level_2: [[T, 38, 'background']],
    pm_modem_5g: [[T, 42, 'screenOff']]
  } };
  const merged = mergeChartHistory(local, peer);
  assert.deepEqual(merged.temperatures.wifi_chip_temp, [[T, 40, 'foreground'], [T + 120000, 41, 'overlay']]);
  assert.deepEqual(merged.temperatures.wifi_temp_level_1, [[T, 37.5, 'screenOff']]);
  assert.deepEqual(merged.temperatures.wifi_temp_level_2, [[T, 38, 'background']]);
  assert.deepEqual(merged.temperatures.pm_modem_5g, [[T, 42, 'screenOff']]);
  assert.equal(merged.temperatures.therm_pa_level, undefined);
  assert.equal(merged.temperatures.unexpected_temp, undefined);
  assert.deepEqual(merged.rsrp, [[T, -93, 'foreground']]);
  assert.equal(local.temperatures.wifi_chip_temp[1][1], -80);
  assert.deepEqual(mergeChartHistory(JSON.parse(JSON.stringify(merged)), peer), merged);
  assert.equal(numeric('-93'), -93);
});

test('battery history sanitizes temperatures, preserves sample source and keeps unknown charging separate from false', () => {
  const samples = mergeBatterySamples([[
    { timestamp: T, percent: 50, charging: false, temperature: 33, source: 'foreground' },
    { timestamp: T + 1000, percent: 49, charging: null, temperature: -80, source: 'screenOff' },
    { timestamp: T + 60000, percent: 48, temperature: '35broken', source: 'background' },
    { timestamp: T + 120000, percent: 47, charging: true, temperature: '0', source: 'overlay' }
  ]]);
  assert.equal(samples.length, 4);
  assert.equal(samples[0].charging, false);
  assert.equal(samples[1].charging, null);
  assert.equal(samples[1].temperature, null);
  assert.equal(samples[1].source, 'screenOff');
  assert.equal(samples[2].charging, null);
  assert.equal(samples[2].temperature, null);
  assert.equal(samples[3].temperature, 0);
  assert.deepEqual(mergeBatterySamples([JSON.parse(JSON.stringify(samples))]), samples);
});

test('estimated hours round the total minutes before splitting into hours and minutes', () => {
  assert.equal(formatHours(12.999), '13小时 0分钟');
  assert.equal(formatHours(0.999), '1小时 0分钟');
  assert.equal(formatHours(1.5), '1小时 30分钟');
  assert.equal(formatHours(0), '0小时 0分钟');
  assert.equal(formatHours(null), '数据不足');
});

test('temperature readings distinguish missing and invalid decimals without changing the raw diagnostic value', () => {
  for (const raw of ['-80', '151', '-40.01', '40broken', '40°C', 'NaN', 'Infinity', '0x20', true, [], {}]) {
    assert.equal(temperatureReading('wifi_chip_temp', raw).state, 'invalid', String(raw));
    assert.equal(temperatureReading('wifi_chip_temp', raw).value, null, String(raw));
  }
  for (const raw of [undefined, null, '', '  ']) {
    assert.equal(temperatureReading('battery_temp', raw).state, 'missing');
    assert.equal(temperatureReading('battery_temp', raw).value, null);
  }
  for (const [key, raw, value] of [['wifi_temp_level_1', ' 37.5 ', 37.5], ['wifi_temp_level_2', 0, 0], ['cpu_temp', '-40', -40], ['pm_modem_5g', '150', 150]]) {
    assert.deepEqual(temperatureReading(key, raw), { value, state: 'valid', raw: String(raw) });
    assert.ok(TEMPERATURE_LABELS[key]);
  }
  for (const key of ['therm_pa_level', 'therm_tj_level', 'OOM_TEMP_PRO', 'unknown_temp', 'lte_rsrp', 'toString', '__proto__']) {
    assert.equal(isTemperatureField(key), false, key);
    assert.equal(temperatureReading(key, '30').state, 'invalid');
  }
  assert.deepEqual(normalizeTemperaturePoints('wifi_chip_temp', [[T, 40, 'foreground'], [T + 1, -80], [T + 2, '41', 'screenOff']]),
    [[T, 40, 'foreground'], [T + 2, 41, 'screenOff']]);
  assert.deepEqual(normalizeTemperaturePoints('therm_pa_level', [[T, 1]]), []);
});
