import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../web/src/core/catalog.mjs';
import { calibrationEnabled, validateCalibration } from '../web/src/modules/application/app-calibration/validation.mjs';

const fixture = () => ({ instances: {
  'app-motion': { enabled: true, runtimeEnabled: true, parameters: { activeMode: 'speed' } },
  'app-calibration': { enabled: true, runtimeEnabled: true, parameters: { procedures: ['friction', 'electrical_zero'], enabledProcedures: ['friction'] } },
} });
const has = (project, id, level) => validateCalibration(project).some(issue => issue.id === `calibration-${id}` && (!level || issue.level === level));

test('校准项目分为编译列表与运行许可，默认不允许实际校准项目', () => {
  const module = MODULES.find(item => item.id === 'app-calibration');
  const compile = module.params.find(param => param.key === 'procedures');
  const runtime = module.params.find(param => param.key === 'enabledProcedures');
  assert.equal(compile.label, '编译包含的校准项目'); assert.equal(compile.phase, 'compile');
  assert.equal(runtime.label, '运行允许的校准项目'); assert.equal(runtime.phase, 'runtime');
  assert.equal(runtime.required, false); assert.deepEqual(runtime.defaultValue, []);
  assert.deepEqual(runtime.options, compile.options);
  assert.match(runtime.description, /停机条件、模式互斥和运动范围/);
});

test('项目许可同时依赖模块编译、模块运行、项目编译和项目运行四条件', () => {
  const value = fixture(), calibration = value.instances['app-calibration'];
  assert.equal(calibrationEnabled(value, 'friction'), true);
  assert.equal(calibrationEnabled(value, 'electrical_zero'), false);
  assert.equal(calibrationEnabled(value, 'unknown'), false);
  calibration.enabled = false; assert.equal(calibrationEnabled(value, 'friction'), false);
  calibration.enabled = true; calibration.runtimeEnabled = false;
  assert.equal(calibrationEnabled(value, 'friction'), false);
  calibration.runtimeEnabled = true; calibration.parameters.procedures = [];
  assert.equal(calibrationEnabled(value, 'friction'), false);
  calibration.parameters.procedures = ['friction']; calibration.parameters.enabledProcedures = [];
  assert.equal(calibrationEnabled(value, 'friction'), false);
});

test('缺失旧字段只读继承编译列表，显式空列表或未知值不会重新开启', () => {
  const value = fixture(), params = value.instances['app-calibration'].parameters;
  delete params.enabledProcedures;
  const old = structuredClone(value);
  assert.equal(calibrationEnabled(value, 'friction'), true);
  assert.equal(calibrationEnabled(value, 'electrical_zero'), true);
  assert.deepEqual(validateCalibration(value), []);
  assert.deepEqual(value, old);
  params.enabledProcedures = [];
  assert.equal(calibrationEnabled(value, 'friction'), false);
  params.enabledProcedures = null;
  assert.equal(calibrationEnabled(value, 'friction'), false);
});

test('运行允许列表必须是编译项目子集，冲突不被自动修复或丢失', () => {
  const value = fixture(); value.instances['app-calibration'].parameters.enabledProcedures = ['friction', 'hall'];
  const before = structuredClone(value);
  assert.ok(has(value, 'runtime-not-compiled', 'error'));
  assert.equal(calibrationEnabled(value, 'hall'), false);
  assert.deepEqual(value, before);
  value.instances['app-calibration'].parameters.procedures.push('hall');
  assert.equal(has(value, 'runtime-not-compiled'), false);
  assert.equal(calibrationEnabled(value, 'hall'), true);
});

test('允许列表为空是合法关闭，但当前校准模式必须有可运行项目', () => {
  const value = fixture(); value.instances['app-calibration'].parameters.enabledProcedures = [];
  assert.deepEqual(validateCalibration(value), []);
  value.instances['app-motion'].parameters.activeMode = 'calibration';
  assert.ok(has(value, 'no-runtime-procedures', 'error'));
  value.instances['app-calibration'].parameters.enabledProcedures = ['friction'];
  assert.equal(has(value, 'no-runtime-procedures'), false);
  value.instances['app-calibration'].runtimeEnabled = false;
  assert.ok(has(value, 'runtime-disabled', 'error'));
  assert.equal(has(value, 'no-runtime-procedures'), false);
});

test('非法列表仅作配置错误报告，不合成执行状态或修改项目', () => {
  const value = fixture();
  value.instances['app-calibration'].parameters.procedures = ['friction', 'friction'];
  value.instances['app-calibration'].parameters.enabledProcedures = ['invented'];
  const before = structuredClone(value), issues = validateCalibration(value);
  assert.ok(has(value, 'invalid-procedures', 'error'));
  assert.ok(has(value, 'invalid-enabledProcedures', 'error'));
  assert.equal(new Set(issues.map(issue => issue.id)).size, issues.length);
  assert.ok(issues.every(issue => issue.moduleId === 'app-calibration' && issue.message));
  assert.deepEqual(value, before);
  assert.equal(calibrationEnabled(value, 'invented'), false);
});
