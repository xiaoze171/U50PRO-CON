import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const module = await import('../src/utils/battery-estimate.js').catch(() => ({}));
const base = JSON.parse(readFileSync(new URL('./fixtures/battery-estimate-cases.json', import.meta.url), 'utf8')).measurementCases[0].expected;
const at = 1800000060000;
function estimate(changes = {}, window = {}, samples = [], runtimeTargetPercent = 0) {
  assert.equal(typeof module.estimateBatteryTimes, 'function');
  return module.estimateBatteryTimes({ measurement: { ...base, ...changes },
    currentWindow: { meanCurrentMa: -400, observedDurationMs: 60000, sampleCount: 3,
      windowStart: at - 60000, windowEnd: at, ...window }, samples, calculatedAt: at, runtimeTargetPercent });
}

test('known 4000 mAh remainder supplies 400 mA for ten hours, independent charging result', () => {
  const result = estimate();
  assert.equal(result.runtime.minutes, 600);
  assert.equal(result.runtime.method, 'net-current');
  assert.equal(result.timeToFull.minutes, null);
  assert.equal(result.timeToFull.state, 'not-applicable');
  assert.equal(result.calculatedAt, at);
  assert.equal(result.windowSeconds, 60);
  assert.equal(Object.hasOwn(result, 'samples'), false);
});

test('known 4000 mAh deficit at 1000 mA needs four hours and no unplugged runtime', () => {
  const result = estimate({ mode: 'charging', netCurrentMa: 1000 }, { meanCurrentMa: 1000 });
  assert.equal(result.timeToFull.minutes, 240);
  assert.equal(result.runtime.minutes, null);
});

test('target20 gives six hours, target0 ten hours; raw SOC and real zero are preserved', () => {
  assert.equal(estimate({}, {}, [], 20).runtime.minutes, 360);
  assert.equal(estimate({ rawSoc: 0 }).runtime.minutes, 0);
  assert.equal(estimate({ rawSoc: 50.1234 }).runtime.minutes, 601.4808);
  assert.equal(estimate({ usableCapacityMah: 9000 }).runtime.minutes, 675);
});

test('three instants and sixty seconds of coverage required', () => {
  assert.equal(estimate({}, { observedDurationMs: 59999 }).runtime.state, 'collecting');
  assert.equal(estimate({}, { sampleCount: 2 }).runtime.state, 'collecting');
});

test('tapering full confirmation and confirmed full remain independent states', () => {
  assert.equal(estimate({ rawSoc: 95, mode: 'charging', netCurrentMa: 1000 }, { meanCurrentMa: 1000 }).timeToFull.state, 'tapering');
  assert.equal(estimate({ rawSoc: 97 }).runtime.minutes, 1164);
  assert.equal(estimate({ rawSoc: 100, mode: 'confirming', fullConfirmed: false, fullAnchorValid: true }).timeToFull.state, 'confirming');
  assert.equal(estimate({ rawSoc: 100, mode: 'full', fullConfirmed: true }).timeToFull.state, 'full');
});

test('low voltage overrides runtime and USB discharge still produces runtime', () => {
  for (const flag of ['eodImminent', 'eodClamp']) {
    const result = estimate({ [flag]: true });
    assert.equal(result.runtime.state, 'low-battery'); assert.equal(result.runtime.minutes, null);
  }
  assert.equal(estimate({ externalPower: true }).runtime.minutes, 600);
  const external = estimate({ mode: 'external', netCurrentMa: 0 });
  assert.equal(external.runtime.state, 'external'); assert.equal(external.timeToFull.minutes, null);
});

test('unknown direction bad measurement and wrong signed average do not predict', () => {
  assert.equal(estimate({ mode: 'unknown' }).runtime.state, 'unknown');
  assert.equal(estimate({}, { meanCurrentMa: 400 }).runtime.state, 'unknown');
  assert.equal(estimate({ rawSoc: null }).runtime.state, 'unavailable');
  assert.equal(estimate({ rawSoc: '50' }).runtime.state, 'unavailable');
});

function history({ source = 'gauge88', minutes = 10, start = 52, step = -0.2, changes = {} } = {}) {
  return Array.from({ length: minutes + 1 }, (_, index) => ({
    timestamp: at - (minutes - index) * 60000, percent: start + index * step,
    percentSource: source, percentEndpoint: base.endpoint, charging: false,
    measurement: { ...base, percentageSource: source, rawSoc: start + index * step, sampleMonoSeconds: index * 60, ...changes }
  }));
}

test('missing current or capacity permits robust SOC fallback with source filtering first', () => {
  const samples = history();
  samples.splice(5, 0, { ...samples[5], percentEndpoint: 'http://other.invalid:88/state.json', measurement: { ...samples[5].measurement, endpoint: 'http://other.invalid:88/state.json' } });
  const result = estimate({ netCurrentMa: null }, {}, samples);
  assert.ok(Math.abs(result.runtime.minutes - 250) < 1e-8);
  assert.equal(result.runtime.method, 'soc-slope');
  assert.equal(estimate({ usableCapacityMah: null }, {}, history({ changes: { usableCapacityMah: null } })).runtime.method, 'soc-slope');
});

test('valid near-zero current cannot be bypassed by historical SOC', () => {
  for (const current of [0, -49]) {
    const result = estimate({ netCurrentMa: current }, { meanCurrentMa: current }, history());
    assert.equal(result.runtime.state, 'low-current'); assert.equal(result.runtime.minutes, null);
  }
  assert.equal(estimate({}, { meanCurrentMa: -50 }).runtime.minutes, 4800);
});

test('fallback respects minimum span magnitude state gaps and current identity', () => {
  assert.equal(estimate({ netCurrentMa: null }, {}, history({ minutes: 9 })).runtime.state, 'collecting');
  assert.equal(estimate({ netCurrentMa: null }, {}, history({ step: -0.01 })).runtime.state, 'collecting');
  const samples = history(); samples.splice(4, 3);
  assert.equal(estimate({ netCurrentMa: null }, {}, samples).runtime.state, 'collecting');
  assert.equal(estimate({ netCurrentMa: null, capacityBasis: 'different' }, {}, history()).runtime.state, 'collecting');
  assert.equal(estimate({ netCurrentMa: null }, {}, history({ step: 0.2 })).runtime.state, 'collecting');
});

test('factory coarse one-percent steps use long-pair median without software jump rule', () => {
  const samples = history({ source: 'router', minutes: 20, start: 52, step: 0 }).map((sample, index) => ({
    ...sample, percent: 52 - Math.floor(index / 10), measurement: null
  }));
  const result = estimate({ percentageSource: 'router', netCurrentMa: null, usableCapacityMah: null }, {}, samples);
  assert.equal(result.runtime.method, 'soc-slope');
  assert.ok(result.runtime.minutes >= 450 && result.runtime.minutes <= 750);
});

test('software corrections and factory huge jumps split compatible slopes', () => {
  const samples = history();
  samples[5] = { ...samples[5], percent: 80, measurement: { ...samples[5].measurement, rawSoc: 80 } };
  assert.equal(estimate({ netCurrentMa: null }, {}, samples).runtime.state, 'collecting');
  const factory = history({ source: 'router' }).map(sample => ({ ...sample, measurement: null }));
  factory[5].percent = 80;
  assert.equal(estimate({ percentageSource: 'router', netCurrentMa: null, usableCapacityMah: null }, {}, factory).runtime.state, 'collecting');
});

test('stale windows and mismatched current identities cannot generate a current estimate', () => {
  assert.equal(estimate({}, { windowEnd: at - 121000 }).runtime.state, 'collecting');
  assert.equal(estimate({}, { identity: { percentageSource: 'gauge88', endpoint: base.endpoint, mode: 'discharging', bootId: 'other', usableCapacityMah: 8000, capacityBasis: 'fixture', anchorIdentity: base.anchorIdentity } }).runtime.state, 'collecting');
});

test('instantaneous near-zero current still allows a sufficient signed average', () => {
  assert.equal(estimate({ netCurrentMa: -10 }).runtime.minutes, 600);
  assert.equal(estimate({ netCurrentMa: 0 }, { meanCurrentMa: -400 }).runtime.method, 'net-current');
});

test('fallback reverse monotonic clock splits the compatible history', () => {
  const samples = history(); samples[5].measurement.sampleMonoSeconds = 1;
  assert.equal(estimate({ netCurrentMa: null }, {}, samples).runtime.state, 'collecting');
});

test('software fallback rejects SOC jumps against measured net-current direction', () => {
  const samples = history({ minutes: 20, start: 50, step: 0.02, changes: { mode: 'charging', netCurrentMa: -100 } });
  const result = estimate({ rawSoc: 50.4, mode: 'charging', netCurrentMa: null }, { meanCurrentMa: null }, samples);
  assert.equal(result.timeToFull.state, 'collecting');
});
