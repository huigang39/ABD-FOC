import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, MODULE_IDS } from '../web/src/core/catalog.mjs';
import { validateCompensation } from '../web/src/modules/algorithm/foc-compensation/validation.mjs';

const module = MODULES.find(item => item.id === 'foc-compensation');
const fixture = () => ({ instances: {
  'foc-compensation': { enabled: true, runtimeEnabled: true, parameters: {
    frictionModel: 'coulomb_viscous', frictionSource: 'stored', viscousNmPerRadS: 0.02,
    coulombNm: 0.1, transitionRadS: 0.5, maxCompensationNm: 0.3,
  } },
  'app-calibration': { enabled: false, runtimeEnabled: false, parameters: { procedures: [], enabledProcedures: [] } },
} });
const has = (project, id, level) => validateCompensation(project).some(issue => issue.id === `compensation-${id}` && (!level || issue.level === level));

test('补偿模块是可选同步快环扩展，增加算法模块不会挤占硬件层编号', () => {
  assert.equal(module.title, '补偿器'); assert.equal(module.layer, 'foc');
  assert.equal(module.required, false); assert.equal(module.runtimeSwitchable, true); assert.equal(module.executionDomain, 'fast');
  assert.deepEqual(module.dependencies, ['foc-feedback', 'foc-current']);
  const algorithm = MODULES.filter(item => item.layer === 'foc');
  assert.deepEqual(algorithm.slice(-2).map(item => item.id), ['foc-compensation', 'foc-lifecycle']);
  for (const layer of ['app', 'foc', 'hardware']) {
    const items = MODULES.filter(item => item.layer === layer && item.id !== 'foc-feedback');
    assert.deepEqual(items.map(item => item.order), items.map((_, index) => index + 1));
  }
  assert.equal(MODULES.find(item => item.id === 'hw-platform').order, 1);
  assert.equal(MODULES.find(item => item.id === 'hw-platform').executionDomain, 'hardware');
  assert.equal(new Set(MODULE_IDS).size, MODULE_IDS.length);
  assert.deepEqual(module.params.filter(param => param.key !== 'children').map(param => param.key), ['frictionModel', 'frictionSource', 'viscousNmPerRadS', 'coulombNm', 'transitionRadS', 'maxCompensationNm']);
  assert.ok(module.params.filter(param => param.type === 'number').every(param => param.defaultValue === null));
});

test('摩擦辨识沿用旧枚举值，校准文案明确产出补偿参数', () => {
  const calibration = MODULES.find(item => item.id === 'app-calibration');
  const option = calibration.params.find(param => param.key === 'procedures').options.find(item => item.value === 'friction');
  assert.equal(option.label, '摩擦辨识');
  assert.match(calibration.role, /摩擦辨识产出补偿参数/);
});

test('未编译或运行关闭时不要求补偿参数，辨识方案可独立保留', () => {
  const value = fixture(); value.instances['foc-compensation'].parameters.coulombNm = -1;
  value.instances['foc-compensation'].enabled = false;
  assert.deepEqual(validateCompensation(value), []);
  value.instances['foc-compensation'].enabled = true; value.instances['foc-compensation'].runtimeEnabled = false;
  assert.deepEqual(validateCompensation(value), []);
  value.instances['app-calibration'].enabled = true;
  value.instances['app-calibration'].parameters.procedures = ['friction'];
  assert.ok(has(value, 'identification-only', 'info'));
  assert.equal(validateCompensation(value).filter(issue => issue.level === 'error').length, 0);
});

test('已有辨识数据不强制编译校准模块，手填数值不冒充已验证校准', () => {
  const value = fixture(), before = structuredClone(value);
  assert.equal(validateCompensation(value).filter(issue => issue.level === 'error').length, 0);
  assert.ok(has(value, 'stored-data-unverified', 'pending'));
  assert.ok(has(value, 'runtime-unverified', 'pending'));
  assert.equal(has(value, 'identification-required'), false);
  assert.deepEqual(value, before);
});

test('本次辨识要求模块开关、编译项目和运行项目同时就绪', () => {
  const value = fixture(); value.instances['foc-compensation'].parameters.frictionSource = 'identify';
  const calibration = value.instances['app-calibration'];
  assert.ok(has(value, 'identification-required', 'error'));
  calibration.enabled = true; calibration.parameters.procedures = ['friction'];
  assert.ok(has(value, 'identification-required', 'error'));
  calibration.runtimeEnabled = true; calibration.parameters.procedures = [];
  assert.ok(has(value, 'identification-required', 'error'));
  calibration.parameters.procedures = ['friction'];
  assert.ok(has(value, 'identification-required', 'error'));
  calibration.parameters.enabledProcedures = ['friction'];
  assert.equal(has(value, 'identification-required'), false);
  assert.ok(has(value, 'identification-unverified', 'pending'));
  assert.equal(has(value, 'stored-data-unverified'), false);
  calibration.parameters.enabledProcedures = [];
  assert.ok(has(value, 'identification-required', 'error'));
  value.instances['foc-compensation'].parameters.frictionSource = 'stored';
  assert.equal(has(value, 'identification-required'), false);
});

test('未知参数保留 pending，每字段只报告一项且不产生系数', () => {
  const value = fixture();
  value.instances['foc-compensation'].parameters = Object.fromEntries(module.params.map(param => [param.key, param.defaultValue]));
  const before = structuredClone(value), issues = validateCompensation(value);
  const fields = issues.filter(issue => issue.paramKey);
  assert.equal(fields.length, module.params.filter(param => param.key !== 'children').length);
  assert.ok(fields.every(issue => issue.level === 'pending'));
  assert.equal(new Set(issues.map(issue => issue.id)).size, issues.length);
  assert.deepEqual(value, before);
});

test('摩擦幅值允许零，平滑带与输出限幅必须大于零，非法类型和非有限值均报错', () => {
  const value = fixture(), p = value.instances['foc-compensation'].parameters;
  p.viscousNmPerRadS = 0; p.coulombNm = 0;
  assert.equal(validateCompensation(value).filter(issue => issue.level === 'error').length, 0);
  p.transitionRadS = 0; p.maxCompensationNm = 0;
  assert.ok(has(value, 'range-transitionRadS', 'error'));
  assert.ok(has(value, 'range-maxCompensationNm', 'error'));
  for (const key of ['viscousNmPerRadS', 'coulombNm', 'transitionRadS', 'maxCompensationNm']) {
    for (const invalid of [-1, Infinity, NaN, '1']) { p[key] = invalid; assert.ok(has(value, `range-${key}`, 'error'), `${key}: ${invalid}`); }
    p[key] = 1;
  }
  p.frictionModel = 'unknown'; p.frictionSource = 'manual';
  assert.ok(has(value, 'invalid-frictionModel', 'error'));
  assert.ok(has(value, 'invalid-frictionSource', 'error'));
});
