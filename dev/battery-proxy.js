import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';

// Keep the desktop CommonJS transport outside Vite's ESM config bundle.
const routerHttp = createRequire(import.meta.url)('../desktop/router-http.js');

// Browser development uses the endpoint saved in Settings rather than a fixed port.
export function batteryProxyMiddleware(req, res) {
  let target;
  try {
    target = new URL(new URL(req.url, 'http://localhost').searchParams.get('url'));
    if (req.method !== 'GET' || !['http:', 'https:'].includes(target.protocol) ||
        target.username || target.password || target.pathname !== '/state.json' ||
        !routerHttp.isLocalRouterHost(target.hostname)) throw new Error();
  } catch { res.writeHead(400); res.end('Invalid battery endpoint'); return; }
  const upstream = (target.protocol === 'https:' ? https : http).get(target, {
    headers: { Accept: 'application/json' }, timeout: 2000
  }, response => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (response.headers['x-gauge-age'] != null) headers['X-Gauge-Age'] = response.headers['x-gauge-age'];
    res.writeHead(response.statusCode || 502, headers);
    response.pipe(res);
    response.on('error', () => res.destroy());
  });
  upstream.on('timeout', () => upstream.destroy(new Error('Battery endpoint timeout')));
  upstream.on('error', () => {
    if (!res.headersSent) { res.writeHead(502); res.end('Battery endpoint unavailable'); }
    else res.destroy();
  });
  res.on('close', () => upstream.destroy());
}
