import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPEARANCE_STORAGE_KEY, APPEARANCE_MODE_STORAGE_KEY, APPEARANCE_MODES, APPEARANCE_THEMES, installAppearanceSettings, renderAppearanceSettings, resolveAppearanceTheme } from '../web/src/shared/settings/appearance.mjs';

function fixture({ theme, mode, systemDark = false, brokenStorage = false } = {}) {
  const values = new Map();
  if (theme !== undefined) values.set(APPEARANCE_STORAGE_KEY, theme);
  if (mode !== undefined) values.set(APPEARANCE_MODE_STORAGE_KEY, mode);
  const writes = [], events = new Map(), windowEvents = new Map(), mediaEvents = new Map(), changes = [];
  const makeRadios = (selector, entries) => entries.map(value => ({ type: 'radio', value, checked: false, matches: query => query === selector }));
  const themeControls = makeRadios('[data-appearance-theme]', APPEARANCE_THEMES);
  const modeControls = makeRadios('[data-appearance-mode]', APPEARANCE_MODES);
  const storage = {
    getItem(key) { if (brokenStorage) throw new Error('Unavailable'); return values.get(key) ?? null; },
    setItem(key, value) { if (brokenStorage) throw new Error('Unavailable'); writes.push([key, value]); values.set(key, value); },
  };
  const media = {
    matches: systemDark,
    addEventListener(type, listener) { mediaEvents.set(type, listener); },
    removeEventListener(type, listener) { assert.equal(mediaEvents.get(type), listener); mediaEvents.delete(type); },
  };
  const doc = {
    documentElement: { dataset: {} },
    defaultView: {
      localStorage: storage,
      matchMedia(query) { assert.equal(query, '(prefers-color-scheme: dark)'); return media; },
      addEventListener(type, listener) { windowEvents.set(type, listener); },
      removeEventListener(type, listener) { assert.equal(windowEvents.get(type), listener); windowEvents.delete(type); },
    },
    querySelectorAll(selector) {
      if (selector === '[data-appearance-theme]') return themeControls;
      if (selector === '[data-appearance-mode]') return modeControls;
      throw new Error(`意外的查询：${selector}`);
    },
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type, listener) { assert.equal(events.get(type), listener); events.delete(type); },
  };
  const controller = installAppearanceSettings({ document: doc, onChange: change => changes.push(change) });
  const pick = (controls, value) => { const input = controls.find(control => control.value === value); input.checked = true; events.get('change')({ target: input }); };
  const setSystemDark = value => { media.matches = value; mediaEvents.get('change')?.({ matches: value }); };
  return { controller, doc, storage, media, events, windowEvents, mediaEvents, themeControls, modeControls, changes, writes, values, pickTheme: value => pick(themeControls, value), pickMode: value => pick(modeControls, value), setSystemDark };
}

test('未设置偏好时保持默认主题浅色，不跟随系统变暗也不写存储', () => {
  const f = fixture({ systemDark: true });
  assert.equal(f.controller.theme, 'default');
  assert.equal(f.controller.mode, 'light');
  assert.equal(f.controller.resolvedTheme, 'light');
  assert.equal(f.doc.documentElement.dataset.theme, 'light');
  assert.deepEqual(f.themeControls.map(control => control.checked), [true, false]);
  assert.deepEqual(f.modeControls.map(control => control.checked), [true, false, false]);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.changes, []);
  f.controller.destroy();
});

test('深浅模式独立持久化，跟随系统仅受系统切换影响', () => {
  const f = fixture({ systemDark: true });
  f.pickMode('dark');
  assert.equal(f.doc.documentElement.dataset.theme, 'dark');
  assert.deepEqual(f.changes.at(-1), { theme: 'default', mode: 'dark', resolvedTheme: 'dark' });
  f.pickMode('system');
  assert.equal(f.doc.documentElement.dataset.theme, 'dark');
  f.setSystemDark(false);
  assert.equal(f.doc.documentElement.dataset.theme, 'light');
  f.pickMode('dark');
  const count = f.changes.length;
  f.setSystemDark(true); f.setSystemDark(false);
  assert.equal(f.changes.length, count);
  assert.equal(f.doc.documentElement.dataset.theme, 'dark');
  f.pickMode('light');
  assert.equal(f.doc.documentElement.dataset.theme, 'light');
  assert.deepEqual(f.writes, ['dark', 'system', 'dark', 'light'].map(value => [APPEARANCE_MODE_STORAGE_KEY, value]));
  f.controller.destroy();
});

test('主题独立于深浅：新拟物两种材质都可用，默认主题跟随深浅', () => {
  assert.equal(resolveAppearanceTheme('neumorphism', 'dark', true), 'neumorphism');
  assert.equal(resolveAppearanceTheme('neumorphism', 'system', true), 'neumorphism');
  assert.equal(resolveAppearanceTheme('default', 'dark'), 'dark');
  assert.equal(resolveAppearanceTheme('default', 'system', true), 'dark');
  assert.equal(resolveAppearanceTheme('default', 'system', false), 'light');
  assert.equal(resolveAppearanceTheme('default', 'light'), 'light');
  const f = fixture({ systemDark: true });
  f.pickTheme('neumorphism');
  assert.equal(f.doc.documentElement.dataset.theme, 'neumorphism');
  assert.deepEqual(f.modeControls.map(control => control.checked), [true, false, false]);
  assert.deepEqual(f.modeControls.map(control => Boolean(control.disabled)), [false, false, false]);
  f.setSystemDark(false);
  assert.equal(f.doc.documentElement.dataset.theme, 'neumorphism');
  f.pickMode('dark');
  assert.equal(f.doc.documentElement.dataset.theme, 'neumorphism');
  assert.equal(f.doc.documentElement.dataset.mode, 'dark');
  f.pickTheme('default');
  assert.equal(f.doc.documentElement.dataset.theme, 'dark');
  f.pickMode('light');
  assert.equal(f.doc.documentElement.dataset.theme, 'light');
  f.pickTheme('neumorphism');
  assert.equal(f.doc.documentElement.dataset.theme, 'neumorphism');
  assert.deepEqual(f.writes, [[APPEARANCE_STORAGE_KEY, 'neumorphism'], [APPEARANCE_MODE_STORAGE_KEY, 'dark'], [APPEARANCE_STORAGE_KEY, 'default'], [APPEARANCE_MODE_STORAGE_KEY, 'light'], [APPEARANCE_STORAGE_KEY, 'neumorphism']]);
  f.controller.destroy();
});

test('旧版合并存储按含义迁移：不回写原始键', () => {
  for (const [legacy, theme, mode, resolved] of [
    ['light', 'default', 'light', 'light'],
    ['dark', 'default', 'dark', 'dark'],
    ['system', 'default', 'system', 'dark'],
    ['neumorphism', 'neumorphism', 'light', 'neumorphism'],
    ['unknown', 'default', 'light', 'light'],
  ]) {
    const f = fixture({ theme: legacy, systemDark: true });
    assert.equal(f.controller.theme, theme);
    assert.equal(f.controller.mode, mode);
    assert.equal(f.doc.documentElement.dataset.theme, resolved);
    assert.equal(f.values.get(APPEARANCE_STORAGE_KEY), legacy);
    assert.deepEqual(f.writes, []);
    f.controller.destroy();
  }
});

test('非法值与无关事件不生效，勾选状态回弹当前偏好', () => {
  const f = fixture();
  f.pickTheme('neumorphism');
  const count = f.changes.length;
  f.events.get('change')({ target: { value: '<script>', type: 'radio', checked: true, matches: selector => selector === '[data-appearance-theme]' } });
  assert.equal(f.controller.theme, 'neumorphism');
  assert.deepEqual(f.themeControls.map(control => control.checked), [false, true]);
  f.events.get('change')({ target: { value: 'default', type: 'radio', checked: true, matches: selector => selector === '[data-appearance-mode]' } });
  assert.equal(f.changes.length, count);
  assert.deepEqual(f.writes, [[APPEARANCE_STORAGE_KEY, 'neumorphism']]);
  f.controller.destroy();
});

test('存储不可用仍可切换会话，双键跨标签同步且不覆盖动效偏好', () => {
  const broken = fixture({ brokenStorage: true });
  broken.pickMode('dark');
  assert.equal(broken.doc.documentElement.dataset.theme, 'dark');
  broken.controller.destroy();
  const f = fixture({ systemDark: true });
  f.windowEvents.get('storage')({ key: 'actuator-console.motion', newValue: 'on', storageArea: f.storage });
  assert.equal(f.controller.theme, 'default');
  f.windowEvents.get('storage')({ key: APPEARANCE_STORAGE_KEY, newValue: 'neumorphism', storageArea: {} });
  assert.equal(f.controller.theme, 'default');
  f.windowEvents.get('storage')({ key: APPEARANCE_STORAGE_KEY, newValue: 'neumorphism', storageArea: f.storage });
  assert.equal(f.controller.theme, 'neumorphism');
  assert.equal(f.doc.documentElement.dataset.theme, 'neumorphism');
  f.windowEvents.get('storage')({ key: APPEARANCE_MODE_STORAGE_KEY, newValue: 'dark', storageArea: f.storage });
  assert.equal(f.controller.mode, 'dark');
  assert.equal(f.doc.documentElement.dataset.theme, 'neumorphism');
  assert.deepEqual(f.writes, []);
  f.controller.destroy();
});

test('安装幂等且卸载全部监听；卸载后 setTheme/setMode 返回 false', () => {
  const f = fixture();
  assert.strictEqual(installAppearanceSettings({ document: f.doc }), f.controller);
  f.controller.destroy(); f.controller.destroy();
  assert.equal(f.events.size, 0); assert.equal(f.windowEvents.size, 0); assert.equal(f.mediaEvents.size, 0);
  assert.equal(f.controller.setTheme('neumorphism'), false);
  assert.equal(f.controller.setMode('dark'), false);
  const next = installAppearanceSettings({ document: f.doc });
  assert.notStrictEqual(next, f.controller);
  next.destroy();
  assert.equal(installAppearanceSettings({ document: null }).setTheme('neumorphism'), false);
});

test('设置面板渲染主题与深浅两个分段单选组并附说明', () => {
  const html = renderAppearanceSettings({ theme: 'neumorphism', mode: 'system' });
  assert.match(html, /<details[^>]*data-native-menu/);
  assert.match(html, /aria-label="设置"/);
  assert.match(html, /icons\.svg#settings/);
  assert.match(html, /<div class="appearance-segment" role="radiogroup" aria-labelledby="appearance-theme-label">/);
  assert.match(html, /<div class="appearance-segment is-triple" role="radiogroup" aria-labelledby="appearance-mode-label">/);
  assert.match(html, /<input type="radio" name="appearance-theme" value="neumorphism" data-appearance-theme checked>/);
  assert.match(html, /<input type="radio" name="appearance-mode" value="system" data-appearance-mode checked>/);
  assert.match(html, /<span class="appearance-pill">默认<\/span>/);
  assert.match(html, /<span class="appearance-pill">新拟物<\/span>/);
  assert.match(html, /<span class="appearance-pill">跟随系统<\/span>/);
  assert.match(html, /appearance-hint">新拟物同时提供浅色与深色材质/);
  assert.doesNotMatch(html, /data-appearance-mode[^>]*disabled/);
  const defaultHtml = renderAppearanceSettings({ theme: 'default', mode: 'dark' });
  assert.match(defaultHtml, /<input type="radio" name="appearance-mode" value="dark" data-appearance-mode checked>/);
  assert.doesNotMatch(html, /<select|<option/);
  assert.ok(html.indexOf('name="appearance-theme"') < html.indexOf('name="appearance-mode"'), '主题段在深浅段之前');
  assert.doesNotMatch(html, /toggle-visual-motion|motion-toggle|appearance-motion-row|竖线动效/);
  assert.doesNotMatch(html, /<dialog|aria-modal|data-action="[^"]*theme/);
});

test('新拟物主题：表面与基底同色，双影成对，文字与状态色保持可读对比', () => {
  const css = readFileSync(new URL('../web/styles/settings.css', import.meta.url), 'utf8');
  const body = css.match(/:root\[data-theme="neumorphism"\] \{([^}]+)\}/)[1];
  const colors = Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[a-f0-9]{6});/g)].map(match => [match[1], match[2]]));
  for (const token of ['surface', 'surface-nested', 'soft', 'control-fill']) assert.equal(colors[token], colors.page, `${token} 与基底同色`);
  assert.equal(colors['neu-shadow-dark'], '#b8bcc2');
  assert.equal(colors['neu-shadow-light'], '#ffffff');
  const luminance = hex => hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrast = (left, right) => { const a = luminance(colors[left]), b = luminance(colors[right]); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  for (const background of ['page', 'surface', 'surface-nested', 'soft']) {
    for (const foreground of ['ink', 'muted', 'subtle']) assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
  }
  for (const role of ['actuator', 'driver', 'danger', 'warning', 'app', 'foc', 'hardware']) assert.ok(contrast(role, `${role}-tint`) >= 4.5, role);
  assert.ok(contrast('surface', 'primary') >= 4.5, 'primary button');
  assert.match(css, /--neu-raised: 6px 6px 12px var\(--neu-shadow-dark\), -6px -6px 12px var\(--neu-shadow-light\)/);
  assert.match(css, /--neu-sunken: inset/);
  assert.match(css, /--neu-raised-hover: 3px 3px 6px/);
  assert.match(css, /:root\[data-theme="neumorphism"\] ::selection/);
});

test('深色拟物：同一深色基底承载双影，文本与状态色保持可读对比', () => {
  const css = readFileSync(new URL('../web/styles/settings.css', import.meta.url), 'utf8');
  const body = css.match(/:root\[data-theme="neumorphism"\]\[data-mode="dark"\] \{([^}]+)\}/)[1];
  const colors = Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[a-f0-9]{6});/g)].map(match => [match[1], match[2]]));
  for (const token of ['surface', 'surface-nested', 'soft', 'control-fill']) assert.equal(colors[token], colors.page, `${token} 与基底同色`);
  assert.equal(colors['neu-shadow-dark'], '#171a20');
  assert.equal(colors['neu-shadow-light'], '#39404d');
  const luminance = hex => hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrast = (left, right) => { const a = luminance(colors[left]), b = luminance(colors[right]); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  for (const background of ['page', 'surface', 'surface-nested', 'soft']) {
    for (const foreground of ['ink', 'muted', 'subtle']) assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
  }
  for (const role of ['actuator', 'driver', 'danger', 'warning', 'app', 'foc', 'hardware']) assert.ok(contrast(role, `${role}-tint`) >= 4.5, role);
  assert.ok(contrast('surface', 'primary') >= 4.5, 'primary button');
  assert.match(css, /:root\[data-theme="neumorphism"\]\[data-mode="dark"\] \{[^}]*color-scheme: dark/s);
  assert.match(css, /data-mode="dark"\] ::selection/);
});

test('深色实际配色覆盖基础色系，正文/提示/状态在对应底色上保持可读对比', () => {
  const css = readFileSync(new URL('../web/styles/settings.css', import.meta.url), 'utf8');
  const body = css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1];
  const colors = Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[a-f0-9]{6});/g)].map(match => [match[1], match[2]]));
  const luminance = hex => hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrast = (left, right) => { const a = luminance(colors[left]), b = luminance(colors[right]); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  for (const background of ['page', 'surface', 'surface-nested', 'soft']) {
    for (const foreground of ['ink', 'muted', 'subtle']) assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
  }
  for (const role of ['actuator', 'driver', 'danger', 'warning', 'app', 'foc', 'hardware']) assert.ok(contrast(role, `${role}-tint`) >= 4.5, role);
  assert.ok(contrast('surface', 'primary') >= 4.5, 'primary button');
  assert.match(css, /@media screen/);
});
