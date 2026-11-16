import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { createActuator } from '../web/src/features/equipment/model.mjs';
import { getCurrentLoopDesign } from '../web/src/modules/algorithm/foc-current/design.mjs';
import { validateCia402 } from '../web/src/modules/application/app-state/cia402.mjs';
import { createNeo75hProject, applyNeo75hProfile, getNeo75hProfile, getNeo75hProjectVariant, getNeo75hModuleMap, neo75hParameterOwner, NEO75H_VARIANTS } from '../web/src/profiles/neo75h.mjs';

test('source values populate the selected actuator with correct SI conversions', () => {
  const project = createNeo75hProject();
  const { actuator, gains } = getCurrentLoopDesign(project);
  assert.equal(actuator.motor.polePairs, 10);
  assert.equal(Object.hasOwn(project.instances['foc-feedback'].parameters, 'polePairs'), false);
  assert.equal(actuator.motor.resistanceOhm, 0.15);
  assert.equal(actuator.motor.inductanceDH, 175.5e-6);
  assert.equal(actuator.motor.inductanceQH, 189e-6);
  assert.equal(actuator.reducer.ratio, 51);
  assert.equal(actuator.reducer.maxOutputTorqueNm, 50);
  assert.equal(actuator.motor.maxSpeedRpm, 1000 * 60 / (2 * Math.PI));
  assert.equal(project.instances['foc-current'].parameters.bandwidthHz, 6283.1855 / (2 * Math.PI));
  assert(Math.abs(gains.kpD - 6283.1855 * 175.5e-6) < 1e-12);
  assert.equal(project.instances['foc-compensation'].enabled, true);
  assert.equal(project.instances['foc-compensation'].runtimeEnabled, false);
});

test('torque variants do not change the motor or encoder identity', () => {
  for (const [variant, bitrate] of [['KW', 256000], ['LD', 256000], ['SMH', 2500000], ['XH', null]]) {
    const project = createNeo75hProject(variant), sensors = project.instances['hw-sensors'].parameters;
    assert.equal(getNeo75hProjectVariant(project), variant);
    assert.equal(sensors.torqueSensorModel, variant);
    assert.equal(sensors.torqueSensorBitrate, bitrate);
    assert.equal(sensors.motorEncoderModel, 'GW 外圈');
    assert.equal(sensors.outputEncoderModel, 'GW 内圈');
    assert.equal(sensors.motorEncoderBitrate, 6250000);
  }
});

test('unknown ratings are not filled from protection limits or unrelated values', () => {
  const project = createNeo75hProject('XH');
  const driver = project.catalog.drivers[0], actuator = project.catalog.actuators[0];
  assert.equal(driver.busVoltageV, null);
  assert.equal(driver.maxCurrentA, null);
  assert.equal(driver.adcClockHz, null);
  assert.equal(actuator.motor.torqueConstantNmA, null);
  assert.equal(actuator.reducer.efficiency, null);
  assert.equal(project.instances['hw-sensors'].parameters.torqueSensorRangeNm, null);
  assert(getNeo75hProfile('XH').unknowns.some(item => item.key === 'torqueSensorBitrate'));
  assert.equal(getNeo75hProfile('XH').sourceOverrides['hw.tor_sensor.sensor.baudrate'], null);
});

test('EtherCAT is on M4 while the drive state machine and control remain on M7', () => {
  const project = createNeo75hProject();
  assert.equal(project.target.mcu, 'STM32H745IIK6');
  assert.equal(project.execution.assignments['app-comms'], 'cm4');
  for (const id of ['app-runtime', 'app-motion', 'app-safety', 'foc-current', 'hw-board']) assert.equal(project.execution.assignments[id], 'cm7');
  assert.deepEqual(project.execution.ipc, { transport: 'shared_memory', notification: 'polling', cachePolicy: 'noncacheable', sharedAddress: 0x38000000, sharedSizeKiB: 64 });
  assert.equal(project.operation.mode, 'disabled');
  assert.deepEqual(project.commissioning.checks, {});
});

test('three M7 layers and three storage classes have separate erase sectors', () => {
  const project = createNeo75hProject();
  assert.equal(project.memory.layout.banks.reduce((sum, bank) => sum + bank.sizeKiB, 0), 2048);
  for (const [id, bank, sector] of [['hardware',1,0],['foc',1,1],['app',1,2],['motion-calibration',2,5],['parameters',2,6],['fault-records',2,7]]) {
    assert.deepEqual(project.memory.placements[id].sectorIds, [`neo-bank-${bank}-sector-${sector}`]);
  }
  assert(project.memory.layout.banks[1].sectors.slice(0,4).every(sector => sector.reserved));
  assert.equal(getNeo75hProfile().images[0].sizeKiB, 384);
  assert.equal(getNeo75hProfile().images[1].address, 0x08100000);
  assert.deepEqual(getNeo75hProfile().storage, { calibration: 0x081A0000, parameters: 0x081C0000, logs: 0x081E0000, sectorKiB: 128, sharedAddress: 0x38000000, sharedSizeKiB: 64 });
});

test('explicit apply returns a new project and preserves shelf assets and project identity', () => {
  const original = createProject();
  original.catalog.actuators.push(createActuator('已有执行器'));
  const saved = structuredClone(original), applied = applyNeo75hProfile(original, 'LD');
  assert.deepEqual(original, saved);
  assert.equal(applied.id, original.id);
  assert.equal(applied.name, original.name);
  assert.equal(applied.catalog.actuators[0].name, '已有执行器');
  assert.equal(applied.catalog.actuators.length, 2);
  assert.equal(applied.instances['app-runtime'].parameters.hardwareProfile, 'NEO_75_H_GW_LD');
});

test('source records are detached, cover 780 values, and reject unknown variants', () => {
  const source = getNeo75hProfile('kw');
  assert.equal(Object.keys(source.sourceParameters).length, 780);
  assert.match(source.sourceSha256, /^[a-f0-9]{64}$/);
  source.sourceParameters['mech.motor.npp'] = '1';
  assert.equal(getNeo75hProfile('KW').sourceParameters['mech.motor.npp'], '10');
  assert.throws(() => createNeo75hProject('unknown'), /未知/);
});

test('each source field has exactly one module owner and empty groups bind real resources', () => {
  const groups = getNeo75hModuleMap(), source = getNeo75hProfile();
  const paths = groups.flatMap(group => group.parameterPaths);
  assert.equal(groups.length, 17);
  assert.equal(paths.length, 780);
  assert.equal(new Set(paths).size, 780);
  assert.deepEqual(paths.sort(), Object.keys(source.sourceParameters).sort());
  assert.equal(neo75hParameterOwner('sw.ctrl.friction.enable'), 'foc-compensation');
  assert.equal(neo75hParameterOwner('sw.ctrl.cur_loop_bandwidth'), 'foc-current');
  assert.equal(neo75hParameterOwner('unknown'), null);
  assert(groups.find(group => group.moduleId === 'foc-lifecycle').resourceBinding.entryPoints.includes('control_step'));
  assert(groups.find(group => group.moduleId === 'hw-platform').resourceBinding.entryPoints.includes('core_step'));
});

test('all presets round trip without configuration errors and keep unverified items pending', () => {
  for (const variant of NEO75H_VARIANTS) {
    const project = parseProject(serializeProject(createNeo75hProject(variant)));
    assert.deepEqual(validateProject(project).filter(issue => issue.level === 'error'), []);
    assert.deepEqual(validateCia402(project).filter(issue => issue.level === 'error'), []);
    assert(validateProject(project).some(issue => issue.level === 'pending'));
  }
});
