import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_REGIONS, createMemoryLayout, createMemoryPlan, createMemoryBank, createMemorySector,
  checkMemoryLayoutShape, checkMemoryPlanShape, generateUniformSectors, getMemoryRegion, validateMemory,
} from '../web/src/features/deployment/flash.mjs';

const target = { mcu: 'TEST-MCU', board: 'BOARD-A' };
function configured() {
  const project = {
    target: { ...target }, memory: createMemoryPlan(target),
    instances: { 'app-params': { parameters: { motionCalibrationKiB: 8, parametersKiB: 8, runtimeRecordsKiB: 8, commitStrategy: 'dual_copy' } } },
  };
  const bank = Object.assign(createMemoryBank(), { id: 'flash-main', name: '主 Flash', baseAddress: 0x08000000, sizeKiB: 64, executable: true });
  bank.sectors = generateUniformSectors(bank, 4);
  project.memory.layout.banks.push(bank);
  const ranges = [[0, 1], [2, 3, 4], [5, 6], [7, 8], [9, 10], [11, 12]];
  MEMORY_REGIONS.forEach((region, index) => Object.assign(project.memory.placements[region.id], {
    bankId: bank.id, sectorIds: ranges[index].map(number => bank.sectors[number].id), budgetKiB: region.kind === 'firmware' ? ranges[index].length * 4 : null,
  }));
  return project;
}
const problems = project => validateMemory(project).filter(issue => issue.level === 'error');
const has = (project, suffix) => validateMemory(project).some(issue => issue.id.endsWith(suffix));

test('空布局不推断 MCU 容量，各工厂的数组独立且旧项目得到待配置结果', () => {
  assert.deepEqual(createMemoryLayout(), { mcu: '', board: '', banks: [] });
  const first = createMemoryPlan(target), second = createMemoryPlan(target);
  first.layout.banks.push(createMemoryBank()); first.placements.hardware.sectorIds.push('one');
  assert.equal(second.layout.banks.length, 0);
  assert.equal(second.placements.hardware.sectorIds.length, 0);
  assert.equal(first.placements.foc.sectorIds.length, 0);
  assert.equal(createMemoryBank().baseAddress, null);
  assert.equal(createMemorySector().offsetKiB, null);
  assert.notEqual(createMemoryBank().id, createMemoryBank().id);
  assert.doesNotThrow(() => checkMemoryPlanShape(second));
  const empty = validateMemory({ target: {} });
  assert.equal(empty.length, 1); assert.equal(empty[0].id, 'memory-target-missing');
  const selected = validateMemory({ target });
  assert.equal(selected.length, 1); assert.equal(selected[0].id, 'memory-layout-missing');
  assert.equal(validateMemory({ target, memory: null })[0].id, 'memory-format');
});

test('等大扇区生成按用户提供的容量和擦除尺寸工作，不覆盖已有定义', () => {
  const bank = Object.assign(createMemoryBank(), { id: 'b', sizeKiB: 1 });
  const saved = structuredClone(bank), sectors = generateUniformSectors(bank, 0.125);
  assert.equal(sectors.length, 8); assert.equal(sectors[7].offsetKiB, 0.875);
  assert.deepEqual(bank, saved);
  assert.deepEqual(generateUniformSectors(bank, 0.125), sectors);
  assert.notEqual(generateUniformSectors(bank, 0.25)[0].id, sectors[0].id);
  for (const value of [null, 0, -1, NaN, Infinity, 0.00001, 0.3, 2]) assert.throws(() => generateUniformSectors(bank, value));
  assert.throws(() => generateUniformSectors({ ...bank, sizeKiB: 4097 }, 1), /4096/);
  assert.throws(() => generateUniformSectors({ ...bank, sectors }, 0.125), /不能覆盖/);
});

test('结构检查拒绝未知字段、错误类型、重复 ID 和重复扇区引用', () => {
  for (const mutate of [
    plan => { plan.extra = 1; },
    plan => { delete plan.placements.app; },
    plan => { plan.layout.banks[0].baseAddress = Infinity; },
    plan => { plan.layout.banks[0].executable = 'yes'; },
    plan => { plan.layout.banks[0].sectors[0].reserved = 'true'; },
    plan => { plan.layout.banks.push(structuredClone(plan.layout.banks[0])); },
    plan => { plan.layout.banks[0].sectors.push(structuredClone(plan.layout.banks[0].sectors[0])); },
    plan => { plan.placements.hardware.sectorIds.push(plan.placements.hardware.sectorIds[0]); },
    plan => { plan.placements.hardware.sectorIds = 'a'; },
    plan => { plan.placements.hardware.budgetKiB = '8'; },
    plan => { plan.placements.hardware = new Date(); },
    plan => { plan.placements = JSON.parse('{"__proto__":{}}'); },
  ]) {
    const plan = configured().memory; mutate(plan);
    assert.throws(() => checkMemoryPlanShape(plan));
  }
  assert.throws(() => checkMemoryLayoutShape(Object.create({ mcu: '' })), /必须是对象/);
  const logicalConflict = configured().memory;
  logicalConflict.layout.banks[0].baseAddress = -1;
  assert.doesNotThrow(() => checkMemoryPlanShape(logicalConflict));
});

test('完整分区只能通过声明检查，仍保留链接、启动与独立 OTA 待验证', () => {
  const project = configured();
  assert.deepEqual(problems(project), []);
  const issues = validateMemory(project);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, 'memory-runtime-unverified');
  assert.equal(issues[0].level, 'pending');
  assert.match(issues[0].message, /不代表已支持独立 OTA/);
});

test('选中扇区按地址解析，末尾地址不包含末字节，数据容量取参数管理预算', () => {
  const project = configured();
  project.memory.placements.hardware.sectorIds.reverse();
  const hardware = getMemoryRegion(project, 'hardware');
  assert.equal(hardware.capacityKiB, 8); assert.equal(hardware.requiredKiB, 8);
  assert.equal(hardware.startAddress, 0x08000000); assert.equal(hardware.endAddress, 0x08002000);
  assert.equal(hardware.contiguous, true);
  project.memory.placements.parameters.budgetKiB = 200;
  assert.equal(getMemoryRegion(project, 'parameters').requiredKiB, 8);
  assert.throws(() => getMemoryRegion(project, 'unknown'), /未知/);
});

test('更换 MCU 或板卡保留旧布局并明确要求复核，型号大小写不构成变更', () => {
  const project = configured(), original = structuredClone(project.memory);
  project.target.mcu = 'OTHER-MCU';
  assert.equal(has(project, 'target-mismatch'), true);
  assert.deepEqual(project.memory, original);
  project.target.mcu = ' test-mcu ';
  assert.equal(has(project, 'target-mismatch'), false);
  project.target.board = 'BOARD-B';
  assert.equal(has(project, 'target-mismatch'), true);
});

test('非等大擦除单元可相邻分配，不套用统一擦除尺寸', () => {
  const project = configured(), bank = project.memory.layout.banks[0];
  bank.sectors[0].sizeKiB = 2;
  bank.sectors[1].offsetKiB = 2; bank.sectors[1].sizeKiB = 6;
  assert.equal(getMemoryRegion(project, 'hardware').capacityKiB, 8);
  assert.deepEqual(problems(project), []);
});

test('扇区越界、彼此重叠、负偏移和非整数字节会被拒绝', () => {
  for (const [mutate, suffix] of [
    [bank => { bank.sectors[15].sizeKiB = 8; }, '-bounds'],
    [bank => { bank.sectors[0].sizeKiB = 12; }, '-overlap-'],
    [bank => { bank.sectors[0].offsetKiB = -1; }, '-geometry'],
    [bank => { bank.sectors[0].sizeKiB = 0.0001; }, '-geometry'],
    [bank => { bank.baseAddress = Number.MAX_SAFE_INTEGER; }, '-geometry'],
    [bank => { bank.sizeKiB = 0; }, '-geometry'],
  ]) {
    const project = configured(); mutate(project.memory.layout.banks[0]);
    assert.ok(problems(project).some(issue => issue.id.includes(suffix)), suffix);
  }
  const nested = configured(), bank = nested.memory.layout.banks[0];
  bank.sectors[0].sizeKiB = 20;
  assert.ok(problems(nested).filter(issue => issue.id.includes('-overlap-')).length >= 4);
});

test('CPU 地址空间中重叠的 Flash 会报错，相邻 Bank 可以独立分配', () => {
  const project = configured(), first = project.memory.layout.banks[0];
  const second = Object.assign(createMemoryBank(), { id: 'flash-second', name: '第二 Flash', baseAddress: first.baseAddress + 64 * 1024, sizeKiB: 16, executable: true });
  second.sectors = generateUniformSectors(second, 4);
  project.memory.layout.banks.push(second);
  assert.equal(has(project, 'banks-overlap-flash-second'), false);
  second.baseAddress -= 4 * 1024;
  assert.equal(has(project, 'banks-overlap-flash-second'), true);
});

test('相同扇区不能跨用途复用，启动或升级保留扇区不能分配', () => {
  const project = configured();
  project.memory.placements.foc.sectorIds = [...project.memory.placements.hardware.sectorIds];
  assert.equal(has(project, `conflict-${project.memory.placements.hardware.sectorIds[0]}`), true);
  const reserved = configured(); reserved.memory.layout.banks[0].sectors[0].reserved = true;
  assert.ok(problems(reserved).some(issue => issue.id.includes('-reserved-')));
  assert.equal(getMemoryRegion(reserved, 'hardware').capacityKiB, null);
  assert.equal(getMemoryRegion(reserved, 'hardware').startAddress, null);
});

test('移除 Flash 或扇区后不偷偷重绑引用，缺失范围保持未知', () => {
  const project = configured();
  project.memory.placements.hardware.bankId = 'missing';
  assert.equal(has(project, 'region-hardware-bank-dangling'), true);
  assert.equal(getMemoryRegion(project, 'hardware').capacityKiB, null);
  project.memory.placements.hardware.bankId = 'flash-main';
  project.memory.layout.banks[0].sectors.shift();
  assert.ok(problems(project).some(issue => issue.id.includes('region-hardware-sector-dangling')));
  assert.equal(getMemoryRegion(project, 'hardware').endAddress, null);
  project.memory.layout.banks = [];
  assert.equal(problems(project).filter(issue => issue.id.endsWith('-bank-dangling')).length, 6);
  assert.equal(project.memory.placements.hardware.bankId, 'flash-main');
});

test('不连续的分配不能伪装成一个连续链接区间', () => {
  const project = configured(), bank = project.memory.layout.banks[0];
  project.memory.placements.hardware.sectorIds = [bank.sectors[0].id, bank.sectors[14].id];
  const state = getMemoryRegion(project, 'hardware');
  assert.equal(state.contiguous, false); assert.equal(state.capacityKiB, null);
  assert.equal(state.startAddress, null); assert.equal(state.endAddress, null);
  assert.equal(has(project, 'region-hardware-discontinuous'), true);
});

test('固件执行能力必须单独声明，不因 MCU 或 Flash 地址自动认可', () => {
  const project = configured(), bank = project.memory.layout.banks[0];
  bank.executable = false;
  assert.equal(problems(project).filter(issue => issue.id.endsWith('not-executable')).length, 3);
});

test('容量预算及双副本独立擦除空间分别校验，零容量数据区可不分配', () => {
  const project = configured();
  project.memory.placements.hardware.budgetKiB = 9;
  assert.equal(has(project, 'region-hardware-capacity'), true);
  project.memory.placements.parameters.sectorIds.pop();
  project.instances['app-params'].parameters.parametersKiB = 4;
  assert.equal(has(project, 'region-parameters-dual-copy'), true);
  assert.equal(has(project, 'region-parameters-capacity'), false);
  project.instances['app-params'].parameters.commitStrategy = 'journal';
  assert.equal(has(project, 'region-parameters-dual-copy'), false);
  project.memory.placements['fault-records'] = { bankId: '', sectorIds: [], budgetKiB: null };
  project.instances['app-params'].parameters.runtimeRecordsKiB = 0;
  assert.equal(validateMemory(project).some(issue => issue.id.startsWith('memory-region-fault-records')), false);
});

test('读取和校验不改写配置，合法冲突草案可 JSON 往返且 issue ID 唯一', () => {
  const project = configured();
  project.memory.placements.hardware.budgetKiB = 100;
  project.memory.placements.app.sectorIds = [...project.memory.placements.foc.sectorIds];
  const before = structuredClone(project);
  checkMemoryPlanShape(project.memory);
  for (const region of MEMORY_REGIONS) getMemoryRegion(project, region.id);
  const issues = validateMemory(project);
  assert.equal(new Set(issues.map(issue => issue.id)).size, issues.length);
  assert.ok(issues.every(issue => ['error', 'pending', 'warning', 'info'].includes(issue.level) && issue.designPage === 'memory'));
  assert.deepEqual(project, before);
  assert.deepEqual(JSON.parse(JSON.stringify(project)), project);
});
