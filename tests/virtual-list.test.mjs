import assert from 'node:assert/strict';
import { test } from 'node:test';

let virtualListRange;
try { ({ virtualListRange } = await import('../src/utils/virtual-list.js')); } catch {}

test('a full day of history renders only the viewport and overscan while preserving scroll height', () => {
  assert.equal(typeof virtualListRange, 'function', 'history needs bounded viewport rendering');
  const range = virtualListRange({ count: 1440, scrollOffset: 6300, viewportHeight: 630, rowHeight: 63, overscan: 4 });
  assert.deepEqual(range, { start: 96, end: 114, offset: 6048, totalHeight: 90720 });
});

test('virtual history includes the newest and oldest records without out-of-bounds rows', () => {
  assert.equal(typeof virtualListRange, 'function');
  assert.deepEqual(virtualListRange({ count: 0, scrollOffset: 0, viewportHeight: 630, rowHeight: 63, overscan: 4 }), { start: 0, end: 0, offset: 0, totalHeight: 0 });
  const top = virtualListRange({ count: 1440, scrollOffset: -126, viewportHeight: 630, rowHeight: 63, overscan: 4 });
  assert.equal(top.start, 0);
  assert.equal(top.end, 12);
  const bottom = virtualListRange({ count: 1440, scrollOffset: 90342, viewportHeight: 630, rowHeight: 63, overscan: 4 });
  assert.equal(bottom.start, 1430);
  assert.equal(bottom.end, 1440);
});
