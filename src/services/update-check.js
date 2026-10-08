export const RELEASES_PAGE = 'https://github.com/xiaoze171/U50PRO-CON/releases';
const API_URL = 'https://api.github.com/repos/xiaoze171/U50PRO-CON/releases/latest';
const CACHE_KEY = 'u50pro-release-v1';

export function compareVersions(left, right) {
  const parse = value => /^v?\d+\.\d+\.\d+$/i.test(String(value).trim())
    ? String(value).trim().replace(/^v/i, '').split('.').map(Number) : null;
  const a = parse(left), b = parse(right);
  if (!a || !b || ![...a, ...b].every(Number.isSafeInteger)) return null;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

export function createUpdateChecker({ fetcher = (...args) => fetch(...args), storage } = {}) {
  let pending = null;
  return async function check(current, force = false) {
    if (pending) return pending;
    if (!force) {
      try {
        const cached = JSON.parse(storage?.getItem(CACHE_KEY) || 'null');
        const age = Date.now() - cached?.checkedAt;
        if (cached?.current === current && age >= 0 && age < 3600000 && compareVersions(cached.version, current) !== null) {
          return { ...cached, isNewer: compareVersions(cached.version, current) > 0 };
        }
      } catch { /* Storage can be unavailable in embedded browsers. */ }
    }
    pending = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetcher(API_URL, {
          signal: controller.signal, cache: 'no-store',
          headers: { Accept: 'application/vnd.github+json' }
        });
        if (response.status === 404) throw new Error('尚未发布正式版本');
        if (response.status === 403 || response.status === 429) throw new Error('GitHub 请求受限，请稍后重试');
        if (!response.ok) throw new Error(`检查失败（HTTP ${response.status}）`);
        const release = await response.json();
        const comparison = compareVersions(release.tag_name, current);
        if (release.draft || release.prerelease || comparison === null) throw new Error('Release 版本号无效，请使用 v1.3.57 格式的正式版本');
        const result = {
          current, version: release.tag_name.replace(/^v/i, ''),
          body: String(release.body || ''), publishedAt: release.published_at || '',
          url: `${RELEASES_PAGE}/tag/${encodeURIComponent(release.tag_name)}`,
          isNewer: comparison > 0, checkedAt: Date.now()
        };
        try { storage?.setItem(CACHE_KEY, JSON.stringify(result)); } catch { /* Checking still succeeded. */ }
        return result;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('检查超时，请检查网络后重试');
        throw error;
      } finally { clearTimeout(timeout); }
    })();
    try { return await pending; } finally { pending = null; }
  };
}
