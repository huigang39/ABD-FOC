import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { getModuleContract } from '../web/src/core/module-contracts.mjs';
import { saveLayerVersion, applyLayerVersion, layerMatchesRelease } from '../web/src/features/configuration/versions.mjs';
import { createActuator, createDriver, createJointModule } from '../web/src/features/equipment/model.mjs';
import { createPerformanceDraft, savePerformanceRecord, checkPerformanceRecordShape, getPerformanceHistory } from '../web/src/features/performance/model.mjs';

const filterId = 'foc-filter';
const disabledFilter = { enabled: false, runtimeEnabled: false, parameters: { children: [] } };
const electricalFields = new Set(['electrical_velocity','electrical_speed_valid','electrical_speed_time_us','electrical_speed_source_id']);
function removeFilter(project) {
  delete project.instances[filterId];
  delete project.execution.assignments[filterId];
  const structures = new Set(Object.values(project.design.moduleContracts[filterId]));
  delete project.design.moduleContracts[filterId];
  project.design.structures = project.design.structures.filter(structure => !structures.has(structure.id));
  return project;
}
function measuredProject() {
  const project = createProject();
  project.catalog.actuators.push(createActuator('测试执行器'));
  project.catalog.drivers.push(createDriver('测试驱动器'));
  const assembly = createJointModule(project, { actuatorId: project.catalog.actuators[0].id, driverId: project.catalog.drivers[0].id });
  project.catalog.assemblies.push(assembly);
  project.catalog.activeAssemblyId = assembly.id;
  const draft = createPerformanceDraft(project, assembly.id);
  draft.measuredAt = '2026-11-17T12:00:00+08:00';
  draft.firmwareId = 'measured-original';
  draft.samples = [{ currentA: 1, torqueNm: 2, series: 'test' }];
  return savePerformanceRecord(project, draft);
}

test('filter module defaults are disabled and declare scalar signals without inventing private state ABI', () => {
  const module = MODULES.find(module => module.id === filterId), project = createProject();
  assert.equal(module.title, '滤波器');
  assert.equal(module.order, 4);
  assert.equal(module.executionDomain, 'fast');
  assert.deepEqual(module.dependencies, []);
  assert.equal(module.required, false);
  assert.equal(module.runtimeSwitchable, true);
  assert.deepEqual(module.params.map(field => field.key), ['children']);
  assert.deepEqual(project.instances[filterId], disabledFilter);
  assert.deepEqual(module.contracts.input.fields.map(field => field.name), ['dt','enable','sample_time_us','valid']);
  assert.deepEqual(module.contracts.output.fields.map(field => field.name), ['motor_velocity','output_velocity','bus_voltage','torque','phase_current_u','phase_current_v','phase_current_w']);
  assert(module.contracts.output.fields.every(field => field.type === 'f32' && field.count === 1));
  assert.deepEqual(module.contracts.state.fields, []);
});

test('old schema 2 imports add a disabled filter, empty execution assignment and independent contracts', () => {
  const previous = removeFilter(createProject()), before = structuredClone(previous);
  const loaded = parseProject(JSON.stringify(previous));
  assert.deepEqual(loaded.instances[filterId], disabledFilter);
  assert.equal(loaded.execution.assignments[filterId], '');
  for (const role of ['input','output','state']) {
    const contract = getModuleContract(loaded.design, filterId, role);
    assert.equal(contract.owner, filterId);
    assert.deepEqual(contract.fields, MODULES.find(module => module.id === filterId).contracts[role].fields);
  }
  assert.deepEqual(previous, before);
  assert.deepEqual(parseProject(serializeProject(loaded)).instances[filterId], disabledFilter);
  loaded.instances[filterId].enabled = true;
  loaded.execution.assignments[filterId] = 'cm7';
  const explicit = parseProject(serializeProject(loaded));
  assert.equal(explicit.instances[filterId].enabled, true);
  assert.equal(explicit.execution.assignments[filterId], 'cm7');
  previous.instances[filterId] = null;
  assert.throws(() => parseProject(JSON.stringify(previous)), /必须是对象/);
});

test('schema 1 import also adds the filter disabled without adding runtime fields before legacy validation', () => {
  const source = removeFilter(createProject());
  const old = Object.fromEntries(['schemaVersion','id','name','revision','updatedAt','target','instances','provenance'].map(key => [key, source[key]]));
  old.schemaVersion = 1;
  for (const instance of Object.values(old.instances)) delete instance.runtimeEnabled;
  assert.deepEqual(parseProject(JSON.stringify(old)).instances[filterId], disabledFilter);
});

test('historical algorithm snapshots restore a missing filter disabled instead of inheriting current configuration', () => {
  let project = saveLayerVersion(createProject(), { layer: 'foc', version: 'before-filter' });
  const snapshot = project.layerVersions.releases[0].snapshot;
  delete snapshot.instances[filterId];
  project.instances[filterId].enabled = true;
  project.instances[filterId].runtimeEnabled = true;
  const before = structuredClone(project);
  const applied = applyLayerVersion(project, 'foc');
  assert.deepEqual(applied.instances[filterId], disabledFilter);
  assert.equal(layerMatchesRelease(applied, 'foc'), true);
  assert.deepEqual(project, before);
  const imported = parseProject(JSON.stringify(project));
  assert.deepEqual(imported.layerVersions.releases[0].snapshot.instances[filterId], disabledFilter);
  snapshot.instances[filterId] = null;
  assert.throws(() => applyLayerVersion(project, 'foc'), /必须是对象/);
});

test('old performance snapshots remain valid and comparable without rewriting measured history during reads', () => {
  const project = measuredProject(), record = project.performance.records[0];
  delete record.snapshot.layers.foc.configuration[filterId];
  const before = structuredClone(record);
  assert.doesNotThrow(() => checkPerformanceRecordShape(record));
  assert.equal(getPerformanceHistory(project, record).historical, false);
  assert.deepEqual(record, before);
  const loaded = parseProject(JSON.stringify(project));
  assert.deepEqual(loaded.performance.records[0].snapshot.layers.foc.configuration[filterId], disabledFilter);
  assert.deepEqual(loaded.performance.records[0].samples, record.samples);
  record.snapshot.layers.foc.configuration[filterId] = null;
  assert.throws(() => checkPerformanceRecordShape(record), /必须是对象/);
});

test('former default observer outputs gain independent electrical-speed metadata without changing the six legacy slots', () => {
  const project = createProject(), output = getModuleContract(project.design, 'foc-observer', 'output');
  output.fields = output.fields.filter(field => !electricalFields.has(field.name));
  output.description = '保留历史备注';
  const oldFields = structuredClone(output.fields);
  const loaded = parseProject(JSON.stringify(project)), migrated = getModuleContract(loaded.design, 'foc-observer', 'output');
  assert.deepEqual(migrated.fields.slice(0, oldFields.length), oldFields);
  assert.deepEqual(migrated.fields.slice(oldFields.length).map(field => field.name), [...electricalFields]);
  assert.equal(migrated.description, output.description);
  for (const name of ['sample_time_us','source_id']) assert.equal(migrated.fields.find(field => field.name === name).count, 6);
  assert.deepEqual(getModuleContract(parseProject(serializeProject(loaded)).design, 'foc-observer', 'output'), migrated);
  output.fields[0].meaning = '用户定义过的布局';
  assert.deepEqual(getModuleContract(parseProject(JSON.stringify(project)).design, 'foc-observer', 'output').fields, output.fields);
});
