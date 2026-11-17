import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', 'build', '-p', 'h5'], {
  cwd: root, stdio: 'inherit', windowsHide: true
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
