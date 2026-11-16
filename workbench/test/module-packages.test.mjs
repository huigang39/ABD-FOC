import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { MODULES, MODULE_IDS } from '../web/src/modules/registry.mjs';
import { MODULES as catalogModules } from '../web/src/core/catalog.mjs';
import { createProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { createDesign } from '../web/src/core/contracts.mjs';
import { ensureModuleContracts, getModuleContract, CONTRACT_ROLES } from '../web/src/core/module-contracts.mjs';
import { validateModuleConfiguration } from '../web/src/modules/validation.mjs';
import { renderModuleExtras } from '../web/src/modules/presentation.mjs';
import { renderSensorConfig } from '../web/src/modules/hardware/hw-drivers/view.mjs';
import { SENSOR_ROLES } from '../web/src/modules/hardware/hw-drivers/sensors.mjs';

const root = new URL('../web/src/modules/', import.meta.url);
const layerNames = { hardware: 'hardware', algorithm: 'foc', application: 'app' };
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const context = (project, issues = []) => ({ project, issues, escape, number: String,
  moduleRoute: (id, tab) => `#/module/${id}/${tab}`,
  issueNoticeButton: list => `<button data-issue-count="${list.length}">检查</button>`,
});

test('每个模块目录恰好注册一次，依赖引用有效，catalog 使用同一注册表', async () => {
  const discovered = [];
  for (const [directory, layer] of Object.entries(layerNames)) {
    const folders = await readdir(new URL(`${directory}/`, root), { withFileTypes: true });
    for (const folder of folders.filter(item => item.isDirectory())) {
      const url = new URL(`${directory}/${folder.name}/definition.mjs`, root);
      const { default: definition } = await import(url);
      assert.equal(definition.id, folder.name);
      assert.equal(definition.layer, layer);
      assert.equal(MODULES.find(module => module.id === definition.id), definition);
      discovered.push(definition.id);
    }
  }
  assert.deepEqual(discovered.sort(), [...MODULE_IDS].sort());
  assert.equal(new Set(MODULE_IDS).size, MODULE_IDS.length);
  assert.equal(catalogModules, MODULES);
  for (const definition of MODULES) {
    for (const dependency of definition.dependencies || []) assert.ok(MODULE_IDS.includes(dependency), `${definition.id}: missing ${dependency}`);
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.params), true);
    for (const role of CONTRACT_ROLES) {
      assert.equal(Object.isFrozen(definition.contracts[role].fields), true);
      assert.ok(definition.contracts[role].name);
    }
  }
});

test('模块定义的递归导入图不依赖应用壳层，也不存在循环', async () => {
  const src = new URL('../web/src/', import.meta.url);
  const inShell = url => !url.href.startsWith(src.href) || url.href.includes('/web/src/features/') || url.href.includes('/web/src/shared/ui/') || url.href.endsWith('/web/src/app.mjs');
  const visited = new Set();
  async function visit(url, parents = []) {
    assert.ok(!parents.includes(url.href), `循环导入：${[...parents, url.href].join(' → ')}`);
    if (visited.has(url.href)) return;
    assert.ok(!inShell(url), `模块定义反向依赖应用壳层：${url.href}`);
    const source = await readFile(url, 'utf8');
    const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(match => match[1]).filter(path => path.startsWith('.'));
    for (const path of imports) await visit(new URL(path, url), [...parents, url.href]);
    visited.add(url.href);
  }
  for (const definition of MODULES) {
    const directory = Object.keys(layerNames).find(name => layerNames[name] === definition.layer);
    await visit(new URL(`${directory}/${definition.id}/definition.mjs`, root));
  }
});

test('各项目的默认输入、输出、状态均独立，不共享模块模板或其他角色的字段数组', () => {
  const first = createDesign(), second = createDesign();
  const refs = new Set(), arrays = new Set();
  for (const module of MODULES) for (const role of CONTRACT_ROLES) {
    const structure = getModuleContract(first, module.id, role);
    const other = getModuleContract(second, module.id, role);
    assert.equal(structure.owner, module.id);
    assert.deepEqual(structure.fields, module.contracts[role].fields);
    assert.notEqual(structure, other);
    assert.notEqual(structure.fields, other.fields);
    assert.notEqual(structure.fields, module.contracts[role].fields);
    assert.ok(!refs.has(structure.id)); refs.add(structure.id);
    assert.ok(!arrays.has(structure.fields)); arrays.add(structure.fields);
    structure.fields.push({ id: 'local-field', name: 'local-field' });
    assert.deepEqual(other.fields, module.contracts[role].fields);
  }
});

test('补全契约不覆盖已有字段、用户绑定或删除后的悬空引用，项目保存往返保持编辑', () => {
  const project = createProject();
  const contract = getModuleContract(project.design, 'foc-current', 'input');
  contract.name = 'MyControlInput'; contract.rate = 'fast'; contract.description = '用户维护的接口';
  project.design.moduleContracts['foc-current'].output = 'intentionally-deleted-output';
  const before = structuredClone(project.design);
  const completed = ensureModuleContracts(project.design);
  assert.deepEqual(project.design, before);
  assert.deepEqual(completed, before);
  assert.notEqual(completed.structures, project.design.structures);
  assert.deepEqual(ensureModuleContracts(completed), completed);
  assert.deepEqual(parseProject(serializeProject(project)).design, project.design);
  assert.ok(validateProject(project).some(issue => issue.id === 'contract-foc-current-output-unknown'));
});

test('模块校验聚合保持纯函数，并能将错误返回到所属模块', () => {
  const project = createNeo75hProject('KW');
  project.instances['foc-current'].parameters.bandwidthHz = 0;
  const before = structuredClone(project);
  const issues = validateModuleConfiguration(freeze(project));
  assert.ok(issues.some(issue => issue.moduleId === 'foc-current' && issue.level === 'error'));
  assert.deepEqual(project, before);
  assert.deepEqual(validateModuleConfiguration(project), issues);
});

test('模块附加页面可以无 DOM 渲染，重复输出一致且不更改项目', () => {
  for (const project of [createProject(), createNeo75hProject('KW')]) {
    const before = structuredClone(project), issues = freeze(validateProject(project));
    const rendering = context(freeze(project), issues);
    for (const module of MODULES) {
      const html = renderModuleExtras(module.id, rendering);
      assert.equal(typeof html, 'string');
      assert.equal(renderModuleExtras(module.id, rendering), html);
      assert.doesNotMatch(html, /\[object Object\]|undefined/);
    }
    assert.equal(renderModuleExtras('unknown-module', rendering), '');
    assert.deepEqual(project, before);
  }
  const project = createNeo75hProject('KW');
  assert.match(renderModuleExtras('app-state', context(project)), /CiA 402/);
  project.instances['app-state'].parameters.stateMachine = 'unselected';
  assert.match(renderModuleExtras('app-runtime', context(project)), /任务与时序/);
  assert.doesNotMatch(renderModuleExtras('app-state', context(project)), /CiA 402 驱动状态机/);
});

test('传感器页面沿用三个角色，并按当前配置筛选字段而不修改参数和定义', () => {
  const parameters = createProject().instances['hw-drivers'].parameters;
  for (const role of SENSOR_ROLES) parameters[role.capability] = 'absent';
  const before = structuredClone(parameters), fields = [];
  const html = renderSensorConfig(freeze(parameters), field => {
    fields.push(field);
    return `<input data-field="${escape(field.key)}">`;
  });
  assert.deepEqual(parameters, before);
  for (const role of SENSOR_ROLES) assert.match(html, new RegExp(`data-sensor-role="${role.id}"`));
  assert.deepEqual(fields.map(field => field.key), SENSOR_ROLES.map(role => role.capability));
  for (const field of fields) {
    assert.equal(field.label, `${SENSOR_ROLES.find(role => role.capability === field.key).title}启用`);
    assert.equal(field.binarySwitch, true, '启用状态以 on/off 开关渲染');
  }
  assert.doesNotMatch(html, /配置此传感器|不使用/);
  assert.doesNotMatch(html, /data-field="motorEncoderType"|data-field="motorEncoderInterface"|data-field="torqueSensorModel"/);
});
