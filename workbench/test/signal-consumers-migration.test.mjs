import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { CONSUMER_SIGNALS } from '../web/src/modules/algorithm/consumers.mjs';
import { saveLayerVersion, applyLayerVersion, layerMatchesRelease } from '../web/src/features/configuration/versions.mjs';
import { createActuator, createDriver, createJointModule } from '../web/src/features/equipment/model.mjs';
import { createPerformanceDraft, savePerformanceRecord, checkPerformanceRecordShape, getPerformanceHistory } from '../web/src/features/performance/model.mjs';
const keys = CONSUMER_SIGNALS.map(spec => spec.paramKey);
const params = instances => instances['app-motion'].parameters;
const remove = instances => { for (const key of keys) delete params(instances)[key]; };
const defaults = instances => { for (const key of keys) assert.equal(params(instances)[key], 'default'); };

test('older project schemas add default consumers and preserve explicit references and empty legacy defaults', () => {
  const project = createProject(); remove(project.instances);
  defaults(parseProject(JSON.stringify(project)).instances);
  const old = Object.fromEntries(['schemaVersion','id','name','revision','updatedAt','target','instances','provenance'].map(key => [key, structuredClone(project[key])]));
  old.schemaVersion = 1; for (const instance of Object.values(old.instances)) delete instance.runtimeEnabled;
  defaults(parseProject(JSON.stringify(old)).instances);
  params(project.instances).positionFeedbackSignal = '';
  params(project.instances).speedFeedbackSignal = 'instance:removed:speed';
  const loaded = parseProject(serializeProject(project));
  assert.equal(params(loaded.instances).positionFeedbackSignal, '');
  assert.equal(params(loaded.instances).speedFeedbackSignal, 'instance:removed:speed');
  params(project.instances).torqueFeedbackSignal = 7;
  assert.throws(() => parseProject(JSON.stringify(project)), /必须是文本/);
});

test('old application layer releases restore default consumers instead of inheriting current selections', () => {
  let project = saveLayerVersion(createProject(), { layer: 'app', version: 'original' });
  remove(project.layerVersions.releases[0].snapshot.instances);
  params(project.instances).speedFeedbackSignal = 'feedback.speed';
  const before = structuredClone(project), restored = applyLayerVersion(project, 'app');
  defaults(restored.instances);
  assert.equal(layerMatchesRelease(restored, 'app'), true);
  assert.deepEqual(project, before);
  defaults(parseProject(JSON.stringify(project)).layerVersions.releases[0].snapshot.instances);
});

test('performance history accepts absent consumer keys without mutation or claiming changed measurements', () => {
  let project = createProject();
  project.catalog.actuators.push(createActuator('执行器')); project.catalog.drivers.push(createDriver('驱动器'));
  const assembly = createJointModule(project, { actuatorId: project.catalog.actuators[0].id, driverId: project.catalog.drivers[0].id });
  project.catalog.assemblies.push(assembly); project.catalog.activeAssemblyId = assembly.id;
  const draft = createPerformanceDraft(project, assembly.id);
  draft.measuredAt = '2026-11-17'; draft.samples = [{ currentA: 1, torqueNm: 2, series: '' }];
  project = savePerformanceRecord(project, draft);
  const record = project.performance.records[0];
  remove(record.snapshot.layers.app.configuration);
  const before = structuredClone(record);
  assert.doesNotThrow(() => checkPerformanceRecordShape(record));
  assert.equal(getPerformanceHistory(project, record).historical, false);
  assert.deepEqual(record, before);
  defaults(parseProject(JSON.stringify(project)).performance.records[0].snapshot.layers.app.configuration);
  params(record.snapshot.layers.app.configuration).speedFeedbackSignal = 'feedback.speed';
  assert.equal(getPerformanceHistory(project, record).historical, true);
});
