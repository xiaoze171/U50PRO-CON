import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let serial = 0;

// Execute the production module against an isolated build profile, without
// changing the tracked branch profile while other tests/builds run.
export async function importBatteryProfileClient(mode) {
  if (globalThis.window) delete globalThis.window.__mu5120NativeResponse;
  const original = new URL('../../src/services/router-client.js', import.meta.url);
  let source = await readFile(original, 'utf8');
  source = source.replace(/from '([^']+)'/g, (match, specifier) => {
    if (specifier.endsWith('/config/battery-profile.json')) {
      return `from 'data:application/json,${encodeURIComponent(JSON.stringify({ mode }))}'`;
    }
    const resolved = specifier.startsWith('.')
      ? new URL(specifier, original).href
      : new URL(`file:///${require.resolve(specifier).replaceAll('\\', '/')}`).href;
    return `from '${resolved}'`;
  });
  return import(`data:text/javascript,${encodeURIComponent(source + '\n// isolated client ' + ++serial)}`);
}
