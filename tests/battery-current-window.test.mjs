import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const module = await import('../src/utils/battery-current-window.js').catch(() => ({}));
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/battery-estimate-cases.json', import.meta.url), 'utf8'));
const base = fixtures.measurementCases[0].expected;
const at = 1800000000000;
function create() { assert.equal(typeof module.createBatteryCurrentWindow, 'function'); return module.createBatteryCurrentWindow(); }
function add(window, seconds, current = -400, changes = {}) {
  return window.ingest({ receivedAt: at + seconds * 1000, endpoint: base.endpoint,
    measurement: { ...base, sampleMonoSeconds: seconds, netCurrentMa: current, ...changes } });
}

for (const fixture of fixtures.windowCases) test(`current integration: ${fixture.name}`, () => {
  const window = create();
  fixture.timesSeconds.forEach((seconds, index) => add(window, seconds, fixture.currentsMa[index]));
  const result = window.snapshot();
  assert.ok(Math.abs(result.meanCurrentMa - fixture.meanCurrentMa) < 1e-8);
  assert.equal(result.observedDurationMs, fixture.observedDurationMs);
  assert.equal(result.sampleCount, fixture.sampleCount);
  assert.equal(result.currentStats.reduce((sum, block) => sum + block.sampleCount, 0), fixture.sampleCount);
});

test('minute boundaries split trapezoids without inventing samples', () => {
  const window = create();
  add(window, 50, -100); add(window, 70, -500);
  const blocks = window.currentStats();
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map(block => block.integralMaMs), [-2000000, -4000000]);
  assert.deepEqual(blocks.map(block => block.sampleCount), [1, 1]);
  assert.equal(window.snapshot().sampleCount, 2);
});

test('repeated mono and reverse samples add neither duration nor instants', () => {
  const window = create();
  add(window, 0); add(window, 30);
  const previous = window.snapshot();
  add(window, 40, -800, { sampleMonoSeconds: 30 });
  add(window, 50, -800, { sampleMonoSeconds: 20 });
  add(window, 20, -800);
  assert.deepEqual(window.snapshot(), previous);
  add(window, 60);
  assert.equal(window.snapshot().observedDurationMs, 60000);
  assert.equal(window.snapshot().sampleCount, 3);
});

test('receiver and mono gaps reset and never integrate an outage', () => {
  for (const change of [{ seconds: 160, mono: 160 }, { seconds: 40, mono: 200 }]) {
    const window = create(); add(window, 0); add(window, 30);
    const previousId = window.currentStats()[0].segmentId;
    add(window, change.seconds, -400, { sampleMonoSeconds: change.mono });
    assert.equal(window.snapshot().meanCurrentMa, null);
    add(window, change.seconds + 30, -400, { sampleMonoSeconds: change.mono + 30 });
    assert.notEqual(window.currentStats()[0].segmentId, previousId);
    assert.equal(window.snapshot().observedDurationMs, 30000);
  }
});

test('identity transitions reset mode capacity basis boot anchor source and endpoint', () => {
  for (const changes of [{ mode: 'charging' }, { usableCapacityMah: 9000 }, { capacityBasis: 'new' },
    { bootId: 'new' }, { anchorIdentity: 'new' }, { percentageSource: 'router' }]) {
    const window = create(); add(window, 0); add(window, 30); add(window, 60, -400, changes);
    assert.equal(window.snapshot().meanCurrentMa, null, JSON.stringify(changes));
  }
  const window = create(); add(window, 0); add(window, 30);
  window.ingest({ receivedAt: at + 60000, endpoint: 'http://other.invalid:88/state.json', measurement: { ...base, sampleMonoSeconds: 60 } });
  assert.equal(window.snapshot().meanCurrentMa, null);
});

test('rolling window clips known live intervals and expires old instants', () => {
  const window = create();
  for (let seconds = 0; seconds <= 330; seconds += 30) add(window, seconds);
  const result = window.snapshot();
  assert.equal(result.observedDurationMs, 300000);
  assert.equal(result.windowStart, at + 30000);
  assert.equal(result.meanCurrentMa, -400);
  assert.equal(result.sampleCount, 11);
  assert.ok(window.currentStats().length <= 6);
});

function block(overrides = {}) {
  return { segmentId: 'segment-a', blockId: 'segment-a:0', revision: 1,
    startAt: at, endAt: at + 30000, integralMaMs: -12000000, observedDurationMs: 30000, sampleCount: 2,
    identity: module.batteryMeasurementIdentity({ measurement: base, endpoint: base.endpoint }), ...overrides };
}

test('restore deduplicates revisions and retains distinct nonoverlapping segments within one minute', () => {
  const window = create();
  const a = block(), newer = block({ revision: 2, integralMaMs: -18000000 });
  const b = block({ segmentId: 'segment-b', blockId: 'segment-b:0', startAt: at + 30000,
    endAt: at + 45000, observedDurationMs: 15000, integralMaMs: -6000000, sampleCount: 1 });
  const c = block({ segmentId: 'segment-c', blockId: 'segment-c:0', startAt: at + 45000,
    endAt: at + 60000, observedDurationMs: 15000, integralMaMs: -6000000, sampleCount: 1 });
  window.restore([a, newer, b, c, newer], { receivedAt: at + 60000, identity: a.identity });
  assert.equal(window.snapshot().observedDurationMs, 60000);
  assert.equal(window.snapshot().meanCurrentMa, -500);
  assert.equal(window.snapshot().sampleCount, 4);
  assert.equal(window.currentStats().length, 3);
  window.restore([a, newer, b, c], { receivedAt: at + 60000, identity: a.identity });
  assert.equal(window.snapshot().observedDurationMs, 60000);
});

test('restore rejects stale future partial malformed different-identity and overlapping blocks', () => {
  const window = create(), a = block();
  const cases = [
    block({ startAt: at - 301000 }), block({ endAt: at + 61000 }), block({ observedDurationMs: 31000 }),
    block({ integralMaMs: '-12000000' }), block({ revision: 0 }), block({ identity: null }),
    block({ identity: { ...a.identity, bootId: 'other' } })
  ];
  window.restore(cases, { receivedAt: at + 60000, identity: a.identity });
  assert.equal(window.snapshot().meanCurrentMa, null);
  window.reset();
  const overlapping = block({ segmentId: 'new', blockId: 'new:0', startAt: at + 15000,
    endAt: at + 45000, integralMaMs: -24000000 });
  window.restore([a, overlapping], { receivedAt: at + 60000, identity: a.identity });
  assert.equal(window.snapshot().observedDurationMs, 30000);
  assert.equal(window.snapshot().meanCurrentMa, -800);
});

test('restore plus live never counts the same time twice and does not bridge a handoff', () => {
  const window = create(), archived = block({ endAt: at + 60000, observedDurationMs: 60000, integralMaMs: -24000000, sampleCount: 3 });
  add(window, 60); window.restore([archived], { receivedAt: at + 60000, identity: archived.identity });
  assert.equal(window.snapshot().observedDurationMs, 60000);
  add(window, 90);
  assert.equal(window.snapshot().observedDurationMs, 90000);
  window.restore([...window.currentStats(), archived], { receivedAt: at + 90000, identity: archived.identity });
  assert.equal(window.snapshot().observedDurationMs, 90000);
});

test('canonical identities normalize endpoints and reject absent keys', () => {
  create();
  const a = module.batteryMeasurementIdentity({ measurement: base, endpoint: 'HTTP://FIXTURE.INVALID:88/state.json/?x=1#fragment' });
  const b = module.batteryMeasurementIdentity({ measurement: base, endpoint: base.endpoint });
  assert.equal(module.sameBatteryIdentity(a, b), true);
  assert.equal(module.sameBatteryIdentity({}, b), false);
  assert.equal(module.normalizeBatteryCurrentStats(block({ identity: {} })), null);
});

test('newer restored coverage breaks pending local sampling continuity', () => {
  const window = create(); add(window, 0); add(window, 30);
  const archived = block({ segmentId: 'background', blockId: 'background:1', startAt: at + 30000,
    endAt: at + 60000, integralMaMs: -12000000, sampleCount: 1 });
  window.restore([archived], { receivedAt: at + 60000, identity: archived.identity });
  add(window, 90);
  assert.equal(window.snapshot().observedDurationMs, 60000, 'do not invent current coverage from60to90');
  add(window, 120);
  assert.equal(window.snapshot().observedDurationMs, 90000);
});

test('invalid and missing current reset before future valid readings resume', () => {
  const window = create(); add(window, 0); add(window, 30);
  add(window, 60, null); add(window, 90);
  assert.equal(window.snapshot().meanCurrentMa, null);
  add(window, 120);
  assert.equal(window.snapshot().observedDurationMs, 30000);
});

test('restoration never includes a whole block crossing the cutoff', () => {
  const window = create(), archived = block({ startAt: at - 10000, endAt: at + 10000,
    observedDurationMs: 20000, integralMaMs: -8000000 });
  window.restore([archived], { receivedAt: at + 300000, identity: archived.identity });
  assert.equal(window.snapshot().observedDurationMs, 0);
});

test('restored current uses only the latest segment after a gap over120seconds', () => {
  const window = create(), early = block();
  const late = block({ segmentId: 'late', blockId: 'late:3', startAt: at + 180000,
    endAt: at + 210000, integralMaMs: -24000000 });
  window.restore([early, late], { receivedAt: at + 210000, identity: early.identity });
  assert.equal(window.snapshot().observedDurationMs, 30000);
  assert.equal(window.snapshot().meanCurrentMa, -800);
  assert.equal(window.snapshot().sampleCount, 2);
});

test('restored old coverage cannot survive a gap before the first current read', () => {
  const window = create(), early = block();
  add(window, 180);
  window.restore([early], { receivedAt: at + 180000, identity: early.identity });
  assert.equal(window.snapshot().observedDurationMs, 0);
});

test('finite but overflowing input cannot create infinite statistics or throw', () => {
  const window = create(); add(window, 0, -1e308);
  assert.doesNotThrow(() => add(window, 30, -1e308));
  assert.equal(window.snapshot().meanCurrentMa, null);
  assert.deepEqual(window.currentStats(), []);
});

test('restore same-endpoint identity roundtrips retain only coverage after the intervening boundary', () => {
  for (const change of [{ mode: 'charging' }, { bootId: 'other' }, { usableCapacityMah: 9000 }, { capacityBasis: 'other' }, { anchorIdentity: 'other' }]) {
    const window = create(), early = block();
    const boundary = block({ segmentId: 'boundary', blockId: 'boundary:0', startAt: at + 30000,
      endAt: at + 45000, observedDurationMs: 15000, integralMaMs: -6000000,
      identity: { ...early.identity, ...change } });
    const late = block({ segmentId: 'late', blockId: 'late:0', startAt: at + 45000,
      endAt: at + 75000, integralMaMs: -24000000 });
    window.restore([early, boundary, late], { receivedAt: at + 75000, identity: early.identity });
    assert.equal(window.snapshot().observedDurationMs, 30000, JSON.stringify(change));
    assert.equal(window.snapshot().meanCurrentMa, -800);
  }
});

test('unrelated endpoint archives are filtered before detecting restore boundaries', () => {
  const window = create(), early = block();
  const unrelated = block({ segmentId: 'other', blockId: 'other:0', startAt: at + 30000,
    endAt: at + 45000, observedDurationMs: 15000, integralMaMs: -6000000,
    identity: { ...early.identity, endpoint: 'http://other.invalid:88/state.json', mode: 'charging' } });
  const late = block({ segmentId: 'late', blockId: 'late:0', startAt: at + 45000,
    endAt: at + 75000, integralMaMs: -24000000 });
  window.restore([early, unrelated, late], { receivedAt: at + 75000, identity: early.identity });
  assert.equal(window.snapshot().observedDurationMs, 60000);
});
