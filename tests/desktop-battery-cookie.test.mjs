import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const routerHttp = require('../desktop/router-http.js');
const session = require('../desktop/session.js');

async function withServer(handler, check) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await check(`http://127.0.0.1:${server.address().port}`);
  } finally {
    session.clear();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('desktop battery redirects keep factory cookies isolated across the entire chain', async () => {
  const requests = [];
  await withServer((req, res) => {
    requests.push({ path: req.url, cookie: req.headers.cookie });
    res.setHeader('Set-Cookie', 'login=gauge');
    if (req.url === '/state.json') {
      res.writeHead(302, { Location: '/gauge/intermediate' });
    } else if (req.url === '/gauge/intermediate') {
      res.writeHead(307, { Location: '/gauge/reading' });
    } else {
      res.setHeader('X-Gauge-Age', '0.2');
      res.end('{"soc":24.5,"data_quality":"ok"}');
      return;
    }
    res.end();
  }, async origin => {
    session.replace('login=factory');
    const result = await routerHttp.request({ url: `${origin}/state.json` });
    assert.equal(result.ok, true);
    assert.deepEqual(requests, [
      { path: '/state.json', cookie: undefined },
      { path: '/gauge/intermediate', cookie: undefined },
      { path: '/gauge/reading', cookie: undefined }
    ]);
    assert.equal(session.header(), 'login=factory');
    assert.equal(JSON.parse(result.body).soc, 24.5);
    assert.equal(result.headers['X-Gauge-Age'], '0.2');
  });
});

test('desktop factory redirects still send and update the shared login session', async () => {
  const requests = [];
  await withServer((req, res) => {
    requests.push({ path: req.url, cookie: req.headers.cookie });
    if (req.url === '/goform/status') {
      res.writeHead(302, { Location: '/factory/status', 'Set-Cookie': 'login=factory-renewed' });
      res.end();
    } else {
      res.setHeader('Set-Cookie', 'login=factory-final');
      res.end('{}');
    }
  }, async origin => {
    session.replace('login=factory');
    const result = await routerHttp.request({ url: `${origin}/goform/status` });
    assert.equal(result.ok, true);
    assert.deepEqual(requests, [
      { path: '/goform/status', cookie: 'login=factory' },
      { path: '/factory/status', cookie: 'login=factory-renewed' }
    ]);
    assert.equal(session.header(), 'login=factory-final');
  });
});

test('desktop CSV text and all redirected hops stay isolated from factory cookies', async () => {
  const requests = [];
  await withServer((req, res) => {
    requests.push({ path: req.url, cookie: req.headers.cookie });
    res.setHeader('Set-Cookie', 'login=csv');
    if (req.url === '/backup/battery-log.csv') { res.writeHead(302, { Location: '/csv/actual' }); res.end(); }
    else { res.setHeader('Content-Type', 'text/csv'); res.end('ts,soc\n1,50\n'); }
  }, async origin => {
    session.replace('login=factory');
    const result = await routerHttp.request({ url: `${origin}/backup/battery-log.csv`, headers: { Cookie: 'leak=yes' } });
    assert.equal(result.ok, true);
    assert.equal(result.body, 'ts,soc\n1,50');
    assert.deepEqual(requests, [
      { path: '/backup/battery-log.csv', cookie: undefined },
      { path: '/csv/actual', cookie: undefined }
    ]);
    assert.equal(session.header(), 'login=factory');
  });
});

test('desktop CSV downloads stop at the body bound instead of returning truncated history', async () => {
  await withServer((req, res) => { res.end('x'.repeat(4 * 1024 * 1024 + 1)); }, async origin => {
    const result = await routerHttp.request({ url: `${origin}/backup/battery-log.csv` });
    assert.equal(result.ok, false);
    assert.match(result.error, /4 MiB|过大/);
    assert.equal(result.body, undefined);
  });
});
