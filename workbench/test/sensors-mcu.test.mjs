import test from 'node:test';
import assert from 'node:assert/strict';
import { SENSOR_ROLES, SENSOR_PARAMS, sensorFieldVisible, sensorFieldRequired } from '../web/src/modules/hardware/hw-sensors/sensors.mjs';
import { identifyMcu, syncMcuArchitecture } from '../web/src/features/deployment/mcu.mjs';
import { createProject, createExampleProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { createDriver, applyDriver, applyAssembly, createActuator, createAssembly, getDriverHardware, hardwareMatchesDriver, getAssemblySummary } from '../web/src/features/equipment/model.mjs';
import { saveLayerVersion } from '../web/src/features/configuration/versions.mjs';

const sensors = project => project.instances['hw-sensors'].parameters;
const field = key => SENSOR_PARAMS.find(item => item.key === key);
const has = (project, id, level) => validateProject(project).some(issue => issue.id === id && (!level || issue.level === level));

test('三类传感器独立配置，霍尔属于编码器类型且条件字段随方案变化', () => {
  assert.deepEqual(SENSOR_ROLES.map(role => role.id), ['motor', 'output', 'torque']);
  const value = sensors(createProject());
  assert.equal(sensorFieldVisible(field('motorEncoderType'), value), false);
  value.encoderCapability = 'present'; value.motorEncoderType = 'absolute';
  assert.equal(sensorFieldRequired(field('encoderBits'), value), true);
  assert.equal(sensorFieldVisible(field('motorEncoderCountsPerRev'), value), false);
  assert.equal(sensorFieldVisible(field('outputEncoderType'), value), false);
  value.motorEncoderType = 'incremental';
  assert.equal(sensorFieldRequired(field('encoderBits'), value), false);
  assert.equal(sensorFieldRequired(field('motorEncoderCountsPerRev'), value), true);
  value.motorEncoderType = 'hall'; value.motorEncoderHallMode = 'linear';
  assert.equal(sensorFieldRequired(field('motorEncoderSinResource'), value), true);
  assert.equal(sensorFieldRequired(field('motorEncoderCosResource'), value), true);
  value.motorEncoderHallMode = 'digital';
  assert.equal(sensorFieldRequired(field('motorEncoderSinResource'), value), false);
  assert.equal(sensorFieldVisible(field('hallCapability'), value), false);
  value.torqueCapability = 'present'; value.torqueSensorUnit = 'raw';
  assert.equal(sensorFieldRequired(field('torqueSensorScale'), value), true);
  value.torqueSensorUnit = 'nm';
  assert.equal(sensorFieldRequired(field('torqueSensorScale'), value), false);
});

test('每个传感器缺失参数仅报告一项 pending，厂商和型号仅作记录，不作为协议实现条件', () => {
  const project = createExampleProject();
  sensors(project).motorEncoderVendor = 'gongwang';
  const pending = validateProject(project).filter(issue => issue.level === 'pending' && issue.moduleId === 'hw-sensors');
  assert.equal(pending.filter(issue => issue.paramKey === 'motorEncoderInterface').length, 1);
  assert.equal(pending.filter(issue => issue.paramKey === 'motorEncoderTimeoutUs').length, 1);
  assert.equal(pending.filter(issue => issue.paramKey === 'motorEncoderModel').length, 0);
  assert.equal(new Set(pending.map(issue => issue.paramKey)).size, pending.length);
  assert.equal(sensors(project).motorEncoderInterface, 'unselected');
  assert.ok(pending.every(issue => issue.message.trim()));
});

test('输出轴机械角、线性霍尔采样通道与数据有效期具有独立校验', () => {
  const project = createExampleProject();
  Object.assign(sensors(project), {
    outputEncoderCapability: 'present', outputEncoderType: 'hall', outputEncoderHallMode: 'linear', outputEncoderAngleDomain: 'electrical',
    outputEncoderSinResource: 'ADC1_CH1', outputEncoderCosResource: 'adc1_ch1', outputEncoderAmplitudeMin: 0.9, outputEncoderAmplitudeMax: 0.1,
    outputEncoderTiming: 'periodic', outputEncoderRateHz: 1000, outputEncoderTimeoutUs: 500,
  });
  for (const id of ['sensor-output-domain', 'sensor-outputEncoderchannels', 'sensor-outputEncoderamplitude', 'sensor-outputEncoderfreshness']) assert.ok(has(project, id, 'error'), id);
  Object.assign(sensors(project), { outputEncoderAngleDomain: 'mechanical', outputEncoderCosResource: 'ADC1_CH2', outputEncoderAmplitudeMin: 0.1, outputEncoderAmplitudeMax: 0.9, outputEncoderTimeoutUs: 1000 });
  assert.equal(validateProject(project).filter(issue => issue.id.startsWith('sensor-') && issue.level === 'error').length, 0);
});

test('停用传感器保留条件参数，但不以未启用方案阻塞当前配置', () => {
  const project = createExampleProject('sensorless');
  sensors(project).outputEncoderBits = 0;
  assert.equal(has(project, 'range-hw-sensors-outputEncoderBits'), false);
  sensors(project).outputEncoderCapability = 'present'; sensors(project).outputEncoderType = 'absolute';
  assert.ok(has(project, 'range-hw-sensors-outputEncoderBits', 'error'));
  project.instances['app-motion'].parameters.positionFeedback = 'output_encoder';
  sensors(project).outputEncoderCapability = 'absent';
  assert.ok(has(project, 'capability-outputEncoderCapability-app-motion', 'error'));
});

test('旧 Hall 角度与传感器迁移为编码器接口中的 Hall 方案，数值未知保留', () => {
  for (const schemaVersion of [1, 2]) {
    const old = createExampleProject('hall');
    old.schemaVersion = schemaVersion;
    old.instances['foc-feedback'].parameters.angleSource = 'hall';
    old.instances['hw-sensors'].parameters = { encoderCapability: 'absent', encoderBits: null, hallCapability: 'present', torqueCapability: 'absent' };
    old.provenance = { 'foc-feedback.angleSource': 'user', 'hw-sensors.hallCapability': 'user' };
    if (schemaVersion === 1) {
      for (const key of ['build', 'design', 'catalog', 'commissioning', 'layerVersions', 'operation', 'memory', 'execution', 'compatibility']) delete old[key];
      for (const instance of Object.values(old.instances)) delete instance.runtimeEnabled;
    }
    const loaded = parseProject(JSON.stringify(old));
    assert.equal(loaded.instances['foc-feedback'].parameters.angleSource, 'encoder');
    assert.equal(sensors(loaded).motorEncoderType, 'hall');
    assert.equal(sensors(loaded).encoderCapability, 'present');
    assert.equal(sensors(loaded).motorEncoderHallMode, 'unselected');
    assert.equal(sensors(loaded).motorEncoderTimeoutUs, null);
    assert.deepEqual(loaded.provenance, old.provenance);
    assert.deepEqual(parseProject(serializeProject(old)), loaded);
  }
});

test('旧 schema 2 自动补运行配置、版本目录和模块优化，显式非法值仍拒绝', () => {
  const old = createProject();
  delete old.operation; delete old.layerVersions; delete old.build.moduleOptimizations;
  const loaded = parseProject(JSON.stringify(old));
  assert.deepEqual(loaded.layerVersions.selected, { hardware: '', foc: '', app: '' });
  assert.equal(loaded.operation.positionRad, null);
  assert.deepEqual(loaded.build.moduleOptimizations, {});
  for (const key of ['operation', 'layerVersions']) assert.throws(() => parseProject(JSON.stringify({ ...old, [key]: null })), /必须是对象/);
  old.build.moduleOptimizations = null;
  assert.throws(() => parseProject(JSON.stringify(old)), /必须是对象/);
});

test('MCU 识别只映射已维护型号家族，不从厂商、局部前缀或未知芯片猜架构', () => {
  assert.equal(identifyMcu(' stm32g474ret6 ')?.architecture, 'arm');
  for (const model of ['HPM5301', 'HPM5321', 'HPM5331', 'HPM5361']) assert.equal(identifyMcu(model)?.architecture, 'riscv');
  for (const model of ['', null, 'STM32', 'STM32G47', 'HPM5300', 'HPM9999', 'ST unknown']) assert.equal(identifyMcu(model), null);
  const target = { vendor: 'other', mcu: 'HPM5361', board: 'PCB-X' };
  const hardware = { 'hw-platform': { architecture: 'arm' }, 'hw-board': { pwmHz: 17000 } };
  syncMcuArchitecture(target, hardware);
  assert.equal(target.vendor, 'hpmicro');
  assert.equal(hardware['hw-platform'].architecture, 'riscv');
  assert.equal(hardware['hw-board'].pwmHz, 17000);
  target.mcu = 'unknown'; syncMcuArchitecture(target, hardware);
  assert.equal(hardware['hw-platform'].architecture, 'unselected');
});

test('导入、驱动器应用与版本快照对同一 MCU 使用一致派生架构', () => {
  let project = createProject();
  project.target = { vendor: 'other', mcu: 'STM32G474', board: '板卡' };
  project.instances['hw-platform'].parameters.architecture = 'riscv';
  assert.ok(has(project, 'mcu-metadata-mismatch', 'error'));
  project = saveLayerVersion(project, { layer: 'hardware', version: '旧声明' });
  const driver = createDriver('驱动器'); driver.mcu = 'HPM5361'; driver.vendor = 'other'; driver.hardware['hw-platform'].architecture = 'arm';
  project.catalog.drivers.push(driver);
  const loaded = parseProject(serializeProject(project));
  assert.equal(loaded.target.vendor, 'st');
  assert.equal(loaded.instances['hw-platform'].parameters.architecture, 'arm');
  assert.equal(loaded.layerVersions.releases[0].snapshot.instances['hw-platform'].parameters.architecture, 'arm');
  assert.equal(loaded.catalog.drivers[0].vendor, 'hpmicro');
  assert.equal(getDriverHardware(loaded.catalog.drivers[0])['hw-platform'].architecture, 'riscv');
  const applied = applyDriver(project, driver.id);
  assert.equal(applied.target.vendor, 'hpmicro');
  assert.equal(applied.instances['hw-platform'].parameters.architecture, 'riscv');
  assert.equal(hardwareMatchesDriver(applied), true);
  const actuator = createActuator(), assembly = createAssembly();
  assembly.actuatorId = actuator.id; assembly.driverId = driver.id;
  project.catalog.actuators.push(actuator); project.catalog.assemblies.push(assembly);
  const assembled = applyAssembly(project, assembly.id);
  assert.equal(assembled.target.vendor, 'hpmicro');
  assert.equal(getAssemblySummary(parseProject(serializeProject(assembled))).stale, false);
  project.target.mcu = 'unknown';
  const unknown = parseProject(serializeProject(project));
  assert.equal(unknown.instances['hw-platform'].parameters.architecture, 'unselected');
  const pending = validateProject(unknown).filter(issue => issue.level === 'pending' && issue.moduleId === 'hw-platform' && issue.paramKey === 'architecture');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'mcu-architecture-unknown');
});


test('传感器资源与通道的纯空格文本仍属于待填写', () => {
  const project=createExampleProject('hall');
  Object.assign(sensors(project), {encoderCapability:'present',motorEncoderType:'hall',motorEncoderHallMode:'linear',motorEncoderResource:'  ',motorEncoderSinResource:'  ',motorEncoderCosResource:'\t'});
  const pending=validateProject(project).filter(issue=>issue.level==='pending'&&issue.moduleId==='hw-sensors');
  for(const key of ['motorEncoderResource','motorEncoderSinResource','motorEncoderCosResource'])assert.equal(pending.filter(issue=>issue.paramKey===key).length,1);
});
