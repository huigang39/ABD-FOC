import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { addAlgorithmChild } from '../web/src/modules/algorithm/children.mjs';
import { saveLayerVersion, applyLayerVersion } from '../web/src/features/configuration/versions.mjs';
import { runtimeConfiguration } from '../web/src/features/configuration/runtime-config.mjs';
import { inspectFirmwareSupport, generateFirmware } from '../native/firmware.mjs';
import { writeNewProject } from '../native/generator/project.mjs';
import { newModuleProject } from './support/new-project.mjs';

const dynamicType = 'load_torque_motor_speed_notch';
const filterChildren = project => project.instances['foc-filter'].parameters.children;

test('historical static torque notch survives project and layer round trips without becoming dynamic', () => {
  let project = createProject();
  const original = { id: 'load_torque_notch', type: 'load_torque_notch', name: '负载力矩陷波', compiled: true, enabled: true, routing: {}, parameters: { frequencyHz: 175, q: 3.5 } };
  Object.assign(project.instances['foc-filter'], { enabled: true, runtimeEnabled: true, parameters: { children: [structuredClone(original)] } });
  project = saveLayerVersion(project, { layer: 'foc', version: 'static-notch' });
  const loaded = parseProject(serializeProject(project));
  assert.deepEqual(filterChildren(loaded), [original]);
  assert.deepEqual(filterChildren({ instances: loaded.layerVersions.releases[0].snapshot.instances }), [original]);
  filterChildren(loaded)[0].parameters.frequencyHz = 250;
  const restored = applyLayerVersion(loaded, 'foc');
  assert.deepEqual(filterChildren(restored), [original]);
  assert(!filterChildren(restored).some(child => child.type === dynamicType));
  const runtime = runtimeConfiguration(restored);
  assert(!runtime.functions.some(item => item.functionId === dynamicType));
  assert.equal(runtime.functions.find(item => item.functionId === 'load_torque_notch').frequencyTracking, undefined);
  assert.equal(runtime.entries.find(entry => entry.childId === original.id && entry.key === 'frequencyHz').value, 175);
});

test('dynamic motor-speed notch is blocked by inspection and both generation entry points before writing files', async t => {
  const project = addAlgorithmChild(newModuleProject(), 'foc-filter', dynamicType);
  const child = filterChildren(project).find(child => child.type === dynamicType);
  for (const key of Object.keys(child.parameters)) child.parameters[key] = key === 'q' ? 2 : 1;
  const before = structuredClone(project), report = inspectFirmwareSupport(project);
  assert.equal(report.sourceReady, false);
  assert.equal(report.supported, false);
  assert(report.sourceIssues.some(issue => issue.moduleId === 'foc-filter' && issue.code === 'implementation'));
  const outputRoot = await mkdtemp(join(tmpdir(), 'abd-dynamic-notch-boundary-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await assert.rejects(generateFirmware({ project, outputRoot }), /滤波器/);
  await assert.rejects(writeNewProject(outputRoot, project), /滤波器.*尚未接入/);
  assert.deepEqual(await readdir(outputRoot), []);
  assert.deepEqual(project, before);
});

test('runtime export retains both fixed dynamic-notch inputs and all eight optional multipliers without inventing center frequencies', () => {
  const project = addAlgorithmChild(newModuleProject(), 'foc-filter', dynamicType);
  const child = filterChildren(project).find(child => child.type === dynamicType);
  Object.assign(child.parameters, { multiplier1: 1, multiplier3: 3.5, multiplier8: 12, q: 2.25 });
  const before = structuredClone(project), runtime = runtimeConfiguration(project);
  const definition = runtime.functions.find(item => item.functionId === dynamicType);
  assert.deepEqual(definition.inputs, [
    { key: 'source', reference: 'sensor.torque', quantity: 'sensor-torque', unit: 'N·m' },
    { key: 'motorSpeed', reference: 'motor_pll.speed', quantity: 'motor-speed', unit: 'rad/s' },
  ]);
  assert.equal(definition.frequencyTracking.maxStages, 8);
  assert.equal(definition.frequencyTracking.sharedQKey, 'q');
  assert.equal(definition.frequencyTracking.topology, 'series');
  const values = Object.fromEntries(runtime.entries.filter(entry => entry.childId === child.id && entry.kind === 'parameter').map(entry => [entry.key, entry.value]));
  assert.deepEqual(values, child.parameters);
  assert.deepEqual(Object.keys(values), ['multiplier1','multiplier2','multiplier3','multiplier4','multiplier5','multiplier6','multiplier7','multiplier8','q']);
  assert.equal(values.multiplier2, null);
  assert.equal(values.multiplier7, null);
  assert(!Object.hasOwn(values, 'frequencyHz'));
  assert.deepEqual(project, before);
  assert.deepEqual(filterChildren(parseProject(serializeProject(project))), filterChildren(project));
});
