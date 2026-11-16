import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createExampleProject, parseProject, serializeProject, validateProject, getDerived } from '../web/src/core/model.mjs';
import { MODULES } from '../web/src/core/catalog.mjs';
import { createField, createMessage, createStructure, configurationFingerprint } from '../web/src/core/contracts.mjs';
import { createLayerInterface, getModuleContractRole, validateModuleContracts } from '../web/src/core/module-contracts.mjs';
import { saveLayerVersion, applyLayerVersion, layerMatchesRelease } from '../web/src/features/configuration/versions.mjs';
import { createActuator, createDriver, createJointModule } from '../web/src/features/equipment/model.mjs';
import { createPerformanceDraft, savePerformanceRecord } from '../web/src/features/performance/model.mjs';
import { calibrationEnabled } from '../web/src/modules/application/app-calibration/validation.mjs';

const compensationId = 'foc-compensation';
const numericCompensation = ['viscousNmPerRadS', 'coulombNm', 'transitionRadS', 'maxCompensationNm'];
const parameters = project => project.instances['app-calibration'].parameters;

function previousProject() {
  const project = createExampleProject();
  const compensationStructures = new Set(Object.values(project.design.moduleContracts[compensationId]));
  delete project.instances[compensationId];
  delete project.design.moduleContracts[compensationId];
  project.design.structures = project.design.structures.filter(structure => !compensationStructures.has(structure.id));
  delete project.execution.assignments[compensationId];
  project.instances['foc-safety'] = { enabled: true, runtimeEnabled: true, parameters: { referenceTimeoutMs: 5, maxCurrentA: 8 } };
  for (const key of ['referenceTimeoutMs', 'maxCurrentA']) {
    delete project.instances['foc-current'].parameters[key];
    if (Object.hasOwn(project.provenance, `foc-current.${key}`)) {
      project.provenance[`foc-safety.${key}`] = project.provenance[`foc-current.${key}`];
      delete project.provenance[`foc-current.${key}`];
    }
  }
  delete project.instances['foc-current'].parameters.bandwidthHz;
  project.execution.assignments['foc-safety'] = '';
  project.design.moduleContracts['foc-safety'] = {};
  for (const role of ['input', 'output', 'state']) {
    const id = `foc-safety-${role}`;
    project.design.moduleContracts['foc-safety'][role] = id;
    project.design.structures.push({ ...createStructure(id), name: `FocSafety${role[0].toUpperCase()}${role.slice(1)}`, owner: 'foc-safety', description: `旧保护${role}说明` });
  }
  project.design.faults.find(fault => fault.id === 'feedback-invalid').source = 'foc-safety';
  delete project.design.privateStructures;
  delete project.compatibility;
  parameters(project).procedures = ['electrical_zero', 'friction'];
  delete parameters(project).enabledProcedures;
  const input = project.design.structures.find(structure => structure.id === project.design.moduleContracts['foc-current'].input);
  input.description = '保留用户写下的电流输入说明';
  input.fields.push({ ...createField('existing-current-field'), name: 'iq_user', unit: 'A', meaning: '既有字段说明' });
  project.design.layerInterfaces.push({ ...createLayerInterface('existing-link'), name: '既有连接', notes: '保留原有备注 α/β', version: 'custom-2026' });
  project.instances['app-comms'].runtimeEnabled = false;
  return project;
}
function assertCompensationOff(project) {
  const instance = project.instances[compensationId];
  assert.equal(instance.enabled, false);
  assert.equal(instance.runtimeEnabled, false);
  for (const key of numericCompensation) assert.equal(instance.parameters[key], null, key);
  assert.equal(instance.parameters.frictionModel, 'unselected');
  assert.equal(instance.parameters.frictionSource, 'unselected');
}

test('已有模块文件补齐关闭的补偿模块及三个结构，不覆盖既有字段与备注', () => {
  const previous = previousProject(), original = structuredClone(previous);
  assert.equal(Object.keys(previous.instances).length, 17);
  const loaded = parseProject(JSON.stringify(previous));
  assertCompensationOff(loaded);
  assert.deepEqual(previous, original);
  assert.equal(loaded.execution.assignments[compensationId], '');
  const refs = loaded.design.moduleContracts[compensationId];
  assert.deepEqual(Object.keys(refs), ['input', 'output', 'state']);
  assert.equal(new Set(Object.values(refs)).size, 3);
  for (const id of Object.values(refs)) {
    const structure = loaded.design.structures.find(item => item.id === id);
    assert.equal(structure.owner, compensationId);
    assert.ok(structure.fields.length > 0);
  }
  assert.equal(loaded.design.structures.length, previous.design.structures.length + 3);
  for (const structure of previous.design.structures) assert.deepEqual(loaded.design.structures.find(item => item.id === structure.id), { ...structure, owner: structure.owner === 'foc-safety' ? 'foc-current' : structure.owner });
  assert.deepEqual(loaded.design.layerInterfaces, previous.design.layerInterfaces);
  assert.deepEqual(loaded.design.faults, previous.design.faults.map(fault => ({ ...fault, source: fault.source === 'foc-safety' ? 'foc-current' : fault.source })));
  for (const [id, instance] of Object.entries(previous.instances)) {
    if (id === 'foc-safety') continue;
    assert.equal(loaded.instances[id].enabled, instance.enabled);
    assert.equal(loaded.instances[id].runtimeEnabled, instance.runtimeEnabled);
  }
});

test('旧校准列表缺少运行许可时复制已编译项目，两个数组不共享引用', () => {
  const previous = previousProject(), loaded = parseProject(JSON.stringify(previous));
  assert.deepEqual(parameters(loaded).enabledProcedures, ['electrical_zero', 'friction']);
  assert.equal(calibrationEnabled(loaded, 'friction'), true);
  parameters(loaded).enabledProcedures.pop();
  assert.deepEqual(parameters(loaded).procedures, ['electrical_zero', 'friction']);
  assert.equal(Object.hasOwn(parameters(previous), 'enabledProcedures'), false);
});

test('显式空运行许可保持关闭，已有补偿配置和核心分配不被迁移重置', () => {
  const project = createProject();
  project.instances['app-calibration'].enabled = true;
  project.instances['app-calibration'].runtimeEnabled = true;
  parameters(project).procedures = ['friction'];
  parameters(project).enabledProcedures = [];
  Object.assign(project.instances[compensationId], { enabled: true, runtimeEnabled: false });
  Object.assign(project.instances[compensationId].parameters, {
    frictionModel: 'coulomb_viscous', frictionSource: 'stored', viscousNmPerRadS: 0.04,
    coulombNm: 0.12, transitionRadS: 0.5, maxCompensationNm: 0.6,
  });
  project.execution.assignments[compensationId] = 'cm7';
  const loaded = parseProject(serializeProject(project));
  assert.deepEqual(parameters(loaded).enabledProcedures, []);
  assert.equal(calibrationEnabled(loaded, 'friction'), false);
  assert.deepEqual(loaded.instances[compensationId], project.instances[compensationId]);
  assert.equal(loaded.execution.assignments[compensationId], 'cm7');
});

test('旧算法版本缺少补偿模块时恢复为关闭，不继承当前工作副本的补偿参数', () => {
  let project = createExampleProject();
  project = saveLayerVersion(project, { layer: 'foc', version: 'old-algorithm/β', notes: '历史版本说明' });
  const snapshot = project.layerVersions.releases[0].snapshot;
  delete snapshot.instances[compensationId];
  project.instances[compensationId].enabled = true;
  project.instances[compensationId].runtimeEnabled = true;
  project.instances[compensationId].parameters.coulombNm = 9;
  const original = structuredClone(project);
  const loaded = parseProject(serializeProject(project));
  const restored = applyLayerVersion(loaded, 'foc');
  assertCompensationOff(restored);
  assert.equal(layerMatchesRelease(restored, 'foc'), true);
  assert.equal(restored.layerVersions.releases[0].notes, '历史版本说明');
  assert.deepEqual(project, original);
  assert.equal(project.instances[compensationId].parameters.coulombNm, 9);
});

test('旧应用版本恢复校准许可，显式空列表的新版应用版本仍保持关闭', () => {
  for (const explicitEmpty of [false, true]) {
    let project = createExampleProject();
    parameters(project).procedures = ['friction', 'electrical_zero'];
    parameters(project).enabledProcedures = [];
    project = saveLayerVersion(project, { layer: 'app', version: explicitEmpty ? 'explicit-off' : 'old-permission' });
    if (!explicitEmpty) delete project.layerVersions.releases[0].snapshot.instances['app-calibration'].parameters.enabledProcedures;
    parameters(project).procedures = ['hall']; parameters(project).enabledProcedures = ['hall'];
    const loaded = parseProject(serializeProject(project)), restored = applyLayerVersion(loaded, 'app');
    assert.deepEqual(parameters(restored).procedures, ['friction', 'electrical_zero']);
    assert.deepEqual(parameters(restored).enabledProcedures, explicitEmpty ? [] : ['friction', 'electrical_zero']);
    assert.equal(calibrationEnabled(restored, 'friction'), !explicitEmpty);
    assert.equal(layerMatchesRelease(restored, 'app'), true);
  }
});

test('真实 schema 1 形状去除所有后续字段后可迁移，补偿默认关闭且校准许可保留', () => {
  const previous = previousProject();
  previous.schemaVersion = 1;
  for (const key of ['build', 'design', 'commissioning', 'catalog', 'layerVersions', 'operation', 'memory', 'execution']) delete previous[key];
  for (const instance of Object.values(previous.instances)) delete instance.runtimeEnabled;
  const loaded = parseProject(JSON.stringify(previous));
  assert.equal(loaded.schemaVersion, 2);
  assertCompensationOff(loaded);
  assert.deepEqual(parameters(loaded).enabledProcedures, parameters(previous).procedures);
  for (const key of ['id', 'name', 'revision', 'updatedAt', 'target']) assert.deepEqual(loaded[key], previous[key]);
  const translatedProvenance = Object.fromEntries(Object.entries(previous.provenance).map(([key, value]) => [key.replace(/^foc-safety\./, 'foc-current.'), value]));
  assert.deepEqual(loaded.provenance, translatedProvenance);
  for (const [id, instance] of Object.entries(previous.instances)) {
    if (id === 'foc-safety') continue;
    assert.equal(loaded.instances[id].enabled, instance.enabled);
    assert.equal(loaded.instances[id].runtimeEnabled, instance.enabled);
  }
  assert.equal(Object.keys(loaded.design.moduleContracts).length, MODULES.length);
  assert.ok(loaded.memory && loaded.execution);
  assert.deepEqual(parseProject(serializeProject(previous)), loaded);
});

test('迁移只补缺失字段，不把显式坏数据当旧格式重置', () => {
  const invalidCompensation = previousProject(); invalidCompensation.instances[compensationId] = null;
  assert.throws(() => parseProject(JSON.stringify(invalidCompensation)), /foc-compensation/);
  const invalidCore = previousProject(); invalidCore.execution.assignments[compensationId] = null;
  assert.throws(() => parseProject(JSON.stringify(invalidCore)), /foc-compensation/);
  const invalidRuntime = previousProject(); parameters(invalidRuntime).enabledProcedures = ['not-a-procedure'];
  assert.throws(() => parseProject(JSON.stringify(invalidRuntime)), /enabledProcedures/);
});

test('补偿开关与系数、校准运行许可、内存及核心分配都会使联调指纹变化', () => {
  const project = parseProject(JSON.stringify(previousProject())), baseline = configurationFingerprint(project);
  for (const mutate of [
    next => { next.instances[compensationId].enabled = true; },
    next => { next.instances[compensationId].runtimeEnabled = true; },
    next => { next.instances[compensationId].parameters.coulombNm = 0.2; },
    next => { parameters(next).enabledProcedures = []; },
    next => { next.memory.placements.foc.budgetKiB = 64; },
    next => { next.execution.assignments[compensationId] = 'cm7'; },
  ]) {
    const changed = structuredClone(project); mutate(changed);
    assert.notEqual(configurationFingerprint(changed), baseline);
  }
});

test('新项目与迁移后的旧项目多次导出导入保持稳定，不反复增加结构或恢复已关闭校准', () => {
  const fresh = createProject();
  fresh.instances['app-calibration'].enabled = true;
  parameters(fresh).procedures = ['friction']; parameters(fresh).enabledProcedures = [];
  for (const source of [fresh, previousProject()]) {
    const first = parseProject(JSON.stringify(source)), serialized = serializeProject(first);
    const second = parseProject(serialized), third = parseProject(serializeProject(second));
    assert.deepEqual(second, first); assert.deepEqual(third, first);
    assert.equal(serializeProject(second), serialized);
    assert.equal(third.design.structures.length, first.design.structures.length);
  }
});

test('旧保护参数、来源与默认分配并入电流环，带宽未知且旧 PI 不参与必填检查', () => {
  const previous = previousProject();
  previous.build.moduleOptimizations['foc-safety'] = 'O2';
  delete previous.execution.assignments['foc-current'];
  delete previous.execution.assignments['foc-lifecycle'];
  previous.execution.assignments['foc-safety'] = 'cm7';
  for (const key of ['kpD', 'kiD', 'kpQ', 'kiQ']) {
    previous.instances['foc-current'].parameters[key] = null;
    delete previous.provenance[`foc-current.${key}`];
  }
  const loaded = parseProject(JSON.stringify(previous));
  const current = loaded.instances['foc-current'].parameters;
  const lifecycle = loaded.instances['foc-lifecycle'].parameters;
  assert.equal(lifecycle.referenceTimeoutMs, 5); assert.equal(lifecycle.maxCurrentA, 8);
  assert.equal(current.bandwidthHz, null);
  assert.equal(Object.hasOwn(loaded.instances, 'foc-safety'), false);
  assert.equal(Object.hasOwn(loaded.build.moduleOptimizations, 'foc-safety'), false);
  assert.equal(Object.hasOwn(loaded.execution.assignments, 'foc-safety'), false);
  assert.equal(loaded.execution.assignments['foc-lifecycle'], 'cm7');
  assert.equal(loaded.build.moduleOptimizations['foc-lifecycle'], 'O2');
  assert.equal(Object.keys(loaded.provenance).some(key => key.startsWith('foc-safety.')), false);
  assert.equal(loaded.provenance['foc-lifecycle.maxCurrentA'], 'example');
  assert.equal(getDerived(loaded).fastHz, 20000);
  const issues = validateProject(loaded);
  assert.equal(issues.some(issue => /missing-foc-current-(kpD|kiD|kpQ|kiQ)/.test(issue.id)), false);
  assert.ok(issues.some(issue => issue.moduleId === 'foc-current' && issue.paramKey === 'bandwidthHz'));
  assert.deepEqual(loaded.compatibility.focSafety[0].instance, previous.instances['foc-safety']);
});

test('合并冲突保留电流环原值，旧参数、核心和优化记录不会丢失', () => {
  const previous = previousProject();
  Object.assign(previous.instances['foc-lifecycle'].parameters, { referenceTimeoutMs: null, maxCurrentA: 6 });
  previous.provenance['foc-lifecycle.maxCurrentA'] = 'user';
  previous.build.moduleOptimizations = { 'foc-lifecycle': 'Og', 'foc-safety': 'O3' };
  previous.execution.assignments['foc-lifecycle'] = '';
  previous.execution.assignments['foc-safety'] = 'cm7';
  const loaded = parseProject(JSON.stringify(previous));
  assert.equal(loaded.instances['foc-lifecycle'].parameters.referenceTimeoutMs, null);
  assert.equal(loaded.instances['foc-lifecycle'].parameters.maxCurrentA, 6);
  assert.equal(loaded.provenance['foc-lifecycle.maxCurrentA'], 'user');
  assert.equal(loaded.build.moduleOptimizations['foc-lifecycle'], 'Og');
  assert.equal(loaded.execution.assignments['foc-lifecycle'], '');
  const record = loaded.compatibility.focSafety[0];
  assert.equal(record.instance.parameters.maxCurrentA, 8);
  assert.equal(record.optimization, 'O3'); assert.equal(record.core, 'cm7');
  for (const key of ['parameters.referenceTimeoutMs', 'parameters.maxCurrentA', 'optimization', 'core']) assert.ok(record.conflicts.includes(key));
  assert.ok(validateProject(loaded).some(issue => issue.id === 'safety-merge-review' && issue.level === 'warning'));
  assert.deepEqual(parseProject(serializeProject(loaded)), loaded);
});

test('旧保护结构字段合并、冲突重命名并重映射接口，原协议载荷布局保持不变', () => {
  const previous = previousProject(), design = previous.design;
  const structure = id => design.structures.find(item => item.id === id);
  const oldRefs = design.moduleContracts['foc-safety'], currentRefs = design.moduleContracts['foc-current'];
  const field = (id, name, type, meaning) => ({ ...createField(id), name, type, meaning });
  for (const role of ['input', 'output', 'state']) {
    structure(oldRefs[role]).fields.push(field('same-id', 'same_name', 'u32', `旧 ${role} 含义`));
    structure(currentRefs[role]).fields.push(field('same-id', 'same_name', 'f32', `当前 ${role} 含义`));
  }
  const appOut = structure(design.moduleContracts['app-motion'].output);
  appOut.fields.push(field('app-output', 'command', 'u32', '应用给定'));
  const appIn = structure(design.moduleContracts['app-safety'].input);
  appIn.fields.push(field('app-input', 'feedback', 'u32', '应用反馈'));
  design.layerInterfaces = [
    { ...createLayerInterface('into-protection'), name: '输入保护', fromModule: 'app-motion', toModule: 'foc-safety', sourceStructure: appOut.id, targetStructure: oldRefs.input, version: 'input-v1', notes: '输入原备注', rate: 'control', handoff: 'snapshot', fieldMap: [{ id: 'input-map', sourceField: 'app-output', targetField: 'same-id' }] },
    { ...createLayerInterface('out-of-protection'), name: '保护输出', fromModule: 'foc-safety', toModule: 'app-safety', sourceStructure: oldRefs.output, targetStructure: appIn.id, version: 'output-v1', notes: '输出原备注', rate: 'control', handoff: 'snapshot', fieldMap: [{ id: 'output-map', sourceField: 'same-id', targetField: 'app-input' }] },
  ];
  design.protocol.messages.push({ ...createMessage('old-output-wire'), name: '旧保护反馈消息', opcode: 0x5678, payload: oldRefs.output, description: '旧报文不改变字段顺序' });
  const originalRoles = Object.fromEntries(Object.entries(oldRefs).map(([role, id]) => [role, structuredClone(structure(id))]));
  const loaded = parseProject(JSON.stringify(previous)), migrated = loaded.design;
  const saved = id => migrated.structures.find(item => item.id === id);
  for (const role of ['input', 'output', 'state']) {
    assert.deepEqual(saved(oldRefs[role]), { ...originalRoles[role], owner: 'foc-current' });
    const fields = saved(currentRefs[role]).fields;
    assert.equal(fields.length, structure(currentRefs[role]).fields.length + 1);
    assert.equal(fields.find(item => item.id === 'same-id').type, 'f32');
    const copied = fields.find(item => item.id === 'same-id-protection');
    assert.equal(copied.type, 'u32'); assert.equal(copied.name, 'same_name_protection');
    assert.equal(copied.meaning, `旧 ${role} 含义`);
  }
  const incoming = migrated.layerInterfaces[0], outgoing = migrated.layerInterfaces[1];
  assert.equal(incoming.toModule, 'foc-current'); assert.equal(incoming.targetStructure, currentRefs.input);
  assert.equal(incoming.fieldMap[0].targetField, 'same-id-protection'); assert.equal(incoming.notes, '输入原备注');
  assert.equal(outgoing.fromModule, 'foc-current'); assert.equal(outgoing.sourceStructure, currentRefs.output);
  assert.equal(outgoing.fieldMap[0].sourceField, 'same-id-protection'); assert.equal(outgoing.notes, '输出原备注');
  assert.equal(migrated.protocol.messages.find(message => message.id === 'old-output-wire').payload, oldRefs.output);
  assert.equal(migrated.faults.find(fault => fault.id === 'feedback-invalid').source, 'foc-current');
  assert.equal(Object.hasOwn(migrated.moduleContracts, 'foc-safety'), false);
  assert.equal(validateModuleContracts(loaded).some(issue => issue.level === 'error' && issue.designPage === 'interfaces'), false);
  assert.deepEqual(parseProject(serializeProject(loaded)), loaded);
});

test('旧保护状态即使保留兼容结构也不能成为共享结构、层间端点或通信载荷', () => {
  const previous = previousProject(), stateId = previous.design.moduleContracts['foc-safety'].state;
  const loaded = parseProject(JSON.stringify(previous));
  assert.ok(loaded.design.privateStructures.includes(stateId));
  assert.deepEqual(getModuleContractRole(loaded.design, stateId), { moduleId: 'foc-current', role: 'state', compatibility: true });
  loaded.design.structures.find(structure => structure.id === stateId).consumers.push('app-comms');
  loaded.design.protocol.messages.push({ ...createMessage('forbidden-state'), payload: stateId });
  loaded.design.layerInterfaces.push({ ...createLayerInterface('bad-state'), fromModule: 'foc-current', toModule: 'app-motion', sourceStructure: stateId, targetStructure: loaded.design.moduleContracts['app-motion'].input });
  const issues = validateModuleContracts(loaded);
  assert.ok(issues.some(issue => issue.id.startsWith('contract-private-') && issue.id.endsWith('-exposed')));
  assert.ok(issues.some(issue => issue.id.endsWith('-source-state')));
  assert.ok(issues.some(issue => issue.id.includes('-message-') && issue.id.endsWith('-state')));
});

test('历史算法快照直接应用时也迁移旧保护参数，保留 PI 与版本备注', () => {
  let project = createExampleProject();
  project = saveLayerVersion(project, { layer: 'foc', version: 'legacy-protection', notes: '旧层备注' });
  const snapshot = project.layerVersions.releases[0].snapshot;
  snapshot.instances['foc-current'].parameters.kpD = 0.3;
  snapshot.instances['foc-safety'] = { enabled: true, runtimeEnabled: true, parameters: { referenceTimeoutMs: 11, maxCurrentA: 17 } };
  for (const key of ['referenceTimeoutMs', 'maxCurrentA', 'bandwidthHz']) delete snapshot.instances['foc-current'].parameters[key];
  snapshot.provenance['foc-safety.maxCurrentA'] = 'user'; delete snapshot.provenance['foc-current.maxCurrentA'];
  for (const key of ['referenceTimeoutMs', 'maxCurrentA']) {
    delete snapshot.instances['foc-lifecycle'].parameters[key];
    delete snapshot.provenance[`foc-lifecycle.${key}`];
  }
  const before = structuredClone(project);
  const restored = applyLayerVersion(project, 'foc');
  assert.equal(restored.instances['foc-lifecycle'].parameters.maxCurrentA, 17);
  assert.equal(restored.instances['foc-lifecycle'].parameters.referenceTimeoutMs, 11);
  assert.equal(restored.instances['foc-current'].parameters.bandwidthHz, null);
  assert.equal(restored.instances['foc-current'].parameters.kpD, 0.3);
  assert.equal(restored.provenance['foc-lifecycle.maxCurrentA'], 'user');
  assert.equal(Object.hasOwn(restored.instances, 'foc-safety'), false);
  assert.equal(restored.layerVersions.releases[0].notes, '旧层备注');
  assert.equal(layerMatchesRelease(restored, 'foc'), true);
  assert.deepEqual(project, before);
});

test('旧保护未知参数和非法兼容记录不会在删除旧实例时被静默吞掉', () => {
  const unknown = previousProject(); unknown.instances['foc-safety'].parameters.unknown = 1;
  assert.throws(() => parseProject(JSON.stringify(unknown)), /未知字段/);
  const invalid = previousProject(); invalid.compatibility = { focSafety: [{ conflicts: ['unknown'], provenance: {} }] };
  assert.throws(() => parseProject(JSON.stringify(invalid)), /conflicts/);
});

test('旧模块名 hw-sensors 的七个数据面载入时折叠为 hw-drivers，不透明引用保持原值', () => {
  let project = createExampleProject();
  project.catalog.actuators.push(createActuator('执行器甲'));
  project.catalog.drivers.push(createDriver('驱动器甲'));
  const assembly = createJointModule(project, { actuatorId: project.catalog.actuators[0].id, driverId: project.catalog.drivers[0].id });
  project.catalog.assemblies.push(assembly); project.catalog.activeAssemblyId = assembly.id;
  project.execution.assignments['hw-drivers'] = 'cm7';
  project.design.faults.find(fault => fault.id === 'feedback-invalid').source = 'hw-drivers';
  project.design.structures.find(structure => structure.id === 'sample-frame').consumers.push('hw-drivers');
  project = saveLayerVersion(project, { layer: 'hardware', version: 'driver-rename/β' });
  const draft = createPerformanceDraft(project, assembly.id);
  draft.measuredAt = '2026-11-15'; draft.samples = [{ currentA: 1, torqueNm: 2, series: '甲' }];
  project = savePerformanceRecord(project, draft);
  const structureRefs = { ...project.design.moduleContracts['hw-drivers'] };
  const swap = object => { if (Object.hasOwn(object, 'hw-drivers')) { object['hw-sensors'] = object['hw-drivers']; delete object['hw-drivers']; } };
  const swapProvenance = provenance => { for (const key of Object.keys(provenance)) if (key.startsWith('hw-drivers.')) { provenance[`hw-sensors.${key.slice(11)}`] = provenance[key]; delete provenance[key]; } };
  swap(project.instances); swap(project.execution.assignments); swapProvenance(project.provenance);
  for (const driver of project.catalog.drivers) swap(driver.hardware);
  swap(project.design.moduleContracts);
  for (const structure of project.design.structures) {
    if (structure.owner === 'hw-drivers') structure.owner = 'hw-sensors';
    structure.consumers = structure.consumers.map(id => id === 'hw-drivers' ? 'hw-sensors' : id);
  }
  for (const item of project.design.layerInterfaces) { if (item.fromModule === 'hw-drivers') item.fromModule = 'hw-sensors'; if (item.toModule === 'hw-drivers') item.toModule = 'hw-sensors'; }
  for (const fault of project.design.faults) if (fault.source === 'hw-drivers') fault.source = 'hw-sensors';
  const release = project.layerVersions.releases[0];
  swap(release.snapshot.instances); swapProvenance(release.snapshot.provenance);
  const record = project.performance.records[0];
  swap(record.snapshot.driver.hardware);
  for (const layer of Object.values(record.snapshot.layers)) swap(layer.configuration);
  const loaded = parseProject(JSON.stringify(project));
  assert.equal(Object.hasOwn(loaded.instances, 'hw-sensors'), false);
  assert.equal(loaded.instances['hw-drivers'].parameters.encoderCapability, 'present');
  assert.equal(loaded.execution.assignments['hw-drivers'], 'cm7');
  assert.equal(Object.keys(loaded.provenance).some(key => key.startsWith('hw-sensors.')), false);
  assert.equal(loaded.provenance['hw-drivers.encoderBits'], 'example');
  assert.equal(Object.hasOwn(loaded.catalog.drivers[0].hardware, 'hw-drivers'), true);
  assert.deepEqual(loaded.design.moduleContracts['hw-drivers'], structureRefs);
  assert.equal(loaded.design.structures.some(structure => structure.owner === 'hw-sensors'), false);
  assert.ok(loaded.design.structures.find(structure => structure.id === 'sample-frame').consumers.includes('hw-drivers'));
  assert.equal(loaded.design.layerInterfaces.find(item => item.id === 'link-encoders').fromModule, 'hw-drivers');
  assert.equal(loaded.design.faults.find(fault => fault.id === 'feedback-invalid').source, 'hw-drivers');
  const restored = loaded.layerVersions.releases[0].snapshot;
  assert.equal(Object.hasOwn(restored.instances, 'hw-drivers'), true);
  assert.equal(Object.keys(restored.provenance).some(key => key.startsWith('hw-sensors.')), false);
  const saved = loaded.performance.records[0].snapshot;
  assert.equal(Object.hasOwn(saved.driver.hardware, 'hw-drivers'), true);
  assert.equal(Object.hasOwn(saved.layers.hardware.configuration, 'hw-drivers'), true);
  assert.deepEqual(parseProject(serializeProject(loaded)), loaded);
});
