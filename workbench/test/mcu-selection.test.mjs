import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { syncMcuArchitecture } from '../web/src/features/deployment/mcu.mjs';
import { applyDriver, captureDriverHardware, getDriverHardware } from '../web/src/features/equipment/model.mjs';
import { saveLayerVersion, applyLayerVersion } from '../web/src/features/configuration/versions.mjs';

const platform = project => project.instances['hw-platform'].parameters;
const hardware = project => ({ 'hw-platform': platform(project), 'hw-board': project.instances['hw-board'].parameters });

test('explicit MCU selection applies core and derived clock defaults without changing board declarations', () => {
  const project = createProject();
  const params = platform(project);
  Object.assign(params, { clockSource: 'external', oscillatorHz: 25000000, flashKiB: 768, eraseKiB: 16 });
  project.instances['hw-board'].parameters.pwmHz = 20000;
  project.target.mcu = 'STM32H745IIK6';
  syncMcuArchitecture(project.target, hardware(project), { applyDefaults: true });
  assert.equal(params.coreConfigs.cm7.clockHz, 400000000);
  assert.equal(params.coreConfigs.cm4.clockHz, 200000000);
  assert.equal(params.busClockHz, 200000000);
  assert.equal(params.timerClockHz, 200000000);
  assert.equal(params.coreConfigs.cm7.floatAbi, 'hard');
  assert.equal(params.coreConfigs.cm4.floatAbi, 'hard');
  assert.equal(params.clockSource, 'external');
  assert.equal(params.oscillatorHz, 25000000);
  assert.equal(params.flashKiB, 768);
  assert.equal(params.eraseKiB, 16);
  assert.equal(project.instances['hw-board'].parameters.pwmHz, 20000);
  assert.equal(project.target.vendor, 'st');
});

test('H745 and G474 selections replace a shared cm4 ID rather than carrying its previous clock or FPU choice', () => {
  const project = createNeo75hProject(), params = platform(project);
  params.coreConfigs.cm4.floatAbi = 'soft';
  params.coreConfigs.cm4.systemTickHz = 2000;
  const h745Core = params.coreConfigs.cm4;
  project.target.mcu = 'STM32G474RET6';
  syncMcuArchitecture(project.target, hardware(project), { applyDefaults: true });
  assert.deepEqual(Object.keys(params.coreConfigs), ['cm4']);
  assert.notEqual(params.coreConfigs.cm4, h745Core);
  assert.equal(params.coreConfigs.cm4.clockHz, 150000000);
  assert.equal(params.busClockHz, 150000000);
  assert.equal(params.timerClockHz, 150000000);
  assert.equal(params.coreConfigs.cm4.floatAbi, 'hard');
  assert.equal(h745Core.clockHz, 200000000);
  assert.equal(h745Core.floatAbi, 'soft');
  const g474Core = params.coreConfigs.cm4;
  project.target.mcu = 'STM32H745IIK6';
  syncMcuArchitecture(project.target, hardware(project), { applyDefaults: true });
  assert.deepEqual(Object.keys(params.coreConfigs), ['cm7', 'cm4']);
  assert.notEqual(params.coreConfigs.cm4, g474Core);
  assert.equal(params.coreConfigs.cm4.clockHz, 200000000);
  assert.equal(params.coreConfigs.cm7.clockHz, 400000000);
});

test('normalization and pruning preserve existing clocks and ABI, even when stale core IDs remain detectable', () => {
  const project = createNeo75hProject(), params = platform(project);
  Object.assign(params, { busClockHz: 160000000, timerClockHz: 160000000 });
  Object.assign(params.coreConfigs.cm7, { clockHz: 320000000, floatAbi: 'softfp' });
  Object.assign(params.coreConfigs.cm4, { clockHz: 160000000, floatAbi: 'soft', systemTickHz: 2000 });
  const before = structuredClone(params);
  project.target.vendor = 'other';
  syncMcuArchitecture(project.target, hardware(project));
  assert.equal(project.target.vendor, 'st');
  assert.deepEqual(params, before);
  params.coreConfigs.stale = structuredClone(params.coreConfigs.cm4);
  syncMcuArchitecture(project.target, hardware(project), { replaceCores: true });
  assert.deepEqual(params, before, 'cleaning stale cores must not reset configured clocks');
  project.target.mcu = 'STM32G474RET6';
  syncMcuArchitecture(project.target, hardware(project));
  assert.equal(params.coreConfigs.cm4.clockHz, 160000000, 'the caller must opt in to changing values');
  assert.equal(params.coreConfigs.cm4.floatAbi, 'soft');
  assert.ok(params.coreConfigs.cm7, 'normalization does not silently erase a stale imported core');
});

test('project import, driver capture/application and hardware version restore retain stored clock and ABI values', () => {
  let project = createNeo75hProject();
  const params = platform(project);
  Object.assign(params, { busClockHz: 160000000, timerClockHz: 160000000 });
  Object.assign(params.coreConfigs.cm7, { clockHz: 320000000, floatAbi: 'softfp' });
  Object.assign(params.coreConfigs.cm4, { clockHz: 160000000, floatAbi: 'soft', systemTickHz: 2000 });
  const expected = structuredClone(params);
  project = captureDriverHardware(project, project.catalog.activeDriverId);
  const loaded = parseProject(serializeProject(project));
  assert.deepEqual(platform(loaded), expected);
  assert.deepEqual(getDriverHardware(loaded.catalog.drivers[0])['hw-platform'], expected);
  assert.deepEqual(platform(applyDriver(loaded, loaded.catalog.activeDriverId)), expected);
  const saved = saveLayerVersion(loaded, { layer: 'hardware', version: 'custom-clock' });
  platform(saved).coreConfigs.cm4.clockHz = 200000000;
  assert.deepEqual(platform(applyLayerVersion(saved, 'hardware')), expected);
});

test('unknown explicit MCU selection clears previous core capabilities and derived clocks without guessing new ones', () => {
  const project = createNeo75hProject(), params = platform(project);
  const oscillator = params.oscillatorHz, source = params.clockSource;
  project.target.mcu = 'UNKNOWN-MCU';
  const info = syncMcuArchitecture(project.target, hardware(project), { applyDefaults: true });
  assert.equal(info, null);
  assert.equal(params.architecture, 'unselected');
  assert.deepEqual(params.coreConfigs, {});
  assert.equal(params.busClockHz, null);
  assert.equal(params.timerClockHz, null);
  assert.equal(params.oscillatorHz, oscillator, 'board oscillator declaration is not inferred from the MCU');
  assert.equal(params.clockSource, source);
  const empty = platform(createProject());
  assert.deepEqual(empty.coreConfigs, {});
  assert.equal(empty.busClockHz, null);
});
