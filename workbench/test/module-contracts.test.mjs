import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../web/src/core/catalog.mjs';
import { createProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { createDesign, createField, createStructure, checkDesignShape, validateDesign, configurationFingerprint } from '../web/src/core/contracts.mjs';
import { CONTRACT_ROLES, createLayerInterface, createInterfaceMapping, ensureModuleContracts, checkModuleContractsShape, getModuleContract, getModuleContractRole, validateModuleContracts } from '../web/src/core/module-contracts.mjs';

const has = (project, id, level) => validateModuleContracts(project).some(issue => issue.id === `contract-${id}` && (!level || issue.level === level));
const dataField = (id, name = 'angle') => ({ ...createField(id), name, type: 'f32', count: 1, unit: 'rad', meaning: '有效机械角度' });
function fixture() {
  const project = createProject();
  const source = getModuleContract(project.design, 'hw-drivers', 'output');
  const target = getModuleContract(project.design, 'foc-feedback', 'input');
  source.fields=[dataField('angle-source')]; target.fields=[dataField('angle-target')];
  const item = { ...createLayerInterface('sensor-feedback'), name: '采样 → 角度反馈', fromModule: 'hw-drivers', toModule: 'foc-feedback', sourceStructure: source.id, targetStructure: target.id, version: 'β/接口甲', rate: 'fast', handoff: 'snapshot', fieldMap: [{ ...createInterfaceMapping('angle-map'), sourceField: 'angle-source', targetField: 'angle-target' }] };
  project.design.layerInterfaces = [item];
  return { project, source, target, item };
}

test('十七模块分别拥有输入输出状态，51个新结构名有效唯一并保留旧7模板', () => {
  const design = createDesign();
  assert.deepEqual(CONTRACT_ROLES, ['input', 'output', 'state']);
  assert.equal(design.structures.length, 58);
  assert.equal(checkModuleContractsShape(design), true);
  assert.doesNotThrow(() => checkDesignShape(design));
  const refs = [];
  for (const module of MODULES) for (const role of CONTRACT_ROLES) {
    const structure = getModuleContract(design, module.id, role);
    assert.ok(structure);
    assert.equal(structure.owner, module.id);
    assert.deepEqual(structure.fields, module.contracts[role].fields);
    assert.ok(structure.fields.length);
    assert.deepEqual(structure.consumers, []);
    assert.match(structure.name, /^[A-Za-z_]\w*$/);
    assert.deepEqual(getModuleContractRole(design, structure.id), { moduleId: module.id, role });
    refs.push(structure.id);
  }
  assert.equal(new Set(refs).size, 51);
  assert.equal(new Set(design.structures.map(structure => structure.name)).size, 58);
  assert.equal(getModuleContract(design, 'hw-drivers', 'state').name, 'DriversState');
  assert.equal(getModuleContractRole(design, 'sample-frame'), null);
});

test('新增迁移纯函数幂等，避开已有名称与ID冲突，保留用户数据和原引用', () => {
  const design = createDesign();
  delete design.moduleContracts; delete design.layerInterfaces;
  design.structures = design.structures.slice(0, 7);
  design.structures.push({ ...createStructure('hw-drivers-input'), name: 'DriversInput', owner: 'app-motion', fields: [dataField('legacy-field')] });
  const before = structuredClone(design), next = ensureModuleContracts(design);
  assert.deepEqual(design, before);
  assert.deepEqual(next.structures.slice(0, 8), design.structures);
  assert.equal(getModuleContract(next, 'hw-drivers', 'input').id, 'hw-drivers-input-2');
  assert.equal(getModuleContract(next, 'hw-drivers', 'input').name, 'DriversInput2');
  assert.deepEqual(ensureModuleContracts(next), next);
  next.structures[0].fields[0].name = 'changed';
  assert.notEqual(design.structures[0].fields[0].name, 'changed');
  const project = createProject(); project.design = design;
  const loaded = parseProject(JSON.stringify(project));
  assert.deepEqual(loaded.design, ensureModuleContracts(design));
  assert.deepEqual(parseProject(serializeProject(loaded)), loaded);
});

test('后续载入不重建被删除的角色结构，不重置角色字段与编辑名称', () => {
  const project = createProject();
  const output = getModuleContract(project.design, 'hw-drivers', 'output');
  output.name = 'UserOwnedSensorData'; output.fields.push(dataField('preserved'));
  const missing = project.design.moduleContracts['hw-drivers'].input;
  project.design.structures = project.design.structures.filter(structure => structure.id !== missing);
  const restored = parseProject(serializeProject(project));
  assert.equal(getModuleContract(restored.design, 'hw-drivers', 'input'), null);
  assert.equal(restored.design.moduleContracts['hw-drivers'].input, missing);
  assert.ok(has(restored, 'hw-drivers-input-unknown', 'error'));
  assert.deepEqual(getModuleContract(restored.design, 'hw-drivers', 'output'), output);
});

test('空结构只按已包含模块聚合一次待设计提示，不重复48条空字段告警', () => {
  const project = createProject();
  project.design.layerInterfaces = [];
  for(const refs of Object.values(project.design.moduleContracts))for(const id of Object.values(refs))project.design.structures.find(s=>s.id===id).fields=[];
  const issues = validateModuleContracts(project);
  assert.equal(issues.filter(issue => issue.id.endsWith('-fields')).length, MODULES.filter(module => project.instances[module.id].enabled).length);
  assert.equal(issues.filter(issue => issue.level === 'error').length, 0);
  assert.equal(has(project, 'foc-observer-fields'), false);
  assert.equal(validateDesign(project).filter(issue => /structure-\d+-fields-empty/.test(issue.id)).length, 0);
  for (const role of CONTRACT_ROLES) getModuleContract(project.design, 'hw-drivers', role).fields.push(dataField(role));
  assert.equal(has(project, 'hw-drivers-fields'), false);
  const all = validateProject(project);
  assert.equal(new Set(all.map(issue => issue.id)).size, all.length);
});

test('角色不可共用结构或改变所有者，但合法类型的冲突草案可保存', () => {
  const project = createProject();
  const refs = project.design.moduleContracts['hw-drivers'];
  refs.input = refs.output;
  getModuleContract(project.design, 'hw-drivers', 'output').owner = 'foc-feedback';
  assert.ok(has(project, 'hw-drivers-output-shared', 'error'));
  assert.ok(has(project, 'hw-drivers-output-owner', 'error'));
  assert.deepEqual(parseProject(serializeProject(project)), project);
});

test('接口与映射工厂支持指定ID，默认引用未知且各次创建相互独立', () => {
  assert.equal(createLayerInterface('fixed').id, 'fixed');
  assert.equal(createInterfaceMapping('fixed').id, 'fixed');
  assert.notEqual(createLayerInterface().id, createLayerInterface().id);
  assert.notEqual(createInterfaceMapping().id, createInterfaceMapping().id);
  const item = createLayerInterface();
  assert.equal(item.rate, 'unselected'); assert.equal(item.handoff, 'unselected');
  assert.equal(item.sourceStructure, ''); assert.equal(item.toModule, '');
  item.fieldMap.push(createInterfaceMapping());
  assert.deepEqual(createLayerInterface().fieldMap, []);
});

test('跨层输出至输入的精确字段映射可保存，不把声明匹配当运行验证', () => {
  const { project } = fixture();
  const before = structuredClone(project);
  const issues = validateModuleContracts(project).filter(issue => issue.designPage === 'interfaces');
  assert.deepEqual(issues, []);
  assert.deepEqual(project, before);
  assert.deepEqual(parseProject(serializeProject(project)), project);
  assert.ok(validateProject(project).some(issue => issue.id === 'realtime-budget' && issue.level === 'pending'));
});

test('模块接口允许同层连接，且结构必须对应所选模块的输出及输入角色', () => {
  const { project, item } = fixture();
  item.toModule = 'hw-board'; item.targetStructure = project.design.moduleContracts['hw-board'].input;
  assert.equal(has(project, 'interface-0-same-layer', 'error'), false);
  item.toModule = 'hw-drivers'; item.targetStructure = project.design.moduleContracts['hw-drivers'].input;
  assert.ok(has(project, 'interface-0-same-module', 'error'));
  item.toModule = 'foc-feedback'; item.targetStructure = project.design.moduleContracts['foc-feedback'].output;
  assert.ok(has(project, 'interface-0-target-role', 'error'));
  item.sourceStructure = project.design.moduleContracts['hw-board'].output;
  assert.ok(has(project, 'interface-0-source-role', 'error'));
  item.sourceStructure = 'removed';
  assert.ok(has(project, 'interface-0-source-unknown', 'error'));
  item.toModule = 'missing-module';
  assert.ok(has(project, 'interface-0-toModule', 'error'));
});

test('内部状态不能作为任何层间端点、其他模块消费结构或协议载荷', () => {
  const { project, item } = fixture();
  const state = getModuleContract(project.design, 'hw-drivers', 'state');
  state.consumers.push('foc-feedback');
  item.sourceStructure = state.id;
  item.targetStructure = getModuleContract(project.design, 'foc-feedback', 'state').id;
  project.design.protocol.messages[0].payload = state.id;
  assert.ok(has(project, 'hw-drivers-state-exposed', 'error'));
  assert.ok(has(project, 'interface-0-source-state', 'error'));
  assert.ok(has(project, 'interface-0-target-state', 'error'));
  assert.ok(has(project, 'message-0-state', 'error'));
});

test('映射按字段ID精确引用，类型数量冲突报错，单位不匹配保留换算警告', () => {
  const { project, source, target, item } = fixture();
  item.fieldMap[0].sourceField = source.fields[0].name;
  assert.ok(has(project, 'interface-0-map-0-source-unknown', 'error'));
  item.fieldMap[0].sourceField = source.fields[0].id;
  Object.assign(target.fields[0], { type: 'u16', count: 2, unit: 'degree' });
  assert.ok(has(project, 'interface-0-map-0-type', 'error'));
  assert.ok(has(project, 'interface-0-map-0-count', 'error'));
  assert.ok(has(project, 'interface-0-map-0-unit', 'warning'));
  source.fields.push({ ...source.fields[0] });
  assert.ok(has(project, 'interface-0-map-0-source-unknown', 'error'));
});

test('目标输入漏映射为pending，重复来源为error，映射删除不被自动补回', () => {
  const { project, item, target } = fixture();
  target.fields.push(dataField('second-target', 'second_angle'));
  assert.ok(has(project, 'foc-feedback-unmapped', 'pending'));
  item.fieldMap.push({ ...createInterfaceMapping('second'), sourceField: 'angle-source', targetField: 'second-target' });
  assert.equal(has(project, 'foc-feedback-unmapped'), false);
  item.fieldMap[1].targetField = 'angle-target';
  assert.ok(has(project, 'interface-0-map-1-duplicate-target', 'error'));
  item.fieldMap = [];
  assert.ok(has(project, 'interface-0-unmapped', 'pending'));
  assert.deepEqual(parseProject(serializeProject(project)).design.layerInterfaces[0].fieldMap, []);
});

test('未包含的接口端点仅作warning，更新时序及交接方式未定保持pending', () => {
  const { project, item } = fixture();
  item.toModule = 'foc-observer'; item.targetStructure = project.design.moduleContracts['foc-observer'].input; item.fieldMap = [];
  item.rate = 'unselected'; item.handoff = 'unselected';
  assert.ok(has(project, 'interface-0-toModule-excluded', 'warning'));
  assert.ok(has(project, 'interface-0-rate', 'pending'));
  assert.ok(has(project, 'interface-0-handoff', 'pending'));
  item.rate = 'background'; item.handoff = 'queue';
  assert.doesNotThrow(() => checkDesignShape(project.design));
  assert.equal(has(project, 'interface-0-rate'), false);
  project.instances['foc-observer'].enabled = true;
  assert.equal(has(project, 'interface-0-toModule-excluded'), false);
});

test('新增严格shape拒绝未知模块、local旧角色、非法枚举和映射字段类型', () => {
  const { project } = fixture();
  for (const mutate of [
    design => { design.moduleContracts.other = {}; },
    design => { design.moduleContracts['hw-drivers'].local = 'somewhere'; },
    design => { design.moduleContracts['hw-drivers'].state = null; },
    design => { delete design.moduleContracts['hw-drivers'].input; },
    design => { design.layerInterfaces = null; },
    design => { design.layerInterfaces[0].rate = 'realtime'; },
    design => { design.layerInterfaces[0].handoff = 'magic'; },
    design => { design.layerInterfaces[0].version = 1; },
    design => { design.layerInterfaces[0].fieldMap[0].sourceField = []; },
    design => { design.layerInterfaces[0].fieldMap[0].conversion = 'guess'; },
  ]) { const design = structuredClone(project.design); mutate(design); assert.throws(() => checkModuleContractsShape(design)); }
  const invalid = structuredClone(project); invalid.design.moduleContracts = null;
  assert.throws(() => parseProject(JSON.stringify(invalid)), /moduleContracts.*必须是对象/);
  const poisoned = JSON.parse(JSON.stringify(project).replace('"moduleContracts":{', '"moduleContracts":{"__proto__":{},'));
  assert.throws(() => parseProject(JSON.stringify(poisoned)), /未知字段.*__proto__/);
});

test('模块结构和层间映射改动都使已有配置指纹过期', () => {
  const { project } = fixture();
  const fingerprint = configurationFingerprint(project);
  for (const mutate of [
    design => { getModuleContract(design, 'hw-drivers', 'state').fields.push(dataField('state-value')); },
    design => { design.layerInterfaces[0].handoff = 'call'; },
    design => { design.layerInterfaces[0].fieldMap[0].targetField = 'changed'; },
  ]) { const changed = structuredClone(project); mutate(changed.design); assert.notEqual(configurationFingerprint(changed), fingerprint); }
});
