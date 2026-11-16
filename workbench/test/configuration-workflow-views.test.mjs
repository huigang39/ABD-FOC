import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { MODULES } from '../web/src/core/catalog.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { beginCustomHardware } from '../web/src/features/configuration/workspace.mjs';
import { renderGuide, renderConfigurationActions, renderModuleData, guideStrip, renderStructures, renderFaults, renderProtocol } from '../web/src/features/configuration/view.mjs';

const context = {
  parameters: module => `<div data-parameters="${module.id}"></div>`,
  moduleExtras: module => `<div data-extras="${module.id}"></div>`,
  moduleRoute: (id, tab = 'config') => `#/project/${id.startsWith('hw-') ? 'hardware' : id.startsWith('foc-') ? 'algorithm' : 'application'}?module=${id}&tab=${tab}`,
};

test('工程文件操作独立放入顶栏，目录与编辑器不再重复标题和工具栏', () => {
  const project = createNeo75hProject('KW');
  project.name = '配置 <A> "测试"';
  const html = renderGuide(project, [], 'actuator', context);
  const actions = renderConfigurationActions(project, { profileVariant: 'LD' });
  assert.doesNotMatch(html, /<h1>工程<\/h1>|configuration-toolbar|configuration-name|data-action="(?:import|save|export)"/);
  assert.match(actions, /data-scope="project" data-key="name" value="配置 &lt;A&gt; &quot;测试&quot;"/);
  for (const action of ['export', 'new-configuration', 'new-neo75h']) assert.match(actions, new RegExp(`data-action="${action}"`));
  assert.doesNotMatch(actions, /data-action="(?:import|save)"/);
  assert.match(actions, /id="neo75h-variant" data-native-field="profileVariant"/);
  assert.match(actions, /value="LD" selected/);
  assert.match(actions, /NEO_75_H_GW_XH · 待适配/);
  assert.match(renderConfigurationActions(project, { configurationLocked: true }), /data-action="new-neo75h" disabled/);
  for (const step of ['actuator', 'hardware', 'algorithm', 'application', 'build']) assert.ok(html.includes(`href="#/project/${step}"`));
  assert.doesNotMatch(html, /href="#\/project\/flash"/);
  assert.doesNotMatch(html, /#\/guide|open-projects|load-local|本地保存的项目|data-parameters=/);
  assert.match(guideStrip(createProject(), []), /href="#\/project\/actuator"/);
});

test('选型同时展示独立执行器和驱动器，硬件步骤只配置参数', () => {
  const project = createNeo75hProject('KW');
  const before = structuredClone(project);
  const actuator = renderGuide(project, [], 'actuator', context);
  assert.match(actuator, /data-edit="configuration-actuator"/);
  assert.match(actuator, /data-edit="configuration-driver"/);
  assert.match(actuator, /configuration-model-selection/);
  assert.doesNotMatch(actuator, /管理执行器|管理驱动器|查看与编辑参数|驱动器在下一步/);
  assert.ok(actuator.includes(`href="#/equipment/actuators/${encodeURIComponent(project.catalog.activeActuatorId)}">编辑参数</a>`));
  assert.ok(actuator.includes(`href="#/equipment/drivers/${encodeURIComponent(project.catalog.activeDriverId)}">编辑参数</a>`));
  assert.match(actuator, /<\/dl><div class="configuration-asset-actions"><a[^>]+>编辑参数<\/a>/);
  const hardware = renderGuide(project, [], 'hardware', context);
  assert.doesNotMatch(hardware, /data-edit="configuration-(?:actuator|driver)"|data-action="configure-custom-hardware"/);
  assert.match(hardware, /data-parameters="hw-platform"/);
  const custom = renderGuide(beginCustomHardware(project), [], 'actuator', context);
  assert.doesNotMatch(actuator + custom, /自行配置硬件|data-action="configure-custom-hardware"/);
  assert.match(custom, /data-edit="configuration-driver"/);
  assert.match(custom, /请选择驱动器/);
  assert.match(custom, /href="#\/equipment\/drivers"/);
  assert.deepEqual(project, before);
});

test('模块直接显示参数，旧数据与接口地址降级到配置且保留底层设计', () => {
  const project = createNeo75hProject('KW');
  const before = structuredClone(project);
  for (const [step, id] of [['hardware', 'hw-platform'], ['algorithm', 'foc-current'], ['application', 'app-motion']]) {
    const parameters = renderGuide(project, [], step, { ...context, selectedModuleId: id, tab: 'config' });
    assert.match(parameters, new RegExp(`data-parameters="${id}"`));
    assert.match(parameters, new RegExp(`data-guide-module="${id}"`));
    assert.match(parameters, new RegExp(`<h2>${MODULES.find(module=>module.id===id).title}</h2>`));
    assert.doesNotMatch(parameters, /<details[^>]+data-guide-module=|class="guide-module panel"/);
    assert.doesNotMatch(parameters, /data-live="module-status-/);
    assert.doesNotMatch(parameters, /module-tag-required|>必需</);
    assert.doesNotMatch(parameters, new RegExp(`data-action="toggle-module" data-module="${id}"`));
    assert.doesNotMatch(parameters, /configuration-module-tabs|data-tree-tab|tab=data|tab=interfaces|data-contract-role/);
    for (const tab of ['data', 'interfaces']) {
      const legacy = renderGuide(project, [], step, { ...context, selectedModuleId: id, tab, interfaces: () => assert.fail('旧接口页面不应被渲染') });
      assert.match(legacy, new RegExp(`<section class="guide-content guide-module-editor" data-guide-module="${id}"`));
      assert.match(legacy, new RegExp(`data-parameters="${id}"`));
      assert.match(legacy, new RegExp(`data-extras="${id}"`));
      assert.doesNotMatch(legacy, /configuration-module-tabs|data-tree-tab|tab=data|tab=interfaces|data-contract-role/);
      assert.equal(legacy, parameters);
    }
  }
  assert.deepEqual(project, before);
});

test('模块概览保留分组，单模块页面只保留一层标题和参数区域', () => {
  const project=createNeo75hProject('KW');
  const overview=renderGuide(project,[],'hardware',context);
  assert.match(overview,/<h2>硬件<\/h2>/);
  assert.deepEqual([...overview.matchAll(/<details class="guide-module panel" data-guide-module="([^"]+)"/g)].map(match=>match[1]),['hw-platform','hw-board','hw-drivers']);
  const selected=renderGuide(project,[],'hardware',{...context,selectedModuleId:'hw-platform'});
  assert.match(selected,/<h2>内核<\/h2>/);
  assert.doesNotMatch(selected,/<h2>硬件<\/h2>|data-state-key="configuration-module-hw-platform"/);
  assert.equal([...selected.matchAll(/data-guide-module=/g)].length,1);
  assert.match(selected,/<div class="profile-form"><div data-parameters="hw-platform"><\/div><\/div><div data-extras="hw-platform">/);
});

test('模块检查清单只包含当前模块的问题，概览才汇总整个配置步骤', () => {
  const project=createNeo75hProject('KW');
  const issues=[{id:'core-only',moduleId:'hw-platform',level:'error'},{id:'board-only',moduleId:'hw-board',level:'pending'},{id:'other-layer',moduleId:'app-motion',level:'error'}];
  const ids=html=>JSON.parse(html.match(/class="guide-summary-check"[^>]*><button[^>]*data-issue-ids="([^"]*)"/)[1].replaceAll('&quot;','"'));
  const selected=renderGuide(project,issues,'hardware',{...context,selectedModuleId:'hw-platform'});
  assert.deepEqual(ids(selected),['core-only']);
  assert.match(selected,/aria-label="内核检查清单，1 项"/);
  assert.deepEqual(ids(renderGuide(project,issues,'hardware',context)),['core-only','board-only']);
  const empty=renderGuide(project,issues.slice(1),'hardware',{...context,selectedModuleId:'hw-platform'});
  assert.deepEqual(ids(empty),[]);assert.match(empty,/aria-label="内核检查清单，0 项"/);
});

test('未添加模块的单独页面保留添加入口，算法子功能仍可直接添加', () => {
  const project=createProject();
  project.instances['app-comms'].enabled=false;
  const communication=renderGuide(project,[],'application',{...context,selectedModuleId:'app-comms'});
  assert.match(communication,new RegExp(`<h2>${MODULES.find(module=>module.id==='app-comms').title}</h2>`));
  assert.match(communication,/data-action="add-module" data-module="app-comms"/);
  assert.doesNotMatch(communication,/data-parameters="app-comms"|<details[^>]+data-guide-module=/);
  const observer=renderGuide(project,[],'algorithm',{...context,selectedModuleId:'foc-observer'});
  assert.match(observer,/data-parameters="foc-observer"/);
  assert.doesNotMatch(observer,/data-action="add-module" data-module="foc-observer"/);
});

test('检查与烧录集成到构建内容，目录不再包含独立检查或烧录页', () => {
  const project = createProject();
  const build = renderGuide(project, [], 'build', { ...context, buildHtml: '<div data-validation-body>当前检查</div><button data-test-build>检查并构建</button>' });
  assert.match(build, /data-validation-body/);
  assert.match(build, /data-test-build/);
  assert.doesNotMatch(build, /href="#\/project\/validation"|data-parameters=/);
  assert.doesNotMatch(renderGuide(project, [], 'build', context), /data-native-action="(?:generate|build)"/);
  const flash = renderGuide(project, [], 'build', { ...context, buildHtml: '<button data-test-build>生成编译</button><button disabled data-test-flash>烧录</button>' });
  assert.match(flash, /<button disabled data-test-flash>/);
  assert.match(flash, /data-test-build/);
  assert.doesNotMatch(flash, /href="#\/project\/flash"/);
  assert.doesNotMatch(renderGuide(project, [], 'build', context), /data-native-action="flash"/);
});

test('数据结构与应用设计页的编辑链接均留在工程内', () => {
  const project = createNeo75hProject('KW');
  const structureId = project.design.moduleContracts['foc-current'].input;
  const module = { id: 'foc-current', title: '电流环', layer: 'foc' };
  const pages = [renderModuleData(project, module), renderStructures(project, [], structureId), renderFaults(project, []), renderProtocol(project, [])];
  for (const html of pages) assert.doesNotMatch(html, /href="#\/(?:layer|structures|interfaces|faults|protocol)\//);
  assert.match(pages[1], /href="#\/project\/algorithm/);
  assert.match(pages[1], /href="#\/architecture"/);
  assert.doesNotMatch(pages[1], /tab=interfaces|本模块的接口页/);
  assert.match(pages[2], /href="#\/project\/application/);
});

test('必需模块不显示标签，可选模块通过添加移除管理且算法组合按子功能添加', () => {
  const project = createNeo75hProject('KW');
  for (const [step, layer] of [['hardware', 'hardware'], ['algorithm', 'foc'], ['application', 'app']]) {
    const html = renderGuide(project, [], step, context);
    assert.doesNotMatch(html, /data-action="toggle-(?:module|runtime)"/);
    for (const module of MODULES.filter(module => module.layer === layer && !['foc-feedback','foc-lifecycle','hw-safety'].includes(module.id))) {
      const actions = [...html.matchAll(new RegExp(`data-action="(add-module|remove-module)" data-module="${module.id}"`, 'g'))].map(match => match[1]);
      if (module.required) {
        assert.deepEqual(actions, []);
        assert.doesNotMatch(html, /module-tag-required|>必需</);
        continue;
      }
      if (['foc-observer', 'foc-filter', 'foc-compensation'].includes(module.id)) {
        assert.deepEqual(actions, [], '算法组合通过子功能添加，不再显示总开关');
        continue;
      }
      assert.deepEqual(actions, [project.instances[module.id].enabled ? 'remove-module' : 'add-module']);
    }
  }
  const closed = renderGuide(project, [], 'algorithm', { ...context, selectedModuleId: 'foc-current' });
  assert.equal([...closed.matchAll(/data-action="toggle-runtime" data-module="foc-observer"/g)].length, 0);
  assert.match(closed, /data-tree-module="foc-observer"/);
});
