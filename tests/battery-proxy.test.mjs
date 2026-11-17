import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('APK web build proxy loads without the desktop product and rejects public hosts', async () => {
  const temporaryRoot = resolve(tmpdir());
  const sandbox = await mkdtemp(join(temporaryRoot, 'u50pro-proxy-'));
  try {
    const isolatedModule = join(sandbox, 'dev', 'battery-proxy.mjs');
    await mkdir(dirname(isolatedModule));
    await copyFile(new URL('../dev/battery-proxy.js', import.meta.url), isolatedModule);
    const { batteryProxyMiddleware } = await import(pathToFileURL(isolatedModule).href);
    const proxy = createServer(batteryProxyMiddleware);
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    try {
      for (const endpoint of ['http://8.8.8.8/state.json', 'http://172.32.0.1/state.json',
        'http://example.com/backup/battery-log.csv', 'http://user:pass@localhost/state.json']) {
        const response = await fetch(`http://127.0.0.1:${proxy.address().port}/?url=${encodeURIComponent(endpoint)}`);
        assert.equal(response.status, 400, endpoint);
      }
    } finally {
      proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
    }
  } finally {
    assert.equal(dirname(resolve(sandbox)), temporaryRoot);
    assert.ok(sandbox.startsWith(join(temporaryRoot, 'u50pro-proxy-')));
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('browser battery proxy honors the selected endpoint and forwards gauge age', async () => {
  const { batteryProxyMiddleware } = await import('../dev/battery-proxy.js');
  let received;
  const upstream = createServer((req, res) => {
    received = req;
    res.setHeader('X-Gauge-Age', '0.890');
    res.setHeader('Content-Type', 'application/json');
    res.end('{"soc":22.6088,"data_quality":"ok"}');
  });
  const proxy = createServer(batteryProxyMiddleware);
  await Promise.all([new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)), new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))]);
  try {
    const endpoint = `http://127.0.0.1:${upstream.address().port}/state.json?t=123`;
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/?url=${encodeURIComponent(endpoint)}`, { headers: { Cookie: 'router=session' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-gauge-age'), '0.890');
    assert.equal((await response.json()).soc, 22.6088);
    assert.equal(received.url, '/state.json?t=123');
    assert.equal(received.headers.cookie, undefined);
    const rejected = await fetch(`http://127.0.0.1:${proxy.address().port}/?url=${encodeURIComponent(`http://127.0.0.1:${upstream.address().port}/goform`)}`);
    assert.equal(rejected.status, 400);
  } finally {
    proxy.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});

test('browser device CSV proxy forwards text without sending or absorbing router cookies', async () => {
  const { batteryProxyMiddleware } = await import('../dev/battery-proxy.js');
  let cookie;
  const upstream = createServer((req, res) => {
    cookie = req.headers.cookie;
    res.setHeader('Set-Cookie', 'login=gauge');
    res.setHeader('Content-Type', 'text/csv');
    res.end('ts,soc\r\n1,50\r\n');
  });
  const proxy = createServer(batteryProxyMiddleware);
  await Promise.all([new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)), new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))]);
  try {
    const endpoint = `http://127.0.0.1:${upstream.address().port}/backup/battery-log.csv`;
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/?url=${encodeURIComponent(endpoint)}`, { headers: { Cookie: 'router=session' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/csv/);
    assert.equal(await response.text(), 'ts,soc\r\n1,50\r\n');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(cookie, undefined);
  } finally {
    proxy.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});

test('browser CSV proxy rejects oversized downloads before publishing a successful body', async () => {
  const { batteryProxyMiddleware } = await import('../dev/battery-proxy.js');
  const upstream = createServer((req, res) => { res.end('x'.repeat(4 * 1024 * 1024 + 1)); });
  const proxy = createServer(batteryProxyMiddleware);
  await Promise.all([new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)), new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))]);
  try {
    const endpoint = `http://127.0.0.1:${upstream.address().port}/backup/battery-log.csv`;
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/?url=${encodeURIComponent(endpoint)}`);
    assert.equal(response.status, 502);
  } finally {
    proxy.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});
