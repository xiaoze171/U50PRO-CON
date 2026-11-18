import { parseBatteryCsv } from '../utils/battery-csv.js';

const MAX_BYTES = 4 * 1024 * 1024;
const CACHE_MS = 60000;

export function batteryCsvUrl(endpoint) {
  const target = new URL(endpoint);
  target.pathname = '/backup/battery-log.csv';
  target.search = '';
  target.hash = '';
  return target.toString();
}

// One endpoint is active at a time. Errors have the same cadence as successful
// downloads, and invalidation prevents late work repopulating the cache.
export function createBatteryCsvClient({ request, now = Date.now, timeoutMs = 5000 } = {}) {
  let generation = 0;
  let activeUrl = '';
  let cached = null;
  let inFlight = null;
  function invalidate() {
    generation++;
    activeUrl = '';
    cached = null;
    inFlight = null;
  }
  function get(endpoint, { force = false } = {}) {
    const url = batteryCsvUrl(endpoint);
    if (activeUrl !== url) { invalidate(); activeUrl = url; }
    const startedAt = now();
    if (inFlight) return inFlight;
    if (!force && cached && startedAt >= cached.fetchedAt && startedAt - cached.fetchedAt < CACHE_MS) return Promise.resolve(cached);
    const token = generation;
    const run = async () => {
      let timer;
      let value;
      try {
        const text = await Promise.race([
          Promise.resolve().then(() => request(url, { timeoutMs, responseType: 'text', maxBytes: MAX_BYTES })),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('CSV 请求超时'), { code: 'timeout' })), timeoutMs); })
        ]);
        if (typeof text !== 'string') throw Object.assign(new Error('CSV 响应格式无效'), { code: 'invalid-csv' });
        if (text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) {
          throw Object.assign(new Error('CSV 超过 4 MiB'), { code: 'too-large' });
        }
        let csv, historyCsv;
        try { csv = parseBatteryCsv(text); historyCsv = parseBatteryCsv(text, { history: true }); }
        catch (error) { throw Object.assign(error, { code: 'invalid-csv' }); }
        value = { state: 'ready', reason: '', csv, historyCsv, url, fetchedAt: now() };
      } catch (error) {
        value = { state: 'unavailable', reason: error.code || 'fetch-error', error: error.message,
          csv: null, url, fetchedAt: now() };
      } finally { clearTimeout(timer); }
      if (generation !== token || activeUrl !== url) return { ...value, state: 'invalidated', reason: 'endpoint-changed', csv: null };
      cached = value;
      inFlight = null;
      return value;
    };
    inFlight = run();
    return inFlight;
  }
  return { get, invalidate };
}
