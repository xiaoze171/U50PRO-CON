import { normalizeBatteryEndpoint, sanitizeBatteryMeasurement } from './battery-gauge.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const nullableString = value => value === null || typeof value === 'string';
const modes = new Set(['charging', 'discharging', 'full', 'confirming', 'external', 'unknown']);
const identityKeys = ['percentageSource', 'endpoint', 'mode', 'bootId', 'usableCapacityMah', 'capacityBasis', 'anchorIdentity'];
let segmentSequence = 0;
const nextSegmentId = () => `js-${Date.now().toString(36)}-${++segmentSequence}-${Math.random().toString(36).slice(2)}`;

function canonicalIdentity(value) {
  if (!value || typeof value !== 'object' || identityKeys.some(key => !Object.hasOwn(value, key))
      || !['gauge88', 'router'].includes(value.percentageSource) || !modes.has(value.mode)
      || typeof value.endpoint !== 'string' || !nullableString(value.bootId)
      || !nullableString(value.capacityBasis) || !nullableString(value.anchorIdentity)
      || !(value.usableCapacityMah === null || finite(value.usableCapacityMah) && value.usableCapacityMah > 0)) return null;
  return {
    percentageSource: value.percentageSource, endpoint: normalizeBatteryEndpoint(value.endpoint), mode: value.mode,
    bootId: value.bootId, usableCapacityMah: value.usableCapacityMah,
    capacityBasis: value.capacityBasis, anchorIdentity: value.anchorIdentity
  };
}

export function batteryMeasurementIdentity({ measurement, endpoint, percentageSource } = {}) {
  if (!measurement) return null;
  return canonicalIdentity({
    percentageSource: percentageSource ?? measurement.percentageSource,
    endpoint: endpoint ?? measurement.endpoint ?? '', mode: measurement.mode,
    bootId: measurement.bootId ?? null, usableCapacityMah: measurement.usableCapacityMah ?? null,
    capacityBasis: measurement.capacityBasis ?? null, anchorIdentity: measurement.anchorIdentity ?? null
  });
}

export function sameBatteryIdentity(a, b) {
  const left = canonicalIdentity(a), right = canonicalIdentity(b);
  return left !== null && right !== null && JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeBatteryCurrentStats(value) {
  const identity = canonicalIdentity(value?.identity);
  if (!identity || typeof value.segmentId !== 'string' || !value.segmentId
      || typeof value.blockId !== 'string' || !value.blockId
      || !Number.isSafeInteger(value.revision) || value.revision < 1
      || !finite(value.startAt) || !finite(value.endAt) || value.startAt < 0 || value.endAt <= value.startAt
      || !finite(value.integralMaMs) || !finite(value.observedDurationMs) || value.observedDurationMs <= 0
      || value.observedDurationMs > value.endAt - value.startAt
      || !Number.isSafeInteger(value.sampleCount) || value.sampleCount < 0) return null;
  return {
    segmentId: value.segmentId, blockId: value.blockId, revision: value.revision,
    startAt: value.startAt, endAt: value.endAt, integralMaMs: value.integralMaMs,
    observedDurationMs: value.observedDurationMs, sampleCount: value.sampleCount, identity
  };
}

function copyBlock(block) { return { ...block, identity: { ...block.identity } }; }
function overlaps(a, b) { return a.startAt < b.endAt && b.startAt < a.endAt; }

// Whole archived blocks are indivisible: never estimate the integral of an
// unknown partial block. Newer complete coverage wins an overlap.
function selectBlocks(values) {
  const byId = new Map();
  for (const block of values) {
    const previous = byId.get(block.blockId);
    if (!previous || block.revision > previous.revision
        || block.revision === previous.revision && block.endAt >= previous.endAt) byId.set(block.blockId, block);
  }
  const selected = [];
  for (const block of [...byId.values()].sort((a, b) => b.endAt - a.endAt
      || (b.observedDurationMs / (b.endAt - b.startAt)) - (a.observedDurationMs / (a.endAt - a.startAt))
      || b.revision - a.revision || a.blockId.localeCompare(b.blockId))) {
    if (!selected.some(previous => overlaps(previous, block))) selected.push(block);
  }
  return selected.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
}

export function createBatteryCurrentWindow({ windowMs = 300000, maxGapMs = 120000 } = {}) {
  if (!finite(windowMs) || windowMs <= 0 || !finite(maxGapMs) || maxGapMs <= 0) throw new Error('Invalid battery window');
  let identity = null, previous = null, receivedAt = null, segmentId, identityBoundaryAt;
  let local = new Map(), restored = [];
  function reset() {
    identity = null; previous = null; receivedAt = null;
    identityBoundaryAt = -Infinity;
    local = new Map(); restored = [];
    segmentId = nextSegmentId();
  }
  reset();

  function prune() {
    if (receivedAt === null) return;
    const cutoff = receivedAt - windowMs;
    for (const [id, block] of local) if (block.endAt <= cutoff || block.startAt < identityBoundaryAt) local.delete(id);
    restored = restored.filter(block => block.startAt >= Math.max(cutoff, identityBoundaryAt) && block.endAt <= receivedAt);
  }

  function selectedBlocks() {
    prune();
    const blocks = selectBlocks([...restored, ...local.values()]);
    let first = blocks.length;
    let nextStart = previous?.receivedAt ?? receivedAt;
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (nextStart !== null && nextStart - blocks[index].endAt > maxGapMs) break;
      first = index;
      nextStart = blocks[index].startAt;
    }
    return blocks.slice(first);
  }

  function currentStats() {
    return selectedBlocks().map(block => copyBlock(normalizeBatteryCurrentStats(block)));
  }

  function snapshot() {
    const blocks = selectedBlocks();
    let integral = 0, duration = 0, sampleCount = 0, start = null, end = null;
    const cutoff = receivedAt === null ? -Infinity : receivedAt - windowMs;
    for (const block of blocks) {
      let blockStart = block.startAt, blockEnd = block.endAt;
      if (block.parts) {
        blockStart = Math.max(blockStart, cutoff);
        for (const part of block.parts) {
          const from = Math.max(part.startAt, cutoff), to = part.endAt;
          if (from >= to) continue;
          const fraction = (from - part.startAt) / (part.endAt - part.startAt);
          const firstCurrent = part.fromMa * (1 - fraction) + part.toMa * fraction;
          integral += (firstCurrent / 2 + part.toMa / 2) * (to - from);
          duration += to - from;
        }
        sampleCount += [...block.points].filter(time => time >= cutoff).length;
      } else {
        integral += block.integralMaMs; duration += block.observedDurationMs; sampleCount += block.sampleCount;
      }
      start = start === null ? blockStart : Math.min(start, blockStart);
      end = end === null ? blockEnd : Math.max(end, blockEnd);
    }
    return {
      meanCurrentMa: duration > 0 && finite(integral) ? integral / duration : null,
      observedDurationMs: duration, sampleCount: duration > 0 ? sampleCount : previous ? 1 : 0,
      windowStart: start, windowEnd: end, identity: identity ? { ...identity } : null,
      latestReceivedAt: previous?.receivedAt ?? null,
      currentStats: blocks.map(block => copyBlock(normalizeBatteryCurrentStats(block)))
    };
  }

  function integrate(from, to) {
    let cursor = from.receivedAt;
    let initial = ![...local.values()].some(block => block.segmentId === segmentId);
    while (cursor < to.receivedAt) {
      const minute = Math.floor(cursor / 60000) * 60000;
      const until = Math.min(to.receivedAt, minute + 60000);
      const blockId = `${segmentId}:${minute}`;
      let block = local.get(blockId);
      if (!block) {
        block = { segmentId, blockId, revision: 0, startAt: cursor, endAt: cursor,
          integralMaMs: 0, observedDurationMs: 0, sampleCount: 0, identity: { ...identity }, parts: [], points: new Set() };
        local.set(blockId, block);
      }
      const currentAt = time => {
        const fraction = (time - from.receivedAt) / (to.receivedAt - from.receivedAt);
        return from.netCurrentMa * (1 - fraction) + to.netCurrentMa * fraction;
      };
      const fromMa = currentAt(cursor), toMa = currentAt(until);
      const integral = (fromMa / 2 + toMa / 2) * (until - cursor);
      if (!finite(integral) || !finite(block.integralMaMs + integral)) return false;
      block.parts.push({ startAt: cursor, endAt: until, fromMa, toMa });
      block.integralMaMs += integral;
      block.observedDurationMs += until - cursor;
      block.endAt = until;
      if (initial && cursor === from.receivedAt && !restored.some(value => value.endAt === cursor)) block.points.add(cursor);
      if (until === to.receivedAt) block.points.add(until);
      block.sampleCount = block.points.size;
      block.revision += 1;
      initial = false;
      cursor = until;
    }
    return true;
  }

  function ingest(input = {}) {
    const measurement = sanitizeBatteryMeasurement(input.measurement);
    const nextIdentity = batteryMeasurementIdentity({ measurement, endpoint: input.endpoint });
    if (!measurement || !nextIdentity || !finite(input.receivedAt) || input.receivedAt < 0
        || !finite(measurement.netCurrentMa)) { reset(); return snapshot(); }
    const point = { receivedAt: input.receivedAt, netCurrentMa: measurement.netCurrentMa,
      mono: measurement.sampleMonoSeconds };
    if (!sameBatteryIdentity(identity, nextIdentity)) reset();
    if (previous) {
      const elapsed = point.receivedAt - previous.receivedAt;
      const monoElapsed = point.mono !== null && previous.mono !== null ? (point.mono - previous.mono) * 1000 : null;
      if (elapsed <= 0 || monoElapsed !== null && monoElapsed <= 0) return snapshot();
      if (elapsed > maxGapMs || monoElapsed !== null && monoElapsed > maxGapMs) reset();
    }
    identity = nextIdentity;
    receivedAt = point.receivedAt;
    if (previous && !integrate(previous, point)) {
      reset(); identity = nextIdentity; receivedAt = point.receivedAt;
    }
    previous = point;
    return snapshot();
  }

  function restore(values, options = {}) {
    const nextIdentity = canonicalIdentity(options.identity);
    if (!nextIdentity || !finite(options.receivedAt) || options.receivedAt < 0) return snapshot();
    if (identity && !sameBatteryIdentity(identity, nextIdentity)) reset();
    identity = nextIdentity;
    receivedAt = Math.max(receivedAt ?? 0, options.receivedAt);
    const cutoff = receivedAt - windowMs;
    const candidates = (Array.isArray(values) ? values : []).map(normalizeBatteryCurrentStats).filter(block => block
      && block.identity.percentageSource === identity.percentageSource && block.identity.endpoint === identity.endpoint
      && block.startAt >= cutoff && block.endAt <= receivedAt);
    for (const block of candidates) {
      if (!sameBatteryIdentity(block.identity, identity)) identityBoundaryAt = Math.max(identityBoundaryAt, block.endAt);
    }
    const imported = candidates.filter(block => sameBatteryIdentity(block.identity, identity) && block.startAt >= identityBoundaryAt);
    if (previous && previous.receivedAt < identityBoundaryAt) { previous = null; segmentId = nextSegmentId(); }
    if (previous && imported.some(block => block.endAt > previous.receivedAt)) {
      previous = null;
      segmentId = nextSegmentId();
    }
    // Local blocks remain local so that their known linear samples can be clipped
    // exactly at the rolling-window boundary; imported blocks cannot be clipped.
    restored = selectBlocks([...restored, ...imported]).filter(block => !local.has(block.blockId)
      || block.revision > local.get(block.blockId).revision);
    return snapshot();
  }

  return { ingest, reset, snapshot, restore, currentStats };
}
