import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { MODULES } from '../web/src/core/catalog.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { beginCustomHardware } from '../web/src/features/configuration/workspace.mjs';
import { renderGuide, renderModuleData, guideStrip, renderStructures, renderFaults, renderProtocol } from '../web/src/features/configuration/view.mjs';

const context = {
  parameters: module => `<div data-parameters="${module.id}"></div>`,
  moduleExtras: module => `<div data-extras="${module.id}"></div>`,
  moduleRoute: (id, tab = 'config') => `#/project/${id.startsWith('hw-') ? 'hardware' : id.startsWith('foc-') ? 'algorithm' : 'application'}?module=${id}&tab=${tab}`,
};

test('工程集中导入保存导出及预置入口，六步导航不再包含项目列表', () => {
  const project = createNeo75hProject('KW');
  project.name = '配置 <A> "测试"';
  const html = renderGuide(project, [], 'actuator', { ...context, profileVariant: 'LD' });
  assert.match(html, /<h1>工程<\/h1>/);
  assert.match(html, /data-scope="project" data-key="name" value="配置 &lt;A&gt; &quot;测试&quot;"/);
  for (const action of ['import', 'export', 'save', 'new-configuration', 'new-neo75h']) assert.match(html, new RegExp(`data-action="${action}"`));
  assert.match(html, /id="neo75h-variant" data-native-field="profileVariant"/);
  assert.match(html, /value="LD" selected/);
  assert.match(html, /NEO_75_H_GW_XH · 待适配/);
  for (const step of ['actuator', 'hardware', 'algorithm', 'application', 'build', 'flash']) assert.ok(html.includes(`href="#/project/${step}"`));
  assert.doesNotMatch(html, /#\/guide|open-projects|load-local|本地保存的项目|data-parameters=/);
  assert.match(guideStrip(createProject(), []), /href="#\/project\/actuator"/);
});

test('执行器与硬件分别选型，空硬件通过真实按钮配置，不伪造下拉选项', () => {
  const project = createNeo75hProject('KW');
  const actuator = renderGuide(project, [], 'actuator', context);
  assert.match(actuator, /data-edit="configuration-actuator"/);
  assert.doesNotMatch(actuator, /data-edit="configuration-driver"/);
  assert.match(actuator, /href="#\/equipment\/actuators"/);
  const hardware = renderGuide(project, [], 'hardware', context);
  assert.match(hardware, /data-edit="configuration-driver"/);
  assert.match(hardware, /data-action="configure-custom-hardware"/);
  assert.match(hardware, /硬件配置已复用/);
  assert.match(hardware, /data-parameters="hw-platform"/);
  const custom = renderGuide(beginCustomHardware(project), [], 'hardware', context);
  assert.match(custom, /data-action="configure-custom-hardware" aria-pressed="true"/);
  assert.doesNotMatch(custom, /<option[^>]*>自行配置硬件<\/option>/);
  assert.match(custom, /已有硬件参数保留作为起点/);
});

test('算法和应用保留模块开关、参数及数据结构，并在选中的模块显示数据页', () => {
  const project = createNeo75hProject('KW');
  for (const [step, id] of [['algorithm', 'foc-current'], ['application', 'app-motion']]) {
    const parameters = renderGuide(project, [], step, { ...context, selectedModuleId: id, tab: 'config' });
    assert.match(parameters, new RegExp(`data-parameters="${id}"`));
    assert.match(parameters, new RegExp(`data-guide-module="${id}"`));
    assert.match(parameters, /module-tag-required">必需</);
    assert.doesNotMatch(parameters, new RegExp(`data-action="toggle-module" data-module="${id}"`));
    assert.ok(parameters.includes(`href="#/project/${step}?module=${id}&tab=data"`));
    const data = renderGuide(project, [], step, { ...context, selectedModuleId: id, tab: 'data' });
    assert.match(data, new RegExp(`data-state-key="configuration-module-${id}" open`));
    assert.doesNotMatch(data, new RegExp(`data-parameters="${id}"`));
    for (const role of ['input', 'output', 'state']) assert.match(data, new RegExp(`data-contract-role="${role}"`));
    assert.match(data, /href="#\/project\/structures\//);
    assert.doesNotMatch(data, /href="#\/layer\//);
  }
});

test('检查集成到构建内容，目录不再包含独立检查页', () => {
  const project = createProject();
  const build = renderGuide(project, [], 'build', { ...context, buildHtml: '<div data-validation-body>当前检查</div><button data-test-build>检查并构建</button>' });
  assert.match(build, /data-validation-body/);
  assert.match(build, /data-test-build/);
  assert.doesNotMatch(build, /href="#\/project\/validation"|data-parameters=/);
  assert.doesNotMatch(renderGuide(project, [], 'build', context), /data-native-action="(?:generate|build)"/);
  const flash = renderGuide(project, [], 'flash', { ...context, flashHtml: '<button disabled data-test-flash>烧录</button>' });
  assert.match(flash, /<button disabled data-test-flash>/);
  assert.doesNotMatch(renderGuide(project, [], 'flash', context), /data-native-action="flash"/);
});

test('数据结构与应用设计页的编辑链接均留在工程内', () => {
  const project = createNeo75hProject('KW');
  const structureId = project.design.moduleContracts['foc-current'].input;
  const module = { id: 'foc-current', title: '电流环', layer: 'foc' };
  const pages = [renderModuleData(project, module), renderStructures(project, [], structureId), renderFaults(project, []), renderProtocol(project, [])];
  for (const html of pages) assert.doesNotMatch(html, /href="#\/(?:layer|structures|interfaces|faults|protocol)\//);
  assert.match(pages[1], /href="#\/project\/algorithm/);
  assert.match(pages[2], /href="#\/project\/application/);
});

test('必需模块只显示必需标签，可选模块在标题栏提供编译与运行开关', () => {
  const project = createNeo75hProject('KW');
  for (const [step, layer] of [['hardware', 'hardware'], ['algorithm', 'foc'], ['application', 'app']]) {
    const html = renderGuide(project, [], step, context);
    for (const module of MODULES.filter(module => module.layer === layer)) {
      const toggles = [...html.matchAll(new RegExp(`data-action="toggle-(module|runtime)" data-module="${module.id}"`, 'g'))].map(match => match[1]);
      if (module.required) {
        assert.deepEqual(toggles, []);
        assert.match(html, /module-tag-required">必需</);
        continue;
      }
      assert.ok(toggles.includes('module'), `${module.id} 缺少编译开关`);
      assert.equal(toggles.includes('runtime'), project.instances[module.id].enabled === true);
    }
  }
  const closed = renderGuide(project, [], 'algorithm', { ...context, selectedModuleId: 'foc-current' });
  assert.equal([...closed.matchAll(/data-action="toggle-runtime" data-module="foc-observer"/g)].length, 0);
  assert.match(closed, /data-tree-module="foc-observer"/);
});
