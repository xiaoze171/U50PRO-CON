// 主进程侧的路由器 HTTP 客户端，逐条对应安卓 RouterBridge.request()：
// 仅允许局域网地址、注入 Origin/Referer、合并共享会话 Cookie、记录 Set-Cookie，
// 永不抛出（失败也返回 {ok:false,...}），保持与安卓桥一致的响应形态。
const http = require('http');
const https = require('https');
const { URL } = require('url');
const session = require('./session');

// 与 RouterBridge.isLocalRouterHost 完全一致的局域网白名单。
function isLocalRouterHost(host) {
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return host.endsWith('.local');
}

function decodeBody(buffer, contentType) {
  let charset = 'utf8';
  if (contentType) {
    const matched = /charset\s*=\s*([^;]+)/i.exec(contentType);
    if (matched) {
      const value = matched[1].trim().replace(/["']/g, '').toLowerCase();
      if (value === 'latin1' || value === 'iso-8859-1') charset = 'latin1';
      else if (value === 'ascii' || value === 'us-ascii') charset = 'ascii';
      else if (value === 'ucs-2' || value === 'utf-16le' || value === 'utf16le') charset = 'utf16le';
      // 其余（含 utf-8/utf8）统一按 utf8 解码——路由器 goform 接口固定返回 UTF-8 JSON。
    }
  }
  return buffer.toString(charset).trim();
}

function doRequest(payload, redirectsLeft) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(payload.url); }
    catch { return resolve({ ok: false, status: 0, error: '非法的路由器地址' }); }

    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return resolve({ ok: false, status: 0, error: '只允许 HTTP/HTTPS' });
    }
    if (!isLocalRouterHost(target.hostname)) {
      return resolve({ ok: false, status: 0, error: '只允许访问局域网路由器地址' });
    }

    const method = String(payload.method || 'GET').toUpperCase();
    const timeout = Math.min(Math.max(Number(payload.timeoutMs) || 12000, 1000), 20000);
    const origin = `${target.protocol}//${target.host}`;

    const headers = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: origin,
      Referer: `${origin}/index.html`
    };
    // 复制页面提供的头，但剔除 Cookie/Origin/Referer（由主进程统一注入），同安卓桥。
    const provided = payload.headers && typeof payload.headers === 'object' ? payload.headers : {};
    for (const name of Object.keys(provided)) {
      const lower = name.toLowerCase();
      if (lower === 'cookie' || lower === 'origin' || lower === 'referer') continue;
      headers[name] = String(provided[name]);
    }
    const cookie = session.header();
    if (cookie) headers.Cookie = cookie;

    const body = payload.body == null ? '' : String(payload.body);
    const hasBody = body && method !== 'GET' && method !== 'HEAD';
    if (hasBody) headers['Content-Length'] = Buffer.byteLength(body);

    const lib = target.protocol === 'https:' ? https : http;
    const request = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method,
      headers,
      timeout
    }, (response) => {
      const status = response.statusCode || 0;
      const setCookie = response.headers['set-cookie'];
      if (setCookie) session.remember(setCookie);

      // 手动跟随重定向（对应安卓 setInstanceFollowRedirects(true)）。
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location && redirectsLeft > 0) {
        response.resume();
        let nextUrl = null;
        try { nextUrl = new URL(response.headers.location, target).toString(); } catch {}
        if (nextUrl) {
          const nextMethod = (status === 307 || status === 308) ? method : 'GET';
          return resolve(doRequest(
            { ...payload, url: nextUrl, method: nextMethod, body: nextMethod === 'GET' ? '' : body },
            redirectsLeft - 1
          ));
        }
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = decodeBody(Buffer.concat(chunks), response.headers['content-type']);
        const ok = status >= 200 && status < 300;
        const out = { ok, status, body: text };
        if (!ok) out.error = `路由器返回 HTTP ${status}`;
        resolve(out);
      });
    });

    request.on('timeout', () => { request.destroy(new Error('路由器请求超时')); });
    request.on('error', (error) => {
      resolve({ ok: false, status: 0, error: error.message || '无法连接路由器' });
    });
    if (hasBody) request.write(body);
    request.end();
  });
}

exports.request = (payload) => doRequest(payload || {}, 5);
exports.isLocalRouterHost = isLocalRouterHost;
