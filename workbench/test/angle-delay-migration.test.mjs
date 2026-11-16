import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, migrateAngleDelayParameters } from '../web/src/core/model.mjs';
import { createAlgorithmChild } from '../web/src/modules/algorithm/children.mjs';
import { saveLayerVersion, applyLayerVersion } from '../web/src/features/configuration/versions.mjs';
import { createActuator, createDriver, createJointModule } from '../web/src/features/equipment/model.mjs';
import { createPerformanceDraft, savePerformanceRecord, checkPerformanceRecordShape } from '../web/src/features/performance/model.mjs';

const delay = instances => instances['foc-compensation'].parameters.children.find(child => child.type === 'angle_delay');
function legacyProject(delayUs = 75) {
  const project = createProject(), child = createAlgorithmChild('foc-compensation', 'angle_delay');
  child.parameters = { delayUs };
  project.instances['foc-compensation'].parameters.children = [child];
  Object.assign(project.instances['hw-board'].parameters, { pwmHz: 20000, currentLoopDivider: 2 });
  return project;
}

test('old angle-delay microseconds convert using only the saved current-loop period', () => {
  const previous = legacyProject(), before = structuredClone(previous);
  const loaded = parseProject(JSON.stringify(previous));
  assert.deepEqual(delay(loaded.instances).parameters, { delayUs: null, delayCycles: 0.75 });
  assert.equal(delay(loaded.instances).compiled, delay(previous.instances).compiled);
  assert.equal(delay(loaded.instances).enabled, delay(previous.instances).enabled);
  assert.deepEqual(previous, before);
  assert.deepEqual(parseProject(serializeProject(loaded)).instances, loaded.instances);
  assert.equal(migrateAngleDelayParameters(loaded.instances), false);
});

test('unknown timing preserves the old delay until a later explicit timing configuration permits conversion', () => {
  const previous = legacyProject();
  previous.instances['hw-board'].parameters.pwmHz = null;
  const loaded = parseProject(JSON.stringify(previous));
  assert.deepEqual(delay(loaded.instances).parameters, { delayUs: 75, delayCycles: null });
  loaded.instances['hw-board'].parameters.pwmHz = 40000;
  assert.equal(migrateAngleDelayParameters(loaded.instances), true);
  assert.deepEqual(delay(loaded.instances).parameters, { delayUs: null, delayCycles: 1.5 });
  for (const value of [0, null, 1.5]) {
    const project = legacyProject();
    project.instances['hw-board'].parameters.currentLoopDivider = value;
    migrateAngleDelayParameters(project.instances);
    assert.deepEqual(delay(project.instances).parameters, { delayUs: 75, delayCycles: null });
  }
});

test('saved cycle values are not replaced or silently repaired by legacy delay fields', () => {
  for (const cycles of [0, 1.25, -1, 'invalid']) {
    const project = legacyProject();
    delay(project.instances).parameters.delayCycles = cycles;
    const before = structuredClone(project.instances);
    assert.equal(migrateAngleDelayParameters(project.instances), false);
    assert.deepEqual(project.instances, before);
  }
});

test('FOC-only release snapshots retain legacy microseconds without borrowing the current hardware timing', () => {
  let project = legacyProject();
  delay(project.instances).parameters = { delayCycles: 1, delayUs: null };
  project = saveLayerVersion(project, { layer: 'foc', version: 'old-delay' });
  delay(project.layerVersions.releases[0].snapshot.instances).parameters = { delayUs: 75 };
  const before = structuredClone(project.layerVersions.releases[0].snapshot);
  const applied = applyLayerVersion(project, 'foc');
  assert.deepEqual(delay(applied.instances).parameters, { delayUs: 75, delayCycles: null });
  assert.deepEqual(project.layerVersions.releases[0].snapshot, before);
  const loaded = parseProject(JSON.stringify(project));
  assert.deepEqual(delay(loaded.layerVersions.releases[0].snapshot.instances).parameters, { delayUs: 75, delayCycles: null });
});

test('historical performance delay conversion uses its own captured hardware frequency and leaves measured samples unchanged', () => {
  const project = legacyProject();
  delay(project.instances).parameters = { delayCycles: 0.75, delayUs: null };
  project.catalog.actuators.push(createActuator('执行器'));
  project.catalog.drivers.push(createDriver('驱动器'));
  const assembly = createJointModule(project, { actuatorId: project.catalog.actuators[0].id, driverId: project.catalog.drivers[0].id });
  project.catalog.assemblies.push(assembly);
  const draft = createPerformanceDraft(project, assembly.id);
  draft.measuredAt = '2026-11-17T12:00:00+08:00'; draft.firmwareId = 'historical';
  draft.samples = [{ currentA: 1, torqueNm: 2, series: '' }];
  const saved = savePerformanceRecord(project, draft), record = saved.performance.records[0];
  delay(record.snapshot.layers.foc.configuration).parameters = { delayUs: 75 };
  saved.instances['hw-board'].parameters.pwmHz = 40000;
  const before = structuredClone(record);
  assert.doesNotThrow(() => checkPerformanceRecordShape(record));
  assert.deepEqual(record, before);
  const loaded = parseProject(JSON.stringify(saved));
  assert.deepEqual(delay(loaded.performance.records[0].snapshot.layers.foc.configuration).parameters, { delayUs: null, delayCycles: 0.75 });
  assert.deepEqual(loaded.performance.records[0].samples, draft.samples);
  record.snapshot.layers.hardware.configuration['hw-board'].parameters.pwmHz = null;
  const unknown = parseProject(JSON.stringify(saved));
  assert.deepEqual(delay(unknown.performance.records[0].snapshot.layers.foc.configuration).parameters, { delayUs: 75, delayCycles: null });
});
