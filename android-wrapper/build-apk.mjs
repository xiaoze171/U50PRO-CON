import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cwd = path.dirname(fileURLToPath(import.meta.url));
const windows = process.platform === 'win32';
const command = windows ? (process.env.ComSpec || 'cmd.exe') : 'gradle';
const args = windows
  ? ['/d', '/s', '/c', 'gradle :app:assembleRelease --console plain']
  : [':app:assembleRelease', '--console', 'plain'];
const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
