import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate } from '../src/utils/format.js';

test('history timestamps keep the local date format without constructing locale formatting per row', () => {
  const original = Date.prototype.toLocaleString;
  let perRowFormats = 0;
  Date.prototype.toLocaleString = function (...args) { perRowFormats++; return original.apply(this, args); };
  try {
    const timestamp = new Date(2026, 8, 28, 11, 12, 0).getTime();
    assert.equal(formatDate(timestamp), '2026/9/28 11:12:00');
    assert.equal(formatDate(timestamp + 60000), '2026/9/28 11:13:00');
    assert.equal(formatDate(null), '—');
    assert.equal(perRowFormats, 0, 'scrolling history must reuse Intl.DateTimeFormat');
  } finally { Date.prototype.toLocaleString = original; }
});
