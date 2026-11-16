import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../web/src/modules/registry.mjs';
import { architectureModuleRoute, renderArchitectureOverview, renderArchitectureLayer } from '../web/src/features/architecture/view.mjs';

function assertReadOnly(html) {
  assert.doesNotMatch(html.replace(/<button[^>]*class="field-help"[^>]*>.*?<\/button>/gs, ''), /<(?:input|textarea|select|button)\b|data-(?:action|edit|scope)=/);
  assert.doesNotMatch(html, />参数配置(?: · \d+)?<|>参数编辑<|>配置接口|>已启用<|>未包含<|工作草案|当前项目/);
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    assert.ok(href.startsWith('#/') || href.startsWith('/assets/icons.svg#'), href);
  }
}

test('architecture overview is the full-lifecycle canvas: three layers, satellites and lifecycle band', () => {
  const html = renderArchitectureOverview();
  assert.deepEqual([...html.matchAll(/<a class="layer-entry layer-([^"]+)"/g)].map(match => match[1]), ['app', 'foc', 'hardware']);
  assert.deepEqual([...html.matchAll(/data-mark="([^"]+)"/g)].map(match => match[1]), ['app', 'foc', 'hardware']);
  assert.match(html, /icons.svg#algorithm/);
  assert.doesNotMatch(html, /L[123]</);
  assert.match(html, /应用 ↔ 算法/);
  assert.match(html, /算法 ↔ 硬件/);
  assert.equal((html.match(/data-flow-direction="down"/g) || []).length, 2);
  assert.equal((html.match(/data-flow-direction="up"/g) || []).length, 2);
  // 设计与仿真卫星：硬件左 PCBA、右硬件仿真；算法挂数字信号仿真、应用挂动力学仿真。
  assert.match(html, /PCBA 设计/);
  assert.match(html, /硬件仿真/);
  assert.match(html, /数字信号仿真/);
  assert.match(html, /动力学仿真/);
  // 生命周期带覆盖选型到维护，全部可点。
  for (const stage of ['选型', '烧录', '校准', '测试', '上位机', '调试器', '维护']) assert.match(html, new RegExp(`>${stage}<`));
  assert.deepEqual([...html.matchAll(/class="canvas-stage" href="([^"]+)"/g)].map(match => match[1]),
    ['#/equipment', '#/project/flash', '#/project/application?module=app-calibration&tab=config', '#/performance', '#/project/protocol', '#/debug', '#/project/faults']);
  // 主页画布不保留标题与说明文字。
  assert.doesNotMatch(html, /<h1>|page-description/);
  assert.doesNotMatch(html, /layer-interface-bridge|connection-line/);
  assertReadOnly(html);
});

test('every layer shows its whole module catalogue in definition order without instance settings', () => {
  for (const layer of ['hardware', 'foc', 'app']) {
    const html = renderArchitectureLayer(layer);
    const expected = MODULES.filter(module => module.layer === layer && module.id !== 'foc-feedback').sort((a, b) => a.order - b.order);
    const cards = [...html.matchAll(/<a class="module-card[^\"]*" href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(cards, expected.map(module => architectureModuleRoute(module.id)));
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    assertReadOnly(html);
    for (const module of expected) assertReadOnly(renderArchitectureLayer(layer, module.id));
  }
});

test('module detail exposes static roles and cross-layer dependencies, with architecture-only navigation', () => {
  const module = MODULES.find(item => item.id === 'foc-current');
  const html = renderArchitectureLayer('foc', module.id);
  assert.match(html, /id="architecture-module-title">电流环<\/h2>/);
  for (const role of ['input', 'output', 'state']) {
    assert.ok(html.includes(`data-contract-role="${role}"`));
    assert.ok(html.includes(module.contracts[role].name));
  }
  assert.ok(html.includes(module.inputs));
  assert.ok(html.includes(module.outputs));
  assert.ok(html.includes(module.boundary));
  for (const id of module.dependencies) assert.ok(html.includes(`href="${architectureModuleRoute(id)}"`));
  assertReadOnly(html);
});

test('unknown or cross-layer selection resolves safely within the static catalogue', () => {
  assert.equal(architectureModuleRoute('missing'), '#/architecture');
  const html = renderArchitectureLayer('<img onerror="bad">', 'foc-current');
  assert.match(html, /id="architecture-module-title">内核<\/h2>/);
  assert.doesNotMatch(html, /<img|onerror/);
  assertReadOnly(html);
});
