import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, createUpdateChecker } from '../src/services/update-check.js';

test('versions compare numerically and reject malformed tags', () => {
  assert.equal(compareVersions('v1.3.100', '1.3.56'), 1);
  assert.equal(compareVersions('1.3.56', '1.3.56'), 0);
  assert.equal(compareVersions('1.2.9', '1.3.56'), -1);
  assert.equal(compareVersions('1.4.0-beta', '1.3.56'), null);
  assert.equal(compareVersions('invalid', '1.3.56'), null);
});

test('cache is bypassed by manual checks and version changes', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => ({ tag_name: 'v1.4.0', body: 'Changes' }) }; };
  const check = createUpdateChecker({ fetcher, storage });
  assert.equal((await check('1.3.56')).isNewer, true);
  await check('1.3.56');
  assert.equal(calls, 1);
  await check('1.3.56', true);
  assert.equal(calls, 2);
  assert.equal((await check('1.4.0')).isNewer, false);
  assert.equal(calls, 3);
});

test('missing releases, rate limits and invalid versions are not reported as up to date', async () => {
  for (const status of [404, 403, 500]) {
    const check = createUpdateChecker({ fetcher: async () => ({ ok: false, status }) });
    await assert.rejects(check('1.3.56'));
  }
  const check = createUpdateChecker({ fetcher: async () => ({ ok: true, json: async () => ({ tag_name: 'oops' }) }) });
  await assert.rejects(check('1.3.56'), /版本/);
});

test('storage failures do not prevent successful checks; concurrent checks share a request', async () => {
  let calls = 0;
  const check = createUpdateChecker({
    storage: { getItem() { throw Error(); }, setItem() { throw Error(); } },
    fetcher: async () => { calls++; return { ok: true, json: async () => ({ tag_name: 'v1.4.0' }) }; }
  });
  const results = await Promise.all([check('1.3.56'), check('1.3.56')]);
  assert.equal(calls, 1);
  assert.equal(results[0].isNewer, true);
});
