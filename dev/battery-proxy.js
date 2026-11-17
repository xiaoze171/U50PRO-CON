import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';

// Keep the desktop CommonJS transport outside Vite's ESM config bundle.
const routerHttp = createRequire(import.meta.url)('../desktop/router-http.js');

// Browser development uses the profile's gauge host for both live state and CSV.
export function batteryProxyMiddleware(req, res) {
  let target;
  try {
    target = new URL(new URL(req.url, 'http://localhost').searchParams.get('url'));
    if (req.method !== 'GET' || !['http:', 'https:'].includes(target.protocol) ||
        target.username || target.password || !['/state.json', '/backup/battery-log.csv'].includes(target.pathname) ||
        !routerHttp.isLocalRouterHost(target.hostname)) throw new Error();
  } catch { res.writeHead(400); res.end('Invalid battery endpoint'); return; }
  const csv = target.pathname === '/backup/battery-log.csv';
  const maxBytes = csv ? 4 * 1024 * 1024 : 512 * 1024;
  const upstream = (target.protocol === 'https:' ? https : http).get(target, {
    headers: { Accept: csv ? 'text/csv, text/plain' : 'application/json' }, timeout: csv ? 5000 : 2000
  }, response => {
    const headers = { 'Content-Type': csv ? 'text/csv; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store' };
    if (response.headers['x-gauge-age'] != null) headers['X-Gauge-Age'] = response.headers['x-gauge-age'];
    const chunks = [];
    let bytes = 0;
    response.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { upstream.destroy(new Error('Battery response too large')); return; }
      chunks.push(chunk);
    });
    response.on('end', () => {
      if (bytes > maxBytes || res.writableEnded) return;
      res.writeHead(response.statusCode || 502, headers);
      res.end(Buffer.concat(chunks));
    });
    response.on('error', () => {
      if (!res.headersSent) { res.writeHead(502); res.end('Battery endpoint unavailable'); }
      else res.destroy();
    });
  });
  upstream.on('timeout', () => upstream.destroy(new Error('Battery endpoint timeout')));
  upstream.on('error', () => {
    if (!res.headersSent) { res.writeHead(502); res.end('Battery endpoint unavailable'); }
    else res.destroy();
  });
  res.on('close', () => upstream.destroy());
}
