import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, MODULE_IDS } from '../web/src/core/catalog.mjs';
import { getMcuCores, identifyMcu, syncMcuArchitecture } from '../web/src/features/deployment/mcu.mjs';
import { createExecutionPlan, checkExecutionShape, moduleCore, applyExecutionPreset, validateExecution, H745_SHARED_RAM } from '../web/src/features/deployment/execution.mjs';

const project = (mcu = 'STM32H745ZIT6') => ({
  target: { mcu, vendor: 'st', board: 'PCB-R1' },
  instances: Object.fromEntries(MODULES.map(module => [module.id, { enabled: true, runtimeEnabled: true, parameters: {} }])),
  execution: createExecutionPlan(), design: { layerInterfaces: [] },
});
const has = (value, id, level) => validateExecution(value).some(issue => issue.id === `execution-${id}` && (!level || issue.level === level));
const split = () => applyExecutionPreset(project());
const configureIpc = value => {
  Object.assign(value.execution.ipc, { transport: 'shared_memory', notification: 'hsem', cachePolicy: 'noncacheable', sharedAddress: 0x30040000, sharedSizeKiB: 4 });
  return value;
};

test('按已维护型号识别内核，H745 不推断 Flash 容量，返回值不共享元数据', () => {
  for (const model of ['stm32h745', 'STM32H745ZGT6', ' STM32H745ZIT6 ']) {
    assert.deepEqual(getMcuCores(model).map(core => core.id), ['cm7', 'cm4']);
    assert.equal(identifyMcu(model).architecture, 'arm');
    assert.equal(Object.hasOwn(identifyMcu(model), 'flashKiB'), false);
  }
  assert.deepEqual(getMcuCores('STM32G474RET6').map(core => core.id), ['cm4']);
  for (const model of ['HPM5301', 'HPM5321', 'HPM5331', 'HPM5361']) assert.deepEqual(getMcuCores(model).map(core => core.id), ['rv32']);
  assert.deepEqual(getMcuCores('STM32H7'), []);
  assert.deepEqual(getMcuCores('unknown'), []);
  const detached = getMcuCores('STM32H745'); detached[0].label = 'changed';
  assert.equal(getMcuCores('STM32H745')[0].label, 'Cortex-M7');
  const target = { vendor: 'other', mcu: 'STM32H745', board: '' }, hardware = { 'hw-platform': { architecture: 'riscv' } };
  syncMcuArchitecture(target, hardware);
  assert.equal(target.vendor, 'st'); assert.equal(hardware['hw-platform'].architecture, 'arm');
});

test('内核配置工厂为每模块保留空分配，严格检查结构且不共享状态', () => {
  const value = createExecutionPlan(), other = createExecutionPlan();
  assert.deepEqual(Object.keys(value.assignments), MODULE_IDS);
  assert.equal(value.ipc.sharedAddress, null);
  assert.equal(checkExecutionShape(value), true);
  value.assignments['hw-board'] = 'cm7'; value.ipc.sharedAddress = 0;
  assert.equal(other.assignments['hw-board'], ''); assert.equal(other.ipc.sharedAddress, null);
  const corruptions = [
    p => { p.unknown = true; }, p => { delete p.assignments['hw-sensors']; },
    p => { p.assignments['unknown-module'] = 'cm7'; }, p => { p.assignments['hw-board'] = null; },
    p => { p.ipc.sharedAddress = Infinity; }, p => { p.ipc.sharedSizeKiB = '4'; },
    p => { p.ipc.cachePolicy = 'coherent'; }, p => { p.ipc.notification = 'interrupt'; },
    p => { p.ipc = null; }, p => { p.bootCore = 7; },
  ];
  for (const corrupt of corruptions) { const invalid = createExecutionPlan(); corrupt(invalid); assert.throws(() => checkExecutionShape(invalid)); }
});

test('单核默认使用唯一内核，未知 MCU 不猜核数，读取和检查无副作用', () => {
  for (const [mcu, core] of [['STM32G474', 'cm4'], ['HPM5361', 'rv32']]) {
    const value = project(mcu), before = structuredClone(value);
    assert.ok(MODULE_IDS.every(id => moduleCore(value, id) === core));
    assert.deepEqual(validateExecution(value), []);
    assert.deepEqual(value, before);
  }
  const unknown = project('unknown');
  assert.equal(moduleCore(unknown, 'hw-board'), '');
  assert.equal(moduleCore(unknown, 'unknown'), '');
  assert.deepEqual(validateExecution(unknown), []);
  unknown.execution.assignments['hw-board'] = 'cm7';
  assert.ok(has(unknown, 'cores-unknown', 'pending'));
});

test('双核空配置聚合提示，分工方案独立克隆且不虚构共享地址', () => {
  const before = project(), original = structuredClone(before);
  assert.ok(has(before, 'modules-unassigned', 'pending'));
  assert.ok(has(before, 'boot-unselected', 'pending'));
  assert.equal(has(before, 'ipc-incomplete'), false);
  const value = applyExecutionPreset(before);
  assert.deepEqual(before, original);
  assert.equal(value.execution.mcu, before.target.mcu);
  assert.equal(value.execution.bootCore, 'cm7');
  for (const module of MODULES) assert.equal(value.execution.assignments[module.id], module.layer === 'app' ? 'cm4' : 'cm7');
  assert.equal(value.execution.ipc.sharedAddress, null);
  assert.ok(has(value, 'ipc-incomplete', 'pending'));
  assert.equal(has(value, 'fast-loop-split'), false);
  assert.throws(() => applyExecutionPreset(project('STM32G474')), /仅适用于/);
  configureIpc(value);
  assert.deepEqual(applyExecutionPreset(value).execution.ipc, value.execution.ipc);
  value.execution.mcu = 'STM32H745ZGT6';
  assert.equal(applyExecutionPreset(value).execution.ipc.sharedAddress, null);
});

test('切换 MCU 不静默迁移显式分配，无效核心与未绑定配置分别提示', () => {
  const value = split(); value.target.mcu = 'STM32G474';
  const before = structuredClone(value);
  assert.equal(moduleCore(value, 'hw-board'), 'cm7');
  assert.ok(has(value, 'target-changed', 'error'));
  assert.ok(has(value, 'core-hw-board', 'error'));
  assert.ok(has(value, 'boot-core', 'error'));
  assert.deepEqual(value, before);
  value.execution.mcu = ''; value.execution.bootCore = 'cm4';
  assert.ok(has(value, 'target-unbound', 'pending'));
  const lowercase = split(); lowercase.execution.mcu = ' stm32h745zit6 ';
  assert.equal(has(lowercase, 'target-changed'), false);
});

test('同步快环按编译模块检查同核，运行开关不会掩盖观测器跨核冲突', () => {
  const value = split();
  value.execution.assignments['foc-observer'] = 'cm4';
  value.instances['foc-observer'].runtimeEnabled = false;
  assert.ok(has(value, 'fast-loop-split', 'error'));
  value.instances['foc-observer'].enabled = false;
  assert.equal(has(value, 'fast-loop-split'), false);
  value.execution.assignments['hw-sensors'] = 'cm4';
  assert.ok(has(value, 'fast-loop-split', 'error'));
});

test('跨核函数调用报错，依赖边也要求 IPC，关闭端点不构造跨核连接', () => {
  const value = split();
  value.design.layerInterfaces.push({ id: 'control', name: '控制给定', fromModule: 'app-motion', toModule: 'foc-current', handoff: 'call' });
  assert.ok(has(value, 'call-control', 'error'));
  assert.ok(has(value, 'ipc-incomplete', 'pending'));
  value.design.layerInterfaces[0].handoff = 'snapshot';
  assert.equal(has(value, 'call-control'), false);
  configureIpc(value);
  assert.equal(has(value, 'ipc-incomplete'), false);
  assert.equal(validateExecution(value).filter(issue => issue.level === 'error').length, 0);
  assert.ok(has(value, 'runtime-unverified', 'pending'));
  value.design.layerInterfaces[0].handoff = 'call'; value.instances['app-motion'].enabled = false;
  assert.equal(has(value, 'call-control'), false);
  const same = split();
  for (const id of MODULE_IDS) same.execution.assignments[id] = 'cm7';
  assert.equal(has(same, 'ipc-incomplete'), false);
});

test('HSEM 与缓存策略分别声明，共享地址仅允许维护的双核可见 RAM 区间', () => {
  const value = configureIpc(split());
  value.execution.ipc.cachePolicy = 'unselected';
  assert.ok(has(value, 'ipc-incomplete', 'pending'));
  value.execution.ipc.cachePolicy = 'maintenance';
  for (const region of H745_SHARED_RAM) {
    value.execution.ipc.sharedAddress = region.start;
    value.execution.ipc.sharedSizeKiB = (region.end - region.start) / 1024;
    assert.equal(has(value, 'shared-range'), false, region.name);
  }
  value.execution.ipc.sharedAddress = 0x20000000; value.execution.ipc.sharedSizeKiB = 4;
  assert.ok(has(value, 'shared-range', 'error'));
  value.execution.ipc.sharedAddress = 0x3001FFF0; value.execution.ipc.sharedSizeKiB = 1;
  assert.ok(has(value, 'shared-range', 'error'));
  assert.ok(has(value, 'shared-alignment', 'error'));
  value.execution.ipc.sharedAddress = 0x30040001; value.execution.ipc.sharedSizeKiB = 4;
  assert.ok(has(value, 'shared-alignment', 'error'));
});

test('共享区检查拒绝负地址、非字节容量、零容量和安全整数溢出', () => {
  const value = configureIpc(split());
  value.execution.ipc.sharedAddress = -1;
  assert.ok(has(value, 'shared-address', 'error'));
  value.execution.ipc.sharedAddress = 0x30040000 + 0.5;
  assert.ok(has(value, 'shared-address', 'error'));
  value.execution.ipc.sharedAddress = 0x30040000; value.execution.ipc.sharedSizeKiB = 0.0001;
  assert.ok(has(value, 'shared-size', 'error'));
  value.execution.ipc.sharedSizeKiB = 0;
  assert.ok(has(value, 'shared-size', 'error'));
  value.execution.ipc.sharedSizeKiB = 1; value.execution.ipc.sharedAddress = Number.MAX_SAFE_INTEGER;
  assert.ok(has(value, 'shared-overflow', 'error'));
  value.execution.ipc.sharedSizeKiB = NaN;
  assert.ok(has(value, 'format', 'error'));
});

test('整层 Flash 预留不能冒充多核镜像链接布局，错误 ID 保持唯一', () => {
  const value = configureIpc(split());
  value.execution.assignments['app-comms'] = 'cm7';
  value.memory = { placements: { app: { bankId: 'flash1', sectorIds: ['sector1'] } } };
  assert.ok(has(value, 'images-app', 'pending'));
  assert.equal(has(value, 'images-hardware'), false);
  const issues = validateExecution(value);
  assert.equal(new Set(issues.map(issue => issue.id)).size, issues.length);
  assert.ok(issues.every(issue => issue.title && issue.message && issue.moduleId && issue.designPage === 'execution'));
  value.memory.placements.app.sectorIds = [];
  assert.equal(has(value, 'images-app'), false);
});
