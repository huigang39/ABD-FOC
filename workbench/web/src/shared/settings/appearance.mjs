import { icon } from '../ui/icons.mjs';

export const APPEARANCE_STORAGE_KEY = 'abd-foc.appearance-theme';
export const APPEARANCE_MODE_STORAGE_KEY = 'abd-foc.appearance-mode';
export const APPEARANCE_THEMES = Object.freeze(['default', 'neumorphism']);
export const APPEARANCE_MODES = Object.freeze(['light', 'dark', 'system']);
const installed = new WeakMap();
const validTheme = value => APPEARANCE_THEMES.includes(value);
const validMode = value => APPEARANCE_MODES.includes(value);
// 旧版把深浅与主题合存在同一个键里；读取时按含义拆分，不回写覆盖原始数据。
const LEGACY_MODES = Object.freeze({ light: 'light', dark: 'dark', system: 'system' });

export function resolveAppearanceTheme(theme, mode = 'light', systemDark = false) {
  // Neumorphism keeps its own data-theme; the depth model is material, not scheme.
  if (theme === 'neumorphism') return 'neumorphism';
  return mode === 'dark' || mode === 'system' && systemDark ? 'dark' : 'light';
}

function savedPreferences(storage) {
  try {
    const legacy = storage?.getItem(APPEARANCE_STORAGE_KEY);
    const storedMode = storage?.getItem(APPEARANCE_MODE_STORAGE_KEY);
    const theme = legacy === 'neumorphism' ? 'neumorphism' : 'default';
    const mode = validMode(storedMode) ? storedMode : legacy === 'neumorphism' ? 'light' : LEGACY_MODES[legacy] ?? 'light';
    return { theme, mode };
  } catch { return { theme: 'default', mode: 'light' }; }
}

export function renderAppearanceSettings({ theme = 'default', mode = 'light', motionEnabled = false, motionAvailable = true } = {}) {
  const preference = validTheme(theme) ? theme : 'default';
  const modePreference = validMode(mode) ? mode : 'light';
  const moving = motionAvailable && motionEnabled;
  const pills = (name, attribute, current, entries) => entries.map(([value, label]) => `<label class="appearance-option"><input type="radio" name="${name}" value="${value}" ${attribute}${value === current ? ' checked' : ''}><span class="appearance-pill">${label}</span></label>`).join('');
  const themeOptions = pills('appearance-theme', 'data-appearance-theme', preference, [['default', '默认'], ['neumorphism', '新拟物']]);
  const modeOptions = pills('appearance-mode', 'data-appearance-mode', modePreference, [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']]);
  return `<details class="appearance-settings" data-native-menu data-state-key="appearance-settings"><summary class="button appearance-settings-toggle" aria-label="设置" title="设置">${icon('settings')}<span>设置</span></summary><div class="appearance-settings-panel"><h2>外观</h2><div class="form-field"><span class="field-label" id="appearance-theme-label">主题</span><div class="appearance-segment" role="radiogroup" aria-labelledby="appearance-theme-label">${themeOptions}</div><p class="appearance-hint">新拟物同时提供浅色与深色材质，两种主题都可自由选择深浅模式。</p></div><div class="form-field"><span class="field-label" id="appearance-mode-label">深浅模式</span><div class="appearance-segment is-triple" role="radiogroup" aria-labelledby="appearance-mode-label">${modeOptions}</div></div><div class="appearance-motion-row"><div><strong>竖线动效</strong><span>三层架构中的图形动画</span></div><button class="button small motion-toggle" type="button" data-action="toggle-visual-motion" aria-pressed="${Boolean(moving)}" aria-label="${moving ? '关闭' : '开启'}竖线动效" ${motionAvailable ? '' : 'disabled'}>${icon(moving ? 'play' : 'pause')}<span>${!motionAvailable ? '动效不可用' : moving ? '动效 · 开' : '动效 · 关'}</span></button></div><div class="appearance-data"><strong>数据</strong><p>货架、当前配置与已保存的测试记录。</p><button class="button small" type="button" data-action="export-workspace">导出全部数据</button></div></div></details>`;
}

/** The shell continues to own motion preferences and reduced-motion behavior. */
export function installAppearanceSettings(options = {}) {
  const doc = options.document ?? globalThis.document;
  if (!doc?.documentElement || !doc.addEventListener) return { theme: 'default', mode: 'light', resolvedTheme: 'light', setTheme: () => false, setMode: () => false, destroy() {} };
  if (installed.has(doc)) return installed.get(doc);
  const win = doc.defaultView ?? globalThis.window;
  let storage;
  try { storage = Object.hasOwn(options, 'storage') ? options.storage : win?.localStorage; } catch { storage = null; }
  let media;
  try { media = (options.matchMedia || win?.matchMedia)?.call(win, '(prefers-color-scheme: dark)'); } catch { media = null; }
  const initial = savedPreferences(storage);
  let theme = initial.theme, mode = initial.mode, resolvedTheme, disposed = false;
  const syncControls = () => {
    for (const input of doc.querySelectorAll?.('[data-appearance-theme]') || []) {
      if (input.type === 'radio') input.checked = input.value === theme;
      else input.value = theme;
    }
    for (const input of doc.querySelectorAll?.('[data-appearance-mode]') || []) {
      if (input.type === 'radio') input.checked = input.value === mode;
      else input.value = mode;
    }
  };
  const apply = (notify = true) => {
    const systemDark = Boolean(media?.matches);
    const next = resolveAppearanceTheme(theme, mode, systemDark);
    doc.documentElement.dataset.theme = next;
    // 深色拟物通过 data-mode 区分材质的深浅，默认主题由 data-theme 直接表达。
    doc.documentElement.dataset.mode = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
    resolvedTheme = next;
    syncControls();
    if (notify) options.onChange?.({ theme, mode, resolvedTheme: next });
  };
  const persist = (key, value) => {
    try { storage?.setItem(key, value); } catch { /* The current session still follows the selection. */ }
  };
  const setTheme = value => {
    if (disposed || !validTheme(value)) { if (!disposed) syncControls(); return false; }
    if (theme === value) { syncControls(); return true; }
    theme = value;
    persist(APPEARANCE_STORAGE_KEY, theme);
    apply();
    return true;
  };
  const setMode = value => {
    if (disposed || !validMode(value)) { if (!disposed) syncControls(); return false; }
    if (mode === value) { syncControls(); return true; }
    mode = value;
    persist(APPEARANCE_MODE_STORAGE_KEY, mode);
    apply();
    return true;
  };
  const change = event => {
    const input = event.target;
    if (input?.matches?.('[data-appearance-theme]')) setTheme(input.value);
    else if (input?.matches?.('[data-appearance-mode]')) setMode(input.value);
  };
  const systemChange = () => { if (mode === 'system') apply(); };
  const storageChange = event => {
    if (event.storageArea && storage && event.storageArea !== storage) return;
    if (event.key === APPEARANCE_STORAGE_KEY) theme = validTheme(event.newValue) ? event.newValue : 'default';
    else if (event.key === APPEARANCE_MODE_STORAGE_KEY) mode = validMode(event.newValue) ? event.newValue : 'light';
    else return;
    apply();
  };
  doc.addEventListener('change', change);
  win?.addEventListener?.('storage', storageChange);
  if (media?.addEventListener) media.addEventListener('change', systemChange);
  else media?.addListener?.(systemChange);
  const controller = {
    get theme() { return theme; },
    get mode() { return mode; },
    get resolvedTheme() { return resolvedTheme; },
    setTheme,
    setMode,
    destroy() {
      if (disposed) return;
      disposed = true;
      doc.removeEventListener('change', change);
      win?.removeEventListener?.('storage', storageChange);
      if (media?.removeEventListener) media.removeEventListener('change', systemChange);
      else media?.removeListener?.(systemChange);
      installed.delete(doc);
    },
  };
  installed.set(doc, controller);
  apply(false);
  return controller;
}
