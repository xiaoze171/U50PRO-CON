// 外观模式：light / dark / system（随系统）。
// 存 uni storage，解析结果以 .theme-dark 类挂在 <html> 上（CSS 变量组靠它切换）；
// "随系统"时监听系统深色模式变化实时跟进。
const STORAGE_KEY = 'mu5120-theme';
const VALID_MODES = ['light', 'dark', 'system'];

let currentMode = 'system';
const listeners = new Set();

function systemPrefersDark() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(mode) {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark()) ? 'dark' : 'light';
}

function applyResolved() {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('theme-dark', resolveTheme(currentMode) === 'dark');
  }
  listeners.forEach(fn => fn(resolveTheme(currentMode)));
}

export function loadThemeMode() {
  let stored = null;
  try { stored = uni.getStorageSync(STORAGE_KEY); } catch {}
  currentMode = VALID_MODES.includes(stored) ? stored : 'system';
  applyResolved();
  return currentMode;
}

export function applyThemeMode(mode) {
  if (!VALID_MODES.includes(mode)) return;
  currentMode = mode;
  try { uni.setStorageSync(STORAGE_KEY, mode); } catch {}
  applyResolved();
}

// 系统主题变化（仅"随系统"模式生效时需要重新应用）。
export function watchSystemTheme() {
  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (currentMode === 'system') applyResolved(); };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', handler);
    else if (typeof media.addListener === 'function') media.addListener(handler);
  } catch {}
}

// 供页面订阅解析结果（浅/深），驱动 .app-shell 上的类绑定与图表配色。
export function onThemeResolved(listener) {
  if (typeof listener === 'function') listeners.add(listener);
  listener(resolveTheme(currentMode));
}
