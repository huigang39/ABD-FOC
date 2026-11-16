import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { createDriver, getActiveDriver, syncSelectedDriverTarget } from '../web/src/features/equipment/model.mjs';

const params = project => project.instances['hw-platform'].parameters;

test('selected driver MCU updates the target without replacing project peripherals or sensor settings', () => {
  const project = createNeo75hProject(), driver = getActiveDriver(project);
  const peripheral = project.instances['hw-board'].parameters;
  peripheral.pwmHz = 25000;
  project.instances['hw-drivers'].parameters.motorEncoderTimeoutUs = 1200;
  const beforePeripheral = structuredClone(peripheral);
  const beforeDrivers = structuredClone(project.instances['hw-drivers'].parameters);
  const beforeMemory = structuredClone(project.memory);
  const beforeShelf = structuredClone(driver.hardware);
  driver.mcu = 'STM32G474RET6';
  driver.vendor = 'unselected';
  driver.board = 'Rev.B';
  assert.equal(syncSelectedDriverTarget(project), true);
  assert.deepEqual(project.target, { vendor: 'st', mcu: 'STM32G474RET6', board: 'Rev.B' });
  assert.deepEqual(Object.keys(params(project).coreConfigs), ['cm4']);
  assert.equal(params(project).coreConfigs.cm4.clockHz, 150000000);
  assert.deepEqual(peripheral, beforePeripheral);
  assert.deepEqual(project.instances['hw-drivers'].parameters, beforeDrivers);
  assert.deepEqual(project.memory, beforeMemory);
  assert.deepEqual(driver.hardware, beforeShelf);
});

test('same MCU metadata changes preserve custom core clocks and repeated sync is a no-op', () => {
  const project = createNeo75hProject(), driver = getActiveDriver(project);
  Object.assign(params(project), { busClockHz: 160000000, timerClockHz: 160000000 });
  params(project).coreConfigs.cm7.clockHz = 320000000;
  params(project).coreConfigs.cm4.clockHz = 160000000;
  params(project).coreConfigs.cm4.floatAbi = 'soft';
  const before = structuredClone(project.instances);
  driver.board = 'custom version';
  assert.equal(syncSelectedDriverTarget(project), true);
  assert.deepEqual(project.instances, before);
  assert.equal(syncSelectedDriverTarget(project), false);
  assert.deepEqual(project.instances, before);
});

test('only an explicitly active driver or selected assembly may supply the target', () => {
  const project = createNeo75hProject(), driver = getActiveDriver(project);
  project.catalog.activeDriverId = '';
  driver.board = 'assembly-version';
  assert.equal(syncSelectedDriverTarget(project), true);
  assert.equal(project.target.board, 'assembly-version');
  project.catalog.activeAssemblyId = '';
  const before = structuredClone(project);
  assert.equal(syncSelectedDriverTarget(project), false);
  assert.deepEqual(project, before);
  project.catalog.activeDriverId = 'missing-driver';
  assert.equal(syncSelectedDriverTarget(project), false);
  assert.deepEqual(project.target, before.target);
});

test('editing an unselected shelf driver does not change the active project target', () => {
  const project = createNeo75hProject(), other = createDriver('Other');
  project.catalog.drivers.push(other);
  other.mcu = 'STM32G474RET6';
  other.board = 'unselected';
  const before = structuredClone(project);
  assert.equal(syncSelectedDriverTarget(project), false);
  assert.deepEqual(project, before);
});

test('unknown selected MCU clears stale core capabilities while a project without selection keeps its target', () => {
  const project = createNeo75hProject();
  Object.assign(getActiveDriver(project), { mcu: 'CUSTOM-MCU', vendor: 'other' });
  assert.equal(syncSelectedDriverTarget(project), true);
  assert.equal(project.target.vendor, 'other');
  assert.equal(params(project).architecture, 'unselected');
  assert.deepEqual(params(project).coreConfigs, {});
  const empty = createProject();
  empty.target = { vendor: 'other', mcu: 'LEGACY', board: '1.0' };
  assert.equal(syncSelectedDriverTarget(empty), false);
  assert.deepEqual(empty.target, { vendor: 'other', mcu: 'LEGACY', board: '1.0' });
});

test('loading a project repairs a stale selected-driver target and retains edited peripheral resources', () => {
  const project = createNeo75hProject();
  const resources = structuredClone(project.instances['hw-board'].parameters.resources);
  project.instances['hw-board'].parameters.pwmHz = 25000;
  project.target = { vendor: 'unselected', mcu: '', board: '' };
  const loaded = parseProject(serializeProject(project));
  assert.equal(loaded.target.mcu, getActiveDriver(loaded).mcu);
  assert.equal(loaded.target.vendor, 'st');
  assert.equal(loaded.target.board, getActiveDriver(loaded).board);
  assert.deepEqual(loaded.instances['hw-board'].parameters.resources, resources);
  assert.equal(loaded.instances['hw-board'].parameters.pwmHz, 25000);
  assert.deepEqual(Object.keys(params(loaded).coreConfigs), ['cm7', 'cm4']);
});

test('the maintained H745 family alias and IIK6 package do not reset each other’s configured clocks', () => {
  const project = createNeo75hProject(), driver = getActiveDriver(project);
  Object.assign(params(project), { busClockHz: 160000000, timerClockHz: 160000000 });
  params(project).coreConfigs.cm7.clockHz = 320000000;
  params(project).coreConfigs.cm4.clockHz = 160000000;
  const before = structuredClone(project.instances);
  driver.mcu = 'STM32H745';
  assert.equal(syncSelectedDriverTarget(project), true);
  assert.equal(project.target.mcu, 'STM32H745');
  assert.deepEqual(project.instances, before);
  driver.mcu = 'STM32H745IIK6';
  assert.equal(syncSelectedDriverTarget(project), true);
  assert.deepEqual(project.instances, before);
});
