import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';

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

test('desktop gauge reads do not replace or send the factory login cookie', async () => {
  const { default: routerHttp } = await import('../desktop/router-http.js');
  const { default: session } = await import('../desktop/session.js');
  let cookie;
  const upstream = createServer((req, res) => {
    cookie = req.headers.cookie;
    res.setHeader('X-Gauge-Age', '0.5');
    res.setHeader('Set-Cookie', 'login=gauge');
    res.end('{}');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  session.replace('login=factory');
  try {
    const result = await routerHttp.request({ url: `http://127.0.0.1:${upstream.address().port}/state.json` });
    assert.equal(result.ok, true);
    assert.equal(cookie, undefined);
    assert.equal(session.header(), 'login=factory');
    assert.equal(result.headers['X-Gauge-Age'], '0.5');
  } finally { session.clear(); await new Promise(resolve => upstream.close(resolve)); }
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
