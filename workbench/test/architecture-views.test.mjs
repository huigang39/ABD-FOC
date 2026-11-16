import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../web/src/modules/registry.mjs';
import { architectureModuleRoute, renderArchitectureOverview, renderArchitectureLayer } from '../web/src/features/architecture/view.mjs';

function assertReadOnly(html) {
  // 画布允许两类无副作用控件：指令源单选 radio、货架快速选择下拉（configuration-* 作用域复用配置工作台）。
  const stripped = html
    .replace(/<button[^>]*class="field-help"[^>]*>.*?<\/button>/gs, '')
    .replace(/<input type="radio"[^>]*>/g, '')
    .replace(/<select class="field-select canvas-quick-select"[^>]*>.*?<\/select>/gs, '');
  assert.doesNotMatch(stripped, /<(?:input|textarea|select|button)\b|data-(?:action|edit|scope)=/);
  assert.doesNotMatch(html, />参数配置(?: · \d+)?<|>参数编辑<|>配置接口|>已启用<|>未包含<|工作草案|当前项目/);
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    assert.ok(href.startsWith('#/') || href.startsWith('/assets/icons.svg#'), href);
  }
}

test('architecture overview is the signal-and-power chain canvas for the joint module lifecycle', () => {
  const html = renderArchitectureOverview();
  // 链节点顺序：应用 → 算法 → 硬件（物理端为图标节点，另测）。
  assert.deepEqual([...html.matchAll(/chain-node chain-(app|foc|hardware)"[^>]*>\s*<span class="chain-head"><strong>([^<]+)/g)].map(match => match[2]), ['应用', '算法', '硬件']);
  assert.deepEqual([...html.matchAll(/data-mark="([^"]+)"/g)].map(match => match[1]), ['app', 'foc', 'hardware']);
  // 指令源四条可选通行线：CAN / EtherCAT / Ethernet / J-Link，标签即文字。
  assert.equal((html.match(/name="canvas-source"/g) || []).length, 4);
  for (const bus of ['CAN', 'EtherCAT', 'Ethernet', 'J-Link']) assert.match(html, new RegExp(`<small>${bus}</small>`));
  // 层间交换语义落在链上连接标签。
  assert.match(html, /控制给定 \/ 反馈快照/);
  assert.match(html, /调制提交 \/ 同步采样/);
  // 硬件与电机三相连接、电机连减速机；PCB 设计内嵌硬件层。
  assert.match(html, /<small>U · V · W<\/small>/);
  assert.match(html, /PCB 设计/);
  // 分组：应用+算法+硬件=驱动器，电机+减速机=执行器，均带货架快速选择。
  assert.match(html, /<b>驱动器<\/b>/);
  assert.match(html, /<b>执行器<\/b>/);
  // 仿真卡：上方数字信号仿真 + 硬件仿真，底部动力学仿真。
  assert.match(html, /数字信号仿真/);
  assert.match(html, /硬件仿真/);
  assert.match(html, /动力学仿真/);
  // 极简画布：无模块词条、无模块计数、无生命周期带、无接口文字堆叠。
  assert.doesNotMatch(html, /layer-capabilities/);
  assert.doesNotMatch(html, /个模块/);
  assert.doesNotMatch(html, /canvas-stage/);
  assert.doesNotMatch(html, /以太网/);
  // 物理端为贴合实物的大图标节点（转子 / 齿轮），不再是文字框。
  assert.match(html, /icons\.svg#rotor/);
  assert.match(html, /aria-label="电机 · 货架执行器"/);
  assert.match(html, /aria-label="减速机 · 货架执行器"/);
  // 双击指令源进入对应页面。
  assert.match(html, /ondblclick="location\.hash='#\/project\/protocol'"/);
  assert.match(html, /ondblclick="location\.hash='#\/debug'"/);
  // 主页画布不保留标题与说明文字。
  assert.doesNotMatch(html, /<h1>|page-description/);
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
