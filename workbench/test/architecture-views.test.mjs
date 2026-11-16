import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODULES } from '../web/src/modules/registry.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { selectConfigurationActuator, selectConfigurationDriver } from '../web/src/features/configuration/workspace.mjs';
import { architectureModuleRoute, renderArchitectureOverview, renderArchitectureLayer } from '../web/src/features/architecture/view.mjs';

function assertReadOnly(html) {
  // 静态模块目录仍只说明职责，不修改当前工程。
  const stripped = html
    .replace(/<button[^>]*class="field-help"[^>]*>.*?<\/button>/gs, '');
  assert.doesNotMatch(stripped, /<(?:input|textarea|select|button)\b|data-(?:action|edit|scope)=/);
  assert.doesNotMatch(html, />参数配置(?: · \d+)?<|>参数编辑<|>配置接口|>已启用<|>未包含<|工作草案|当前项目/);
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    assert.ok(href.startsWith('#/') || href.startsWith('/assets/icons.svg#'), href);
  }
}

const homeTargets = html => [...html.matchAll(/<[a-z]+\b[^>]*\bdata-home-route="([^"]*)"[^>]*>/g)]
  .map(match => ({ tag: match[0], route: match[1].replaceAll('&amp;', '&') }));
function selectedModel(html, scope) {
  const picker = new RegExp(`<select\\b[^>]*data-edit="${scope}"[^>]*>([\\s\\S]*?)<\\/select>`).exec(html);
  assert.ok(picker, `主页缺少 ${scope} 型号选择`);
  const selected = [...picker[1].matchAll(/<option\b[^>]*>/g)].filter(match => /\bselected(?:\s|=|>)/.test(match[0]));
  assert.equal(selected.length, 1, `${scope} 应有唯一选中值`);
  const value = /\bvalue="([^"]*)"/.exec(selected[0][0]);
  assert.ok(value);
  return value[1].replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

test('homepage groups the driver and actuator and opens project editors from accessible double-click targets', () => {
  const html = renderArchitectureOverview();
  // 链节点顺序：应用 → 算法 → 硬件（物理端为图标节点，另测）。
  assert.deepEqual([...html.matchAll(/chain-node chain-(app|foc|hardware)"[^>]*>\s*<span class="chain-head"><strong>([^<]+)/g)].map(match => match[2]), ['应用层', '算法层', '硬件层']);
  assert.deepEqual([...html.matchAll(/data-mark="([^"]+)"/g)].map(match => match[1]), ['app', 'foc', 'hardware', 'motor', 'reducer']);
  // 指令源四条可选通行线：CAN / EtherCAT / Ethernet / J-Link，标签即文字。
  assert.equal((html.match(/name="canvas-source"/g) || []).length, 4);
  for (const bus of ['CAN', 'EtherCAT', 'Ethernet', 'J-Link']) assert.match(html, new RegExp(`<small>${bus}</small>`));
  // 链路按钮分别打开传输详情；层间交换语义保留在连线上。
  for (const label of ['控制给定', '反馈快照', '调制提交', '同步采样']) assert.match(html, new RegExp(`<span>${label}</span><i aria-hidden="true"></i>`));
  const linkButtons = [...html.matchAll(/<button\b[^>]*data-action="show-home-link"[^>]*>/g)].map(match => match[0]);
  const keys = linkButtons.map(button => /data-link="([^"]+)"/.exec(button)?.[1]);
  assert.deepEqual([...keys].sort(), ['can', 'ethercat', 'ethernet', 'jlink', 'control', 'feedback', 'modulation', 'sampling', 'power-u', 'power-v', 'power-w', 'power-supply', 'motor-output', 'reducer-output'].sort());
  for (const button of linkButtons) {
    assert.match(button, /type="button"/);
    assert.match(button, /aria-label="[^"]+"/);
  }
  // U/V/W 各自承载相电流与相电压；母线来自独立电源模块。
  for (const phase of ['U', 'V', 'W']) {
    const button = linkButtons.find(button => button.includes(`data-link="power-${phase.toLowerCase()}"`));
    assert.match(button, new RegExp(`data-phase="${phase}"`));
    assert.match(button, /phase-unknown/);
  }
  assert.doesNotMatch(html, /phase-wire-status/);
  assert.doesNotMatch(html, /data-link="(?:current-sampling|phase-voltage-sampling|bus-voltage-sampling)"/);
  assert.match(html, />电源</);
  assert.ok(linkButtons.some(button => button.includes('data-link="power-supply"')));
  assert.match(html, /data-link="motor-output"[^>]*><span>位置 · 速度 · 力矩<\/span>/);
  assert.match(html, /data-link="reducer-output"[^>]*><span>出轴位置 · 速度 · 力矩<\/span>/);
  assert.doesNotMatch(html, /<small>U · V · W<\/small>/);
  assert.match(html, /PCB 设计/);
  // 关节模组大框包含驱动器和执行器；工程名称与新建操作集中在全局页头。
  assert.match(html, /class="[^"]*canvas-group-joint\b/);
  assert.match(html, /class="canvas-joint-body"[\s\S]*canvas-group-driver[\s\S]*canvas-group-actuator/);
  assert.match(html, /<b>驱动器<\/b>/);
  assert.match(html, /<b>执行器<\/b>/);
  assert.doesNotMatch(html, /data-action="new-project"|canvas-toolbar/);
  assert.equal((html.match(/<button\b/g) || []).length, linkButtons.length, '主页按钮仅用于查看链路数据');
  // 模块不再显示问号/对勾角标；健康状态由整个模块呈现。
  assert.equal((html.match(/class="chain-head"><strong>[^<]+<\/strong><\/span>/g) || []).length, 5);
  assert.doesNotMatch(html, /data-action="show-home-status"|class="[^"]*chain-status/);
  assert.equal((html.match(/data-health="unknown"/g) || []).length, 5);
  for (const scope of ['configuration-assembly', 'configuration-driver', 'configuration-actuator']) assert.equal(selectedModel(html, scope), '');
  assert.doesNotMatch(html, /canvas-edit-hint|<small>驱动器 \+ 执行器<\/small>/);
  // 仿真卡：上方数字信号仿真 + 硬件仿真，底部动力学仿真。
  assert.match(html, /数字信号仿真/);
  assert.match(html, /硬件仿真/);
  assert.match(html, /动力学仿真/);
  assert.doesNotMatch(html, /规划中|canvas-soon/);
  // 极简画布：无模块词条、无模块计数、无生命周期带、无接口文字堆叠。
  assert.doesNotMatch(html, /layer-capabilities/);
  assert.doesNotMatch(html, /个模块/);
  assert.doesNotMatch(html, /canvas-stage/);
  assert.doesNotMatch(html, /以太网/);
  const targets = homeTargets(html);
  for (const route of [
    '#/parameters/app?module=app-runtime',
    '#/parameters/foc?module=foc-current',
    '#/parameters/hardware?module=hw-platform',
    '#/parameters/hardware?module=hw-board',
    '#/parameters/app?module=app-comms', '#/debug', '#/equipment/actuators',
  ]) assert.ok(targets.some(target => target.route === route), route);
  for (const { tag, route } of targets) {
    assert.match(tag, /role="link"/);
    assert.match(tag, /tabindex="0"/);
    assert.ok(route.startsWith('#/'), route);
  }
  assert.doesNotMatch(html, /\bondblclick=|href="#\/architecture\/(?:hardware|app|foc)"/);
});

test('global header always offers new and import project actions before notifications', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const button = /<button\b[^>]*id="home-new-project"[^>]*>/.exec(html);
  assert.ok(button, '全局页头缺少新建工程按钮');
  assert.match(button[0], /data-action="new-project"/);
  assert.doesNotMatch(button[0], /\bhidden\b/);
  assert.equal((html.match(/data-action="new-project"/g) || []).length, 1);
  const importButton = /<button\b[^>]*id="home-import-project"[^>]*>/.exec(html);
  assert.ok(importButton, '全局页头缺少导入工程按钮');
  assert.match(importButton[0], /data-action="import"/);
  assert.doesNotMatch(importButton[0], /\bhidden\b/);
  assert.equal((html.match(/data-action="import"/g) || []).length, 1);
  assert.ok(html.indexOf('id="home-import-project"') < html.indexOf('id="notification-history-toggle"'));
  assert.match(html, /id="home-project-name"/);
  assert.match(html, /id="project-file-actions" class="configuration-file-actions" aria-label="工程文件" hidden/);
  assert.doesNotMatch(html, /正在载入工作台|需要启用浏览器 JavaScript|本地设计工作区/);
  assert.ok(html.indexOf('id="home-new-project"') < html.indexOf('id="notification-history-toggle"'));
  assert.doesNotMatch(html, /<nav\b[^>]*class="topbar-nav"/);
});

test('module border status follows only fresh device diagnoses while module headers stay icon-free', () => {
  const project = createNeo75hProject('KW'), now = 10000;
  const issues = [{ level: 'error', moduleId: 'app-motion' }, { level: 'warning', moduleId: 'hw-board' }];
  const defaultHtml = renderArchitectureOverview(project, { issues, now });
  assert.equal((defaultHtml.match(/data-health="unknown"/g) || []).length, 5);
  assert.doesNotMatch(defaultHtml, /data-health="(?:ok|warning|error)"/);
  const moduleDiagnostics = {
    source: 'device', connected: true, projectId: project.id,
    fingerprint: configurationFingerprint(project), observedAt: now,
    modules: { application: { status: 'warning' }, algorithm: { status: 'ok' }, hardware: { status: 'error' }, motor: { status: 'ok' } },
  };
  const liveHtml = renderArchitectureOverview(project, { issues, moduleDiagnostics, now });
  for (const [node, state] of [['app', 'warning'], ['foc', 'ok'], ['hardware', 'error']]) {
    assert.match(liveHtml, new RegExp(`class="chain-node chain-${node}"[^>]*data-health="${state}"`));
  }
  assert.equal((liveHtml.match(/data-health="unknown"/g) || []).length, 1, '无减速机诊断时只保留其默认状态');
  for (const html of [defaultHtml, liveHtml]) {
    assert.equal((html.match(/class="chain-head"><strong>[^<]+<\/strong><\/span>/g) || []).length, 5);
    assert.doesNotMatch(html, /data-action="show-home-status"|class="[^"]*chain-status/);
  }
  const staleHtml = renderArchitectureOverview(project, { issues, moduleDiagnostics, now: now + 1001 });
  assert.equal((staleHtml.match(/data-health="unknown"/g) || []).length, 5);
});

test('homepage rendering retains the chosen command source and marks the source cards', () => {
  for (const source of ['can', 'ethercat', 'ethernet', 'jlink']) {
    const html = renderArchitectureOverview(null, { source });
    const checked = [...html.matchAll(/<input\b[^>]*name="canvas-source"[^>]*>/g)]
      .filter(match => /\bchecked(?:\s|=|>)/.test(match[0]));
    assert.equal(checked.length, 1, `${source} 应是唯一选中的指令源`);
    assert.match(checked[0][0], new RegExp(`value="${source}"`));
    const targets = homeTargets(html);
    for (const route of ['#/parameters/app?module=app-comms', '#/debug']) {
      const target = targets.find(item => item.route === route);
      assert.ok(target);
      assert.match(target.tag, /data-home-source=/);
    }
  }
});

test('homepage displays the active joint model and edits the selected components without mutating the project', () => {
  const project = createNeo75hProject('KW');
  const assembly = project.catalog.assemblies.find(item => item.id === project.catalog.activeAssemblyId);
  const actuator = project.catalog.actuators.find(item => item.id === project.catalog.activeActuatorId);
  const driver = project.catalog.drivers.find(item => item.id === project.catalog.activeDriverId);
  assembly.name = '关节 <A> "型号"';
  actuator.name = '执行器 <B> "型号"';
  driver.name = '驱动器 <C> "型号"';
  const previousId = actuator.id;
  actuator.id = 'actuator / "A"';
  assembly.actuatorId = actuator.id;
  project.catalog.activeActuatorId = actuator.id;
  const before = structuredClone(project), html = renderArchitectureOverview(project);
  assert.deepEqual(project, before);
  assert.equal(selectedModel(html, 'configuration-assembly'), assembly.id);
  assert.equal(selectedModel(html, 'configuration-actuator'), actuator.id);
  assert.equal(selectedModel(html, 'configuration-driver'), driver.id);
  for (const label of ['关节 &lt;A&gt; &quot;型号&quot;', '执行器 &lt;B&gt; &quot;型号&quot;', '驱动器 &lt;C&gt; &quot;型号&quot;']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /<A>|<B>|<C>/);
  const routes = homeTargets(html).map(target => target.route);
  assert.ok(routes.includes(`#/equipment/assemblies/${encodeURIComponent(assembly.id)}`));
  assert.ok(routes.filter(route => route === `#/equipment/actuators/${encodeURIComponent(actuator.id)}`).length >= 2, '电机、减速机应进入当前执行器参数');
  assert.ok(!routes.some(route => route.includes(previousId)), '不应使用旧执行器地址');
});

test('independent component choices display mixed models without retaining an unrelated joint model', () => {
  const project = createNeo75hProject('KW');
  const originalActuator = project.catalog.activeActuatorId, originalDriver = project.catalog.activeDriverId;
  const otherActuator = { ...structuredClone(project.catalog.actuators[0]), id: 'mixed-actuator', name: '混搭执行器' };
  const otherDriver = { ...structuredClone(project.catalog.drivers[0]), id: 'mixed-driver', name: '混搭驱动器' };
  project.catalog.actuators.push(otherActuator);
  project.catalog.drivers.push(otherDriver);
  const selectedDriver = selectConfigurationDriver(project, otherDriver.id);
  const selectedActuator = selectConfigurationActuator(project, otherActuator.id);
  const mixed = selectConfigurationDriver(selectedActuator, otherDriver.id);
  for (const [selection, actuatorId, driverId] of [
    [selectedDriver, originalActuator, otherDriver.id],
    [selectedActuator, otherActuator.id, originalDriver],
    [mixed, otherActuator.id, otherDriver.id],
  ]) {
    assert.equal(selection.catalog.activeAssemblyId, '');
    assert.equal(selection.catalog.activeActuatorId, actuatorId);
    assert.equal(selection.catalog.activeDriverId, driverId);
    const html = renderArchitectureOverview(selection);
    assert.equal(selectedModel(html, 'configuration-assembly'), '');
    assert.equal(selectedModel(html, 'configuration-actuator'), actuatorId);
    assert.equal(selectedModel(html, 'configuration-driver'), driverId);
    assert.ok(homeTargets(html).some(({route}) => route === `#/equipment/actuators/${actuatorId}`));
  }
});

test('missing active model references fall back to project selection instead of unrelated shelf entries', () => {
  const project = createNeo75hProject('KW');
  project.catalog.activeAssemblyId = 'missing-joint';
  project.catalog.activeActuatorId = 'missing-actuator';
  project.catalog.activeDriverId = 'missing-driver';
  const html = renderArchitectureOverview(project), targets = homeTargets(html);
  const physical = targets.filter(({tag}) => /class="[^"]*chain-physical\b/.test(tag));
  assert.equal(physical.length, 2);
  assert.ok(physical.every(({route}) => route === '#/equipment/actuators'));
  assert.ok(targets.every(({route}) => !/undefined|null|missing-/.test(route)));
});

test('every layer shows its whole module catalogue in definition order without instance settings', () => {
  for (const layer of ['hardware', 'foc', 'app']) {
    const html = renderArchitectureLayer(layer);
    const expected = MODULES.filter(module => module.layer === layer && !['foc-feedback','foc-lifecycle','hw-safety'].includes(module.id)).sort((a, b) => a.order - b.order);
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
  for (const id of module.dependencies.filter(id => !['hw-safety','foc-lifecycle'].includes(id))) assert.ok(html.includes(`href="${architectureModuleRoute(id)}"`));
  assertReadOnly(html);
});

test('unknown or cross-layer selection resolves safely within the static catalogue', () => {
  assert.equal(architectureModuleRoute('missing'), '#/architecture');
  const html = renderArchitectureLayer('<img onerror="bad">', 'foc-current');
  assert.match(html, /id="architecture-module-title">内核<\/h2>/);
  assert.doesNotMatch(html, /<img|onerror/);
  assertReadOnly(html);
});

test('algorithm exception routes fall back to current-loop and stay out of module relationship links', () => {
  assert.equal(architectureModuleRoute('foc-lifecycle'),'#/architecture/foc?module=foc-current');
  assert.match(renderArchitectureLayer('foc','foc-lifecycle'),/id="architecture-module-title">电流环<\/h2>/);
  for(const module of MODULES)assert.doesNotMatch(renderArchitectureLayer(module.layer,module.id),/module=foc-lifecycle/);
});
