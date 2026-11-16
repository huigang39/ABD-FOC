import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../web/src/core/catalog.mjs';
import { OPTIMIZATION_LEVELS, checkModuleOptimizations, getModuleOptimization } from '../web/src/features/build/options.mjs';

const moduleId = 'foc-current';
const project = () => ({
  build: { optimization: 'O2', moduleOptimizations: {} },
  instances: Object.fromEntries(MODULES.map(module => [module.id, { enabled: true, runtimeEnabled: true }])),
});

test('missing module overrides follow changes to the global optimization', () => {
  const value = project();
  assert.deepEqual(getModuleOptimization(value, moduleId), { setting: 'inherit', effective: 'O2', compiled: true });
  value.build.optimization = 'Og';
  assert.equal(getModuleOptimization(value, moduleId).effective, 'Og');
  delete value.build.moduleOptimizations;
  assert.deepEqual(getModuleOptimization(value, moduleId), { setting: 'inherit', effective: 'Og', compiled: true });
  value.build.optimization = 'unselected';
  assert.equal(getModuleOptimization(value, moduleId).effective, 'unselected');
});

test('an explicit override survives global changes until the key is removed', () => {
  const value = project();
  value.build.moduleOptimizations[moduleId] = 'O0';
  value.build.optimization = 'O3';
  assert.deepEqual(getModuleOptimization(value, moduleId), { setting: 'O0', effective: 'O0', compiled: true });
  delete value.build.moduleOptimizations[moduleId];
  assert.equal(getModuleOptimization(value, moduleId).effective, 'O3');
});

test('runtime enablement does not change compilation and excluded modules retain overrides', () => {
  const value = project();
  value.build.moduleOptimizations[moduleId] = 'Os';
  value.instances[moduleId].runtimeEnabled = false;
  assert.deepEqual(getModuleOptimization(value, moduleId), { setting: 'Os', effective: 'Os', compiled: true });
  value.instances[moduleId].enabled = false;
  assert.deepEqual(getModuleOptimization(value, moduleId), { setting: 'Os', effective: 'Os', compiled: false });
  value.instances[moduleId].enabled = true;
  assert.equal(getModuleOptimization(value, moduleId).effective, 'Os');
});

test('every listed module may use any supported configuration value', () => {
  const value = project();
  assert.deepEqual(OPTIMIZATION_LEVELS, ['O0', 'Og', 'O1', 'O2', 'O3', 'Os', 'Oz']);
  for (const level of OPTIMIZATION_LEVELS) {
    value.build.moduleOptimizations = Object.fromEntries(MODULES.map(module => [module.id, level]));
    assert.doesNotThrow(() => checkModuleOptimizations(value.build.moduleOptimizations));
    for (const module of MODULES) assert.equal(getModuleOptimization(value, module.id).effective, level);
  }
  assert.doesNotThrow(() => checkModuleOptimizations({}));
  assert.doesNotThrow(() => checkModuleOptimizations(Object.assign(Object.create(null), { [moduleId]: 'O1' })));
});

test('validation rejects unknown modules and inheritance stored as a value', () => {
  assert.throws(() => checkModuleOptimizations({ missing: 'O2' }), /未知模块/);
  assert.throws(() => checkModuleOptimizations(JSON.parse('{"__proto__":"O2"}')), /未知模块/);
  for (const value of ['inherit', 'unselected', 'Ofast', '-O2', '', null, undefined, 2, true, {}]) {
    assert.throws(() => checkModuleOptimizations({ [moduleId]: value }), /优化等级/);
  }
  for (const value of [undefined, null, [], 'O2', 2, new Date(), Object.create({ [moduleId]: 'O1' })]) {
    assert.throws(() => checkModuleOptimizations(value), /必须是对象/);
  }
  assert.throws(() => getModuleOptimization(project(), 'missing'), /未知模块/);
});

test('resolving and validating settings leave configuration untouched', () => {
  const value = project();
  value.build.moduleOptimizations[moduleId] = 'Og';
  const before = structuredClone(value);
  Object.freeze(value.build.moduleOptimizations);
  Object.freeze(value.build);
  Object.freeze(value.instances[moduleId]);
  Object.freeze(value.instances);
  Object.freeze(value);
  checkModuleOptimizations(value.build.moduleOptimizations);
  getModuleOptimization(value, moduleId);
  getModuleOptimization(value, 'foc-feedback');
  assert.deepEqual(value, before);
});
