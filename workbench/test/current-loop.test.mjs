import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, MODULE_IDS } from '../web/src/core/catalog.mjs';
import { getCurrentLoopDesign, validateCurrentLoop } from '../web/src/modules/algorithm/foc-current/design.mjs';

const fixture = () => ({
  instances: {
    'foc-current': { enabled: true, runtimeEnabled: true, parameters: { bandwidthHz: 1000, kpD: 999, kiD: 999, kpQ: 999, kiQ: 999 } },
    'hw-board': { enabled: true, runtimeEnabled: true, parameters: { pwmHz: 20000, currentLoopDivider: 2 } },
  },
  catalog: {
    activeAssemblyId: 'joint-selected',
    assemblies: [{ id: 'joint-selected', actuatorId: 'motor-selected', driverId: 'driver' }],
    actuators: [
      { id: 'other', name: '其他执行器', motor: { resistanceOhm: 8, inductanceDH: 1, inductanceQH: 2 } },
      { id: 'motor-selected', name: '当前执行器', motor: { resistanceOhm: 0.2, inductanceDH: 0.0003, inductanceQH: 0.0004 } },
    ],
  },
});
const has = (project, id, level) => validateCurrentLoop(project).some(issue => issue.id === `current-loop-${id}` && (!level || issue.level === level));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('独立保护合入电流环，依赖无悬空、自引用或重复，旧 PI 字段仅隐藏兼容', () => {
  const current = MODULES.find(module => module.id === 'foc-current');
  const lifecycle = MODULES.find(module => module.id === 'foc-lifecycle');
  assert.equal(current.title, '电流环');
  assert.equal(MODULE_IDS.includes('foc-safety'), false);
  assert.ok(lifecycle.params.some(param => param.key === 'referenceTimeoutMs' && param.hidden));
  assert.ok(lifecycle.params.some(param => param.key === 'maxCurrentA' && param.hidden));
  assert.ok(current.params.some(param => param.key === 'bandwidthHz' && param.required && param.phase === 'runtime' && param.unit === 'Hz'));
  for (const key of ['kpD', 'kiD', 'kpQ', 'kiQ']) {
    const param = current.params.find(param => param.key === key);
    assert.equal(param.hidden, true); assert.equal(param.required, false); assert.equal(param.defaultValue, null);
  }
  for (const module of MODULES) {
    assert.equal(new Set(module.dependencies).size, module.dependencies.length);
    assert.ok(module.dependencies.every(id => MODULE_IDS.includes(id) && id !== module.id));
  }
  assert.deepEqual(MODULES.find(module => module.id === 'app-safety').dependencies, ['foc-current', 'hw-safety']);
  assert.ok(current.dependencies.includes('hw-safety'));
});

test('按已选执行器 R/Ld/Lq 和 2πf 推导连续 PI，不使用其他货架或旧 PI 值', () => {
  const value = fixture(), before = structuredClone(value), design = getCurrentLoopDesign(value);
  const omega = 2 * Math.PI * 1000;
  assert.equal(design.actuator.id, 'motor-selected');
  assert.equal(design.bandwidthHz, 1000); assert.equal(design.sampleHz, 10000); assert.equal(design.periodSeconds, 0.0001);
  near(design.gains.kpD, omega * 0.0003); near(design.gains.kpQ, omega * 0.0004);
  near(design.gains.kiD, omega * 0.2); near(design.gains.kiQ, omega * 0.2);
  assert.deepEqual(design.missing, []);
  assert.deepEqual(value, before);
  design.actuator.motor.resistanceOhm = 7;
  assert.deepEqual(value, before);
  assert.equal(has(value, 'bandwidth-sampling'), false);
  assert.ok(has(value, 'runtime-unverified', 'pending'));
});

test('未选关节模组或执行器引用缺失时保持未知，不取货架第一项', () => {
  for (const mode of ['none', 'missing-assembly', 'missing-actuator']) {
    const value = fixture();
    if (mode === 'none') value.catalog.activeAssemblyId = '';
    if (mode === 'missing-assembly') value.catalog.activeAssemblyId = 'gone';
    if (mode === 'missing-actuator') value.catalog.assemblies[0].actuatorId = 'gone';
    const design = getCurrentLoopDesign(value);
    assert.equal(design.actuator, null); assert.equal(design.gains, null);
    assert.ok(design.missing.includes('当前执行器'));
    assert.ok(has(value, 'motor-parameters', 'pending'));
  }
});

test('R/L 缺失或无效时不生成增益，不从旧 PI 值反推缺失带宽', () => {
  for (const key of ['resistanceOhm', 'inductanceDH', 'inductanceQH']) {
    for (const invalid of [null, 0, -1, NaN, Infinity]) {
      const value = fixture(); value.catalog.actuators[1].motor[key] = invalid;
      assert.equal(getCurrentLoopDesign(value).gains, null);
      assert.ok(has(value, 'motor-parameters', 'pending'));
    }
  }
  const value = fixture(); value.instances['foc-current'].parameters.bandwidthHz = null;
  const design = getCurrentLoopDesign(value);
  assert.equal(design.bandwidthHz, null); assert.equal(design.gains, null);
  assert.ok(design.missing.includes('电流环带宽'));
  assert.equal(validateCurrentLoop(value).some(issue => issue.paramKey === 'bandwidthHz'), false);
});

test('带宽需小于采样频率一半，必要条件通过后仍保留离散实现待验', () => {
  const value = fixture(), params = value.instances['foc-current'].parameters;
  for (const invalid of [0, -1, Infinity, NaN, '1000']) { params.bandwidthHz = invalid; assert.ok(has(value, 'bandwidth-range', 'error')); }
  params.bandwidthHz = 5000; assert.ok(has(value, 'bandwidth-sampling', 'error'));
  params.bandwidthHz = 5001; assert.ok(has(value, 'bandwidth-sampling', 'error'));
  params.bandwidthHz = 4999; assert.equal(has(value, 'bandwidth-sampling'), false);
  assert.ok(has(value, 'runtime-unverified', 'pending'));
});

test('未知采样时序不捏造周期，错误分频和数值溢出均可报告', () => {
  const value = fixture(), timing = value.instances['hw-board'].parameters;
  for (const invalid of [null, 0, -1, 1.5, Infinity]) {
    timing.currentLoopDivider = invalid;
    assert.equal(getCurrentLoopDesign(value).sampleHz, null);
    assert.equal(getCurrentLoopDesign(value).periodSeconds, null);
    assert.ok(has(value, 'sampling-incomplete', 'pending'));
  }
  timing.currentLoopDivider = 1; timing.pwmHz = Number.MIN_VALUE;
  assert.equal(getCurrentLoopDesign(value).periodSeconds, null);
  assert.ok(has(value, 'sampling-incomplete', 'pending'));
  value.instances['foc-current'].parameters.bandwidthHz = Number.MAX_VALUE;
  assert.equal(getCurrentLoopDesign(value).gains, null);
  assert.ok(has(value, 'gain-range', 'error'));
});

test('未参与编译或运行关闭时不产生电流环运行检查，验证不修改配置', () => {
  const value = fixture(); value.instances['foc-current'].parameters.bandwidthHz = -1;
  value.instances['foc-current'].enabled = false;
  assert.deepEqual(validateCurrentLoop(value), []);
  value.instances['foc-current'].enabled = true; value.instances['foc-current'].runtimeEnabled = false;
  assert.deepEqual(validateCurrentLoop(value), []);
  value.instances['foc-current'].runtimeEnabled = true;
  const before = structuredClone(value), issues = validateCurrentLoop(value);
  assert.equal(new Set(issues.map(issue => issue.id)).size, issues.length);
  assert.deepEqual(value, before);
});
