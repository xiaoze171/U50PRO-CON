import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBatteryCsv, estimateCsvBatteryTimes } from '../src/utils/battery-csv.js';

const timeStateModule = await import('../src/utils/battery-time-state.js').catch(() => ({}));

test('shared battery state initialization preserves independent targets and guards', () => {
  assert.equal(typeof timeStateModule.initializeBatteryTimeResults, 'function');
  const initialize = measurement => timeStateModule.initializeBatteryTimeResults(measurement, { runtimeTargetPercent: 20 });
  const unavailable = initialize(null);
  assert.deepEqual(unavailable, {
    timeToFull: { minutes: null, state: 'unavailable', method: null, reason: '待刷新', targetPercent: 100 },
    runtime: { minutes: null, state: 'unavailable', method: null, reason: '待刷新', targetPercent: 20 },
    canEstimate: false
  });
  assert.deepEqual(initialize({ mode: 'external' }), {
    timeToFull: { minutes: null, state: 'external', method: null, reason: '外接供电', targetPercent: 100 },
    runtime: { minutes: null, state: 'external', method: null, reason: '拔电后估算', targetPercent: 20 },
    canEstimate: false
  });
  const full = initialize({ mode: 'full', fullConfirmed: true });
  assert.equal(full.timeToFull.state, 'full');
  assert.equal(full.runtime.state, 'not-applicable');
  assert.equal(full.canEstimate, false);
  assert.equal(initialize({ mode: 'full', fullConfirmed: false }).timeToFull.state, 'confirming');
  assert.equal(initialize({ mode: 'confirming' }).runtime.reason, '满充确认中');
  assert.equal(initialize({ mode: 'unknown' }).runtime.state, 'unknown');
  const discharge = initialize({ mode: 'discharging', externalPower: true });
  assert.equal(discharge.timeToFull.reason, '未净充电');
  assert.equal(discharge.canEstimate, true);
  assert.equal(discharge.runtime.targetPercent, 20);
});

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/battery-csv-cases.json', import.meta.url), 'utf8'));
function assertPartial(actual, expected, path = 'result') {
  if (typeof expected === 'number') {
    assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-8,
      `${path}: expected ${expected}, received ${actual}`);
  } else if (expected && typeof expected === 'object') {
    for (const [key, value] of Object.entries(expected)) assertPartial(actual?.[key], value, `${path}.${key}`);
  } else assert.equal(actual, expected, path);
}

for (const fixture of fixtures.parserCases) {
  test(`shared parser: ${fixture.name}`, () => {
    if (fixture.error) return assert.throws(() => parseBatteryCsv(fixture.csv));
    const parsed = parseBatteryCsv(fixture.csv);
    assert.equal(parsed.rows.length, fixture.expected.rows);
    assert.equal(parsed.invalidRows, fixture.expected.invalidRows);
    if (Object.hasOwn(fixture.expected, 'firstRow')) assertPartial(parsed.rows[0], fixture.expected.firstRow);
  });
}

for (const fixture of fixtures.estimateCases) {
  test(`shared estimate: ${fixture.name}`, () => {
    const result = estimateCsvBatteryTimes({ ...fixture, csv: fixture.csv === null ? null : parseBatteryCsv(fixture.csv) });
    assertPartial(result, fixture.expected);
    assert.equal(result.calculatedAt, fixture.calculatedAt);
    for (const key of ['timeToFull', 'runtime']) {
      assert.ok(Object.hasOwn(result[key], 'minutes'));
      assert.ok(Object.hasOwn(result[key], 'reason'));
      assert.ok(Object.hasOwn(result[key], 'method'));
      if (result[key].state !== 'estimated') assert.equal(result[key].minutes, null);
    }
  });
}

const header = 'ts_iso,ts,soc,voltage_mv,current_ma,power_w,temp_c,status';
const end = 1800000000;
function log({ count = 61, sign = -1, soc = 50 } = {}) {
  return header + '\n' + Array.from({ length: count }, (_, i) =>
    `ignored,${end - (count - 1 - i) * 60},${soc - sign * (count - 1 - i) / 12},4000,${sign * 400},${sign * 1.6},31,${sign < 0 ? 'Discharging' : 'Charging'}`).join('\n');
}
function calculate(text = log(), extra = {}) {
  return estimateCsvBatteryTimes({ csv: parseBatteryCsv(text), calculatedAt: 1900000000000,
    deviceNowSeconds: end, measurement: { schemaVersion: 2, rawSoc: 50, mode: 'discharging',
      netCurrentMa: -400, voltageMv: 4000, netPowerW: -1.6, usableCapacityMah: 8000,
      percentageSource: 'gauge88', endpoint: 'http://router:88/state.json', ...extra } });
}

test('CSV uses named columns, BOM, quotes, CRLF and null USB fields', () => {
  const parsed = parseBatteryCsv('\ufeffstatus,temp_c,power_w,current_ma,voltage_mv,soc,ts,ts_iso,input_power_w\r\n"Discharging",31,-1.6,-400,4000,50,1800000000,"date, ignored",\r\n');
  assert.equal(parsed.rows[0].soc, 50);
  assert.equal(parsed.rows[0].input_power_w, null);
  assert.equal(parsed.invalidRows, 0);
  assert.equal(parseBatteryCsv(header + ',usb_online,input_voltage_mv,input_current_ma,input_power_w\n' + log().split('\n')[1]).invalidRows, 0);
});
test('CSV rejects malformed header/quotes and retains invalid records as boundaries', () => {
  for (const text of ['<html>error</html>', header + ',soc\n', header + '\n"unfinished']) {
    assert.throws(() => parseBatteryCsv(text));
  }
  const rows = log().split('\n'); rows[32] = 'invalid,,,,,,,';
  const parsed = parseBatteryCsv(rows.join('\n'));
  assert.equal(parsed.rows.length, 61);
  assert.equal(parsed.invalidRows, 1);
  assert.equal(calculate(rows.join('\n')).runtime.state, 'collecting');
});
test('CSV history immediately estimates from device time despite phone clock offset', () => {
  const result = calculate();
  assert.equal(result.runtime.minutes, 600);
  assert.equal(result.runtime.method, 'device-csv');
  assert.equal(result.runtime.targetPercent, 0);
  assert.equal(result.windowSeconds, 3600);
  assert.equal(result.timeToFull.minutes, null);
  assert.equal(result.csvAnalysis.state, 'ready');
});
test('CSV charges using the same history and keeps zero distinct from unavailable', () => {
  assert.equal(calculate(log({sign: 1}), {mode: 'charging', netCurrentMa: 400, netPowerW: 1.6}).timeToFull.minutes, 600);
  assert.equal(calculate(log({soc: 0}), {rawSoc: 0}).runtime.minutes, 0);
  assert.equal(calculate(log({count: 31})).runtime.state, 'collecting');
});
test('CSV gaps, resets, corrections and contradictory live join remove numeric estimates', () => {
  for (const [field, value] of [[1, '1799990000'], [2, '99'], [7, 'Charging']]) {
    const rows = log().split('\n'), cells = rows[40].split(',');
    assert.notEqual(cells[field], value);
    cells[field] = value; rows[40] = cells.join(',');
    assert.equal(calculate(rows.join('\n')).runtime.minutes, null);
  }
  assert.equal(calculate(log(), {rawSoc: 80}).runtime.minutes, null);
  assert.equal(calculate(log(), {sampleMonoSeconds: 600}).runtime.state, 'collecting');
});
test('stale, future or missing device time cannot make old CSV look current', () => {
  const base = {csv: parseBatteryCsv(log()), measurement: {schemaVersion: 2, rawSoc: 50, mode: 'discharging', netCurrentMa: -400, percentageSource: 'gauge88'}, calculatedAt: Date.now()};
  for (const deviceNowSeconds of [end + 121, end - 1, undefined]) {
    const result = estimateCsvBatteryTimes({...base, deviceNowSeconds});
    assert.equal(result.runtime.minutes, null);
    assert.equal(result.runtime.state, 'unavailable');
  }
});
test('CSV retains low voltage, full and tapering guards', () => {
  assert.equal(calculate(log(), {eodImminent: true}).runtime.state, 'low-battery');
  assert.equal(calculate(log({sign: 1, soc: 96}), {rawSoc: 96, mode: 'charging', netCurrentMa: 400}).timeToFull.state, 'tapering');
  assert.equal(calculate(log(), {mode: 'full', fullConfirmed: true}).timeToFull.state, 'full');
});
test('repository device sample parses without executing its scripts', () => {
  const text = readFileSync(new URL('../docs/superpowers/evidence/2026-11-16-battery-88/battery-log.csv', import.meta.url), 'utf8');
  assert.equal(parseBatteryCsv(text).rows.length, 8000);
});

test('strict required numeric fields retain each rejected record as a boundary', () => {
  const original = log().split('\n')[1].split(',');
  for (const [index, value] of [[1, '-1'], [1, '1.5'], [1, 'Infinity'], [2, '-0.1'], [2, '100.1'],
    [2, ''], [2, '0x32'], [3, '0'], [4, 'NaN'], [5, 'Infinity'], [6, ''], [7, '']]) {
    const cells = [...original]; cells[index] = value;
    const parsed = parseBatteryCsv(header + '\n' + cells.join(','));
    assert.equal(parsed.invalidRows, 1, `field ${index}: ${value}`);
    assert.equal(parsed.rows[0], null);
  }
});

test('CSV enforces 50000 records while allowing the exact limit', () => {
  const row = 'ignored,1800000000,50,4000,-400,-1.6,31,Discharging\n';
  assert.equal(parseBatteryCsv(header + '\n' + row.repeat(50000)).rows.length, 50000);
  assert.throws(() => parseBatteryCsv(header + '\n' + row.repeat(50001)), /limit/i);
});

test('CSV enforces the 4 MiB UTF-8 limit including non-ASCII display fields', () => {
  const suffix = ',1800000000,50,4000,-400,-1.6,31,Discharging';
  const prefix = header + '\n';
  const atLimit = prefix + 'd'.repeat(4 * 1024 * 1024 - prefix.length - suffix.length) + suffix;
  assert.equal(parseBatteryCsv(atLimit).rows.length, 1);
  assert.throws(() => parseBatteryCsv(atLimit + 'd'), /limit/i);
  assert.throws(() => parseBatteryCsv(prefix + '\ud83d\udd0b'.repeat(1024 * 1024) + suffix), /limit/i);
  assert.throws(() => parseBatteryCsv(null));
});

test('irregular intervals use actual duration rather than record count', () => {
  let ts = end - 3600;
  const lines = Array.from({ length: 61 }, (_, index) => {
    if (index > 0) ts += index % 2 === 1 ? 30 : 90;
    return `ignored,${ts},${50 + (end - ts) / 720},4000,-400,-1.6,31,Discharging`;
  });
  assert.equal(calculate(header + '\n' + lines.join('\n')).runtime.minutes, 600);
});

test('a 121 second interval prevents bridging a completed hour', () => {
  const lines = log().split('\n');
  for (let index = 41; index < lines.length; index++) {
    const cells = lines[index].split(','); cells[1] = String(Number(cells[1]) + 61); lines[index] = cells.join(',');
  }
  const result = estimateCsvBatteryTimes({ csv: parseBatteryCsv(lines.join('\n')),
    measurement: fixtures.estimateCases[0].measurement, deviceNowSeconds: end + 61, calculatedAt: 1900000000000 });
  assert.equal(result.runtime.minutes, null);
  assert.equal(result.runtime.state, 'collecting');
});

test('trailing invalid CSV never falls back to the earlier complete segment', () => {
  const result = calculate(log() + '\n\n');
  assert.equal(result.runtime.minutes, null);
  assert.equal(result.csvAnalysis.state, 'unavailable');
});

test('unknown CSV status is a continuity boundary', () => {
  const lines = log().split('\n'); lines[50] = lines[50].replace('Discharging', 'Balancing');
  assert.equal(calculate(lines.join('\n')).runtime.minutes, null);
});

test('live timestamp elapsed before the current boot cannot join CSV', () => {
  const result = estimateCsvBatteryTimes({ csv: parseBatteryCsv(log()), calculatedAt: 1900000000000,
    deviceNowSeconds: end + 60, measurement: { ...fixtures.estimateCases[0].measurement, sampleMonoSeconds: 30 } });
  assert.equal(result.runtime.minutes, null);
  assert.equal(result.csvAnalysis.state, 'collecting');
});
