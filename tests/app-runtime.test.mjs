import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importBatteryProfileClient } from './helpers/battery-profile-client.mjs';

function installStorage(extra = {}) {
  const storage = new Map([['mu5120-config', { routerUrl: 'http://192.168.8.1', password: 'test-password' }]]);
  globalThis.uni = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    ...extra
  };
}

test('router operations reject a missing Android bridge without browser transport', async () => {
  let browserRequests = 0;
  installStorage({ request({ success }) {
    browserRequests++;
    success({ statusCode: 200, data: { loginfo: 'ok', result: '0' } });
  } });
  globalThis.window = {};
  const { routerApi } = await importBatteryProfileClient('factory');

  const login = await routerApi.login(true);
  assert.equal(login.loggedIn, false);
  assert.match(login.message, /Android.*桥接/);
  await assert.rejects(routerApi.dashboard(), /Android.*桥接/);
  assert.equal(browserRequests, 0);
});

test('native login sends direct URLs and form bodies through the Android callback', async () => {
  installStorage();
  const requests = [];
  globalThis.window = { AndroidRouter: {
    request(id, raw) {
      const payload = JSON.parse(raw);
      requests.push(payload);
      const url = new URL(payload.url);
      const fields = { loginfo: 'ok', wa_inner_version: 'test-version', cr_version: 'test-cr', LD: 'challenge' };
      const body = payload.method === 'POST' ? { result: '0' }
        : Object.fromEntries((url.searchParams.get('cmd') || '').split(',').map(key => [key, fields[key] || '']));
      queueMicrotask(() => window.__mu5120NativeResponse(id, JSON.stringify({ ok: true, status: 200, body: JSON.stringify(body) })));
    }
  } };
  const { routerApi } = await importBatteryProfileClient('factory');

  const login = await routerApi.login(true);
  assert.equal(login.loggedIn, true);
  assert.equal(login.firmware, 'test-version');
  assert.ok(requests.every(request => new URL(request.url).origin === 'http://192.168.8.1'));
  assert.equal(new URL(requests[0].url).pathname, '/index.html');
  const writes = requests.filter(request => request.method === 'POST');
  assert.equal(writes.length, 1);
  const form = new URLSearchParams(writes[0].body);
  assert.equal(form.get('goformId'), 'LOGIN');
  assert.match(form.get('password'), /^[A-F0-9]{64}$/);
  assert.equal(writes[0].headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
  assert.equal(writes[0].timeoutMs, 12000);
});

test('stock UI embeds the Android loopback proxy and falls back to full-screen navigation', async () => {
  installStorage();
  let port = 32123;
  globalThis.window = { AndroidRouter: { request() {}, getStockProxyPort: () => port } };
  const { routerApi } = await importBatteryProfileClient('factory');

  assert.equal(routerApi.stockUiOpenMode(), 'embed');
  assert.equal(routerApi.stockUiUrl(), 'http://127.0.0.1:32123/index.html');
  port = 0;
  assert.equal(routerApi.stockUiOpenMode(), 'navigate');
  assert.equal(routerApi.stockUiUrl(), 'http://192.168.8.1/index.html');
});
