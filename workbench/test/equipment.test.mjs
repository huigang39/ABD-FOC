import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createExampleProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { createCatalog, createActuator, createDriver, createAssembly, createJointModule, isAssemblyComplete, createBinding, checkCatalogShape, validateEquipment, applyAssembly, getAssemblySummary, getDriverHardware, captureDriverHardware, applyDriver, hardwareMatchesDriver } from '../web/src/features/equipment/model.mjs';

function fixture() {
  const project = createProject();
  const actuator = createActuator('执行器 A');
  Object.assign(actuator.motor, { polePairs: 7, ratedCurrentA: 4, maxCurrentA: 8, maxSpeedRpm: 6000, torqueConstantNmA: 0.1, resistanceOhm: 0.3 });
  Object.assign(actuator.reducer, { ratio: 10, efficiency: 0.8, maxOutputTorqueNm: 10 });
  const driver = createDriver('驱动器 A');
  Object.assign(driver, { vendor: 'st', mcu: 'STM32G474', board: 'PCB-A', busVoltageV: 24, maxCurrentA: 6, pwmHz: 20000, adcBits: 12, adcClockHz: 40000000, deadtimeNs: 300, flashKiB: 512, eraseKiB: 4, firmwareReserveKiB: 256 });
  const assembly = { ...createAssembly('组合 A'), actuatorId: actuator.id, driverId: driver.id };
  project.catalog = { ...createCatalog(), actuators: [actuator], drivers: [driver], assemblies: [assembly] };
  project.instances['hw-board'].parameters.currentLoopDivider = 9;
  driver.hardware['hw-board'].currentLoopDivider = 2;
  return { project, actuator, driver, assembly };
}

test('a joint module requires an existing actuator and an existing driver', () => {
  const { project, actuator, driver } = fixture();
  assert.equal(isAssemblyComplete(project.catalog, createAssembly()), false);
  assert.equal(isAssemblyComplete(project.catalog, { actuatorId: actuator.id, driverId: '' }), false);
  assert.equal(isAssemblyComplete(project.catalog, { actuatorId: '', driverId: driver.id }), false);
  assert.equal(isAssemblyComplete(project.catalog, null), false);
  assert.equal(isAssemblyComplete(undefined, { actuatorId: actuator.id, driverId: driver.id }), false);
  assert.throws(() => createJointModule(project), /执行器和驱动器/);
  assert.throws(() => createJointModule(project, { actuatorId: actuator.id }), /驱动器不存在/);
  assert.throws(() => createJointModule(project, { driverId: driver.id }), /执行器不存在/);
  assert.throws(() => createJointModule(project, { actuatorId: 'missing', driverId: driver.id }), /执行器不存在/);
  assert.throws(() => createJointModule(project, { actuatorId: actuator.id, driverId: 'missing' }), /驱动器不存在/);
});

test('joint module creation returns a complete pair with a name without changing the project', () => {
  const { project, actuator, driver } = fixture();
  const before = structuredClone(project);
  const options = { actuatorId: actuator.id, driverId: driver.id };
  const assembly = createJointModule(project, options);
  assert.equal(isAssemblyComplete(project.catalog, assembly), true);
  assert.equal(assembly.name, '执行器 A + 驱动器 A');
  assert.equal(assembly.actuatorId, actuator.id);
  assert.equal(assembly.driverId, driver.id);
  assert.match(assembly.id, /^assembly-/);
  assert.equal(createJointModule(project, { ...options, name: '  关节 A  ' }).name, '关节 A');
  assert.equal(createJointModule(project, { ...options, name: '  ' }).name, assembly.name);
  assert.notEqual(createJointModule(project, options).id, assembly.id);
  assert.deepEqual(project, before);
  assembly.name = '修改返回值';
  assert.deepEqual(project, before);
});

test('removing either referenced component makes a joint module incomplete', () => {
  for (const collection of ['actuators', 'drivers']) {
    const { project, actuator, driver } = fixture();
    const assembly = createJointModule(project, { actuatorId: actuator.id, driverId: driver.id });
    assert.equal(isAssemblyComplete(project.catalog, assembly), true);
    project.catalog[collection] = [];
    assert.equal(isAssemblyComplete(project.catalog, assembly), false);
    assert.throws(() => createJointModule(project, assembly), /不存在/);
  }
});

test('component defaults preserve unknown numbers and independent mutable objects', () => {
  const a = createActuator();
  const b = createActuator();
  assert.ok(Object.values(a.motor).every(value => value === null));
  assert.ok(Object.values(a.reducer).every(value => value === null));
  a.motor.polePairs = 7;
  assert.equal(b.motor.polePairs, null);
  assert.notEqual(a.id, b.id);
  const project = fixture().project;
  project.catalog.assemblies.push(createAssembly());
  assert.equal(checkCatalogShape(project.catalog), true);
});

test('structural validation rejects invalid types, duplicate ids and binding modes', () => {
  for (const mutate of [
    catalog => { catalog.actuators[0].motor.maxCurrentA = Infinity; },
    catalog => { catalog.drivers.push(structuredClone(catalog.drivers[0])); },
    catalog => { catalog.drivers[0].bindings.push({ ...createBinding(), mode: 'invalid' }); },
  ]) {
    const { project } = fixture();
    mutate(project.catalog);
    assert.throws(() => checkCatalogShape(project.catalog));
    assert.ok(validateEquipment(project).some(issue => issue.id === 'equipment-format' && issue.level === 'error'));
  }
});

test('custom signals are accepted; duplicate pin or signal and dangling references are errors', () => {
  const { project, driver } = fixture();
  driver.bindings.push({ ...createBinding(), signal: 'custom_sync', peripheral: 'TIM8', pin: 'PA1' });
  assert.equal(validateEquipment(project).some(issue => issue.level === 'error'), false);
  driver.bindings.push({ ...createBinding(), signal: ' CUSTOM_SYNC ', peripheral: 'TIM2', pin: ' pa1 ' });
  assert.equal(validateEquipment(project).filter(issue => issue.id.includes('duplicate-')).length, 2);
  project.catalog.actuators = [];
  assert.ok(validateEquipment(project).some(issue => issue.level === 'error' && issue.id.endsWith('-actuatorId')));
});

test('apply maps shared fields without mutating the source or inventing algorithm parameters', () => {
  const { project, actuator, driver, assembly } = fixture();
  project.instances['app-motion'].parameters.currentLimitA = 9;
  const original = structuredClone(project);
  const applied = applyAssembly(project, assembly.id);
  assert.deepEqual(project, original);
  assert.deepEqual(applied.target, { vendor: driver.vendor, mcu: driver.mcu, board: driver.board });
  assert.equal(applied.instances['hw-board'].parameters.currentLoopDivider, 2);
  assert.equal(applied.instances['hw-board'].parameters.pwmHz, driver.pwmHz);
  assert.equal(applied.instances['hw-platform'].parameters.flashKiB, driver.flashKiB);
  assert.equal(applied.instances['hw-board'].parameters.busVoltageV, driver.busVoltageV);
  assert.equal(Object.hasOwn(applied.instances['foc-feedback'].parameters, 'polePairs'), false);
  assert.equal(getAssemblySummary(applied).actuator.motor.polePairs, actuator.motor.polePairs);
  assert.equal(applied.instances['app-motion'].parameters.currentLimitA, 6);
  assert.equal(applied.provenance['hw-board.pwmHz'], 'user');
  assert.equal(Object.hasOwn(applied.instances['foc-current'].parameters, 'resistanceOhm'), false);
  assert.equal(getAssemblySummary(applied).stale, false);
  assert.ok(validateEquipment(applied).some(issue => issue.id === 'equipment-pin-capability' && issue.level === 'pending'));
});

test('current boundaries only tighten an existing limit and unknown ratings preserve that limit for review', () => {
  const { project, assembly } = fixture();
  project.instances['app-motion'].parameters.currentLimitA = 2;
  let applied = applyAssembly(project, assembly.id);
  assert.equal(applied.instances['app-motion'].parameters.currentLimitA, 2);
  applied.catalog.drivers[0].maxCurrentA = 1;
  assert.ok(validateEquipment(applied).some(issue => issue.id === 'equipment-active-current'));
  applied = applyAssembly(applied, assembly.id);
  assert.equal(applied.instances['app-motion'].parameters.currentLimitA, 1);
  applied.catalog.drivers[0].maxCurrentA = null;
  applied = applyAssembly(applied, assembly.id);
  assert.equal(applied.instances['app-motion'].parameters.currentLimitA, 1);
  assert.ok(validateEquipment(applied).some(issue => issue.id === 'equipment-current-unknown' && issue.level === 'pending'));
  applied.instances['app-motion'].parameters.currentLimitA = null;
  applied.catalog.drivers[0].maxCurrentA = 6;
  assert.equal(applyAssembly(applied, assembly.id).instances['app-motion'].parameters.currentLimitA, null);
});

test('selected asset changes require reapplication while unrelated library edits do not', () => {
  const { project, assembly } = fixture();
  const applied = applyAssembly(project, assembly.id);
  applied.catalog.actuators.push(createActuator('另一个执行器'));
  assert.equal(getAssemblySummary(applied).stale, false);
  applied.catalog.drivers[0].bindings.push({ ...createBinding(), signal: 'adc_ia', peripheral: 'ADC1', pin: 'PA0', mode: 'analog' });
  assert.equal(getAssemblySummary(applied).stale, true);
  const reapplied = applyAssembly(applied, assembly.id);
  assert.equal(getAssemblySummary(reapplied).stale, false);
  reapplied.catalog.appliedFingerprint = '';
  assert.equal(getAssemblySummary(reapplied).stale, true);
});

test('derived output uses declared reduction and efficiency; unknowns stay unknown', () => {
  const { project, actuator, assembly } = fixture();
  let summary = getAssemblySummary(project, assembly.id);
  assert.equal(summary.outputMaxSpeedRpm, 600);
  assert.equal(summary.outputRatedTorqueNm, 3.2);
  actuator.reducer.efficiency = null;
  assert.equal(getAssemblySummary(project, assembly.id).outputRatedTorqueNm, null);
  actuator.reducer.ratio = 1;
  assert.equal(getAssemblySummary(project, assembly.id).outputRatedTorqueNm, 0.4);
  actuator.reducer.ratio = null;
  summary = getAssemblySummary(project, assembly.id);
  assert.equal(summary.ratio, null);
  assert.equal(summary.outputMaxSpeedRpm, null);
  assert.equal(summary.outputRatedTorqueNm, null);
});

test('驱动器完整硬件快照可跨项目复用，算法和应用保持各自配置', () => {
  const source = createExampleProject();
  const driver = createDriver('G4 驱动器');
  driver.maxCurrentA = 4;
  source.catalog.drivers.push(driver);
  source.target = { vendor: 'st', mcu: 'STM32G474', board: 'R2' };
  source.instances['hw-platform'].parameters.architecture = 'arm';
  source.instances['hw-safety'].parameters.hardwareTripCapability = 'present';
  const captured = captureDriverHardware(source, driver.id);
  assert.equal(source.catalog.drivers[0].mcu, '');
  const target = createProject();
  target.catalog.drivers.push(structuredClone(captured.catalog.drivers[0]));
  target.instances['app-motion'].parameters.currentLimitA = 6;
  target.instances['foc-current'].parameters.kpD = 0.17;
  const reused = applyDriver(target, driver.id);
  assert.equal(hardwareMatchesDriver(reused), true);
  for (const [id, parameters] of Object.entries(getDriverHardware(captured.catalog.drivers[0]))) assert.deepEqual(reused.instances[id].parameters, parameters);
  assert.equal(reused.instances['foc-current'].parameters.kpD, 0.17);
  assert.equal(reused.instances['app-motion'].parameters.currentLimitA, 4);
  assert.equal(reused.catalog.activeAssemblyId, '');
  reused.instances['hw-board'].parameters.currentLoopDivider = 3;
  assert.equal(hardwareMatchesDriver(reused), false);
  assert.equal(captured.catalog.drivers[0].hardware['hw-board'].currentLoopDivider, 1);
});

test('旧货架文件迁移保留公共硬件参数，缺失配置保持未知', () => {
  const { project, driver } = fixture();
  delete driver.hardware; delete project.catalog.activeDriverId;
  const loaded = parseProject(JSON.stringify(project));
  assert.equal(loaded.catalog.drivers[0].hardware['hw-board'].pwmHz, 20000);
  assert.equal(loaded.catalog.drivers[0].hardware['hw-board'].currentLoopDivider, null);
  assert.equal(loaded.catalog.drivers[0].hardware['hw-platform'].architecture, 'arm');
  assert.deepEqual(parseProject(serializeProject(loaded)), loaded);
});

test('驱动器硬件快照拒绝未知模块、非法枚举和保护绕过', () => {
  const { project, driver } = fixture();
  driver.hardware['hw-platform'].architecture = 'invented';
  assert.throws(() => parseProject(JSON.stringify(project)), /不是允许的选项/);
  driver.hardware['hw-platform'].architecture = 'arm';
  driver.hardware['hw-other'] = {};
  assert.throws(() => checkCatalogShape(project.catalog), /未知字段/);
  delete driver.hardware['hw-other'];
  driver.hardware['hw-safety'].resetOutputDisabled = false;
  assert.throws(() => applyDriver(project, driver.id), /复位门控/);
});
