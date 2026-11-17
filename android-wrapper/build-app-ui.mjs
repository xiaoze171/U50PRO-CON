import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// H5 is the compiler target for the APK's embedded WebView, not a browser release.
const result = spawnSync(process.execPath, ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', 'build', '-p', 'h5'], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, UNI_OUTPUT_DIR: path.join(root, 'android-wrapper/app/build/compiledUi') }
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
