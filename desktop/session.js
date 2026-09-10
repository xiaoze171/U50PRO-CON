// 主进程内共享路由器"单会话"Cookie，等价于安卓的 RouterSession。
// Phase D 里主进程常驻采集与渲染窗口会共用同一份会话。
const cookies = new Map();

function clear() {
  cookies.clear();
}

// 从响应的 Set-Cookie 数组累积会话。
function remember(setCookieValues) {
  if (!Array.isArray(setCookieValues)) return;
  for (const raw of setCookieValues) {
    const first = String(raw).split(';', 1)[0];
    const index = first.indexOf('=');
    if (index > 0) cookies.set(first.slice(0, index), first.slice(index + 1));
  }
}

// 拼成请求用的 Cookie 头。
function header() {
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

// 用一整条 Cookie 头覆盖（供跨进程会话同步）。
function replace(cookieHeader) {
  cookies.clear();
  if (!cookieHeader) return;
  for (const raw of String(cookieHeader).split(';')) {
    const value = raw.trim();
    const index = value.indexOf('=');
    if (index > 0) cookies.set(value.slice(0, index), value.slice(index + 1));
  }
}

module.exports = { clear, remember, header, replace };
