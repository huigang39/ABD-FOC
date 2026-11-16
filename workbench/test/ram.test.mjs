import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { createMemoryBank, createMemoryPlan, checkMemoryPlanShape, validateMemory } from '../web/src/features/deployment/flash.mjs';
import { createRamPlan, createRamBank, createRamPlacement, checkRamShape, applyRamPreset, validateRam, ramAction, ramEdit } from '../web/src/features/deployment/ram.mjs';

const has = (project, suffix, level) => validateRam(project).some(issue => issue.id.endsWith(suffix) && (!level || issue.level === level));
function configured() {
  const project = createProject();
  project.target = { vendor: 'st', mcu: 'STM32H745IIK6', board: 'NEO' };
  project.instances['hw-platform'].parameters.architecture = 'arm';
  const next = applyRamPreset(project);
  next.memory.layout = { ...next.target, banks: [] };
  delete next.memory.layout.vendor;
  next.memory.layout.banks.push({ ...createMemoryBank(), id: 'flash-load', baseAddress: 0x08000000, sizeKiB: 256, executable: false });
  return next;
}
function addPlacement(project, id, values = {}) {
  const placement = { ...createRamPlacement(), id, name: id, coreId: 'cm7', bankId: 'ram-data', offsetKiB: 0, sizeKiB: 4, ...values };
  project.memory.ram.placements.push(placement);
  return placement;
}

test('runtime memory is optional, and the explicit H745 preset declares physical banks without allocating them', () => {
  const original = createProject();
  assert.equal(Object.hasOwn(createMemoryPlan(), 'ram'), false);
  assert.deepEqual(validateRam(original), []);
  assert.equal(validateMemory(original).some(issue => issue.id.startsWith('ram-')), false);
  original.target.mcu = 'stm32h745iik6';
  const before = structuredClone(original), project = applyRamPreset(original), plan = project.memory.ram;
  assert.deepEqual(original, before);
  assert.deepEqual(plan.placements, []);
  assert.deepEqual(plan.banks.map(bank => [bank.baseAddress, bank.sizeKiB]), [[0, 64], [0x20000000, 128], [0x24000000, 512], [0x30000000, 128], [0x30020000, 128], [0x30040000, 32], [0x38000000, 64]]);
  assert.ok(plan.banks.every(bank => !Object.hasOwn(bank, 'kind') && bank.executable));
  assert.deepEqual(plan.banks[1].cores, ['cm7']);
  assert.equal(plan.banks[1].dma, false);
  assert.deepEqual(plan.banks[2].cores, ['cm7', 'cm4']);
  assert.equal(plan.banks[2].dma, true);
  assert.ok(has(project, 'runtime-unverified', 'pending'));
  assert.throws(() => applyRamPreset(project), /不能覆盖/);
  assert.throws(() => applyRamPreset({ ...original, target: { mcu: 'OTHER' } }), /仅适用于/);
});

test('strict shape rejects unknown fields, duplicate IDs, wrong capability types and invalid kinds', () => {
  for (const mutate of [
    plan => { plan.extra = true; },
    plan => { plan.banks[0].kind = 'itcm'; },
    plan => { plan.banks[0].executable = 'yes'; },
    plan => { plan.banks[0].cores = 'cm7'; },
    plan => { plan.banks[0].cores = ['cm7', 'cm7']; },
    plan => { plan.banks[0].sizeKiB = NaN; },
    plan => { plan.banks.push(structuredClone(plan.banks[0])); },
    plan => { plan.placements[0].kind = 'other'; },
    plan => { plan.placements[0].coreId = 7; },
    plan => { plan.placements.push(structuredClone(plan.placements[0])); },
    plan => { delete plan.placements[0].loadBankId; },
  ]) {
    const plan = { ...createRamPlan(), banks: [createRamBank()], placements: [createRamPlacement()] };
    mutate(plan);
    assert.throws(() => checkRamShape(plan));
  }
  const project = configured();
  assert.doesNotThrow(() => checkMemoryPlanShape(project.memory));
  project.memory.ram.banks[0].baseAddress = -1;
  assert.doesNotThrow(() => checkMemoryPlanShape(project.memory));
  assert.ok(has(project, 'geometry', 'error'));
  project.memory.ram = null;
  assert.throws(() => checkMemoryPlanShape(project.memory));
  assert.equal(validateRam(project)[0].id, 'ram-format');
});

test('bank and allocation geometry checks byte precision, overflow, capacity and nested overlap', () => {
  for (const invalid of [0, -1, 0.00001, Number.MAX_SAFE_INTEGER]) {
    const project = configured();
    project.memory.ram.banks[0].sizeKiB = invalid;
    assert.ok(has(project, 'geometry', 'error'));
  }
  const project = configured();
  addPlacement(project, 'large', { sizeKiB: 120 });
  addPlacement(project, 'nested-a', { offsetKiB: 2, sizeKiB: 4 });
  addPlacement(project, 'nested-b', { offsetKiB: 30, sizeKiB: 8 });
  addPlacement(project, 'past-end', { offsetKiB: 124, sizeKiB: 8 });
  assert.ok(has(project, 'placements-overlap-nested-a', 'error'));
  assert.ok(has(project, 'placements-overlap-nested-b', 'error'));
  assert.ok(has(project, 'placement-past-end-bounds', 'error'));
  assert.ok(has(project, 'bank-ram-data-capacity', 'error'));
  project.memory.ram.banks.push({ ...createRamBank(), id: 'overlap', baseAddress: 0x20001000, sizeKiB: 4, cores: ['cm7'] });
  assert.ok(has(project, 'banks-overlap-overlap', 'error'));
  const bytesProject = configured();
  addPlacement(bytesProject, 'small', { offsetKiB: 1 / 1024, sizeKiB: 1 / 1024 });
  assert.equal(validateRam(bytesProject).some(issue => issue.level === 'error'), false);
});

test('generic declared capabilities control code, core, DMA and shared access independently of region names', () => {
  const project = configured();
  const bank = project.memory.ram.banks.find(bank => bank.id === 'ram-data');
  bank.name = '自定义本地内存';
  const placement = addPlacement(project, 'critical', { kind: 'code', loadBankId: 'flash-load' });
  assert.equal(validateRam(project).some(issue => issue.level === 'error'), false);
  bank.executable = false;
  assert.ok(has(project, 'placement-critical-not-executable', 'error'));
  placement.kind = 'data'; placement.coreId = 'cm4';
  assert.ok(has(project, 'placement-critical-core-access', 'error'));
  placement.coreId = 'cm7'; placement.kind = 'dma'; placement.loadBankId = '';
  assert.ok(has(project, 'placement-critical-dma-access', 'error'));
  placement.kind = 'shared';
  assert.ok(has(project, 'placement-critical-shared-access', 'error'));
  bank.cores = ['cm7', 'cm4']; bank.dma = true; placement.kind = 'dma';
  assert.equal(validateRam(project).some(issue => issue.level === 'error'), false);
});

test('Flash source is separate from RAM execution, references are checked and copy ranges remain unverified', () => {
  const project = configured();
  const code = addPlacement(project, 'code', { kind: 'code', bankId: 'ram-instruction', sizeKiB: 32 });
  assert.ok(has(project, 'placement-code-load-missing', 'pending'));
  code.loadBankId = 'gone';
  assert.ok(has(project, 'placement-code-load-dangling', 'error'));
  code.loadBankId = 'flash-load';
  const data = addPlacement(project, 'data', { sizeKiB: 16 });
  assert.equal(validateRam(project).some(issue => issue.level === 'error'), false);
  assert.equal(has(project, 'placement-data-load-missing'), false);
  assert.ok(has(project, 'load-flash-load-link-unverified', 'pending'));
  data.loadBankId = 'flash-load';
  project.memory.layout.banks[0].sizeKiB = 40;
  assert.ok(has(project, 'load-flash-load-capacity', 'error'));
  data.kind = 'stack';
  assert.ok(has(project, 'placement-data-load-kind', 'error'));
});

test('shared execution reservations cannot be reused as private memory or partially relabeled shared', () => {
  const project = configured();
  Object.assign(project.execution.ipc, { transport: 'shared_memory', sharedAddress: 0x38000000, sharedSizeKiB: 64 });
  const placement = addPlacement(project, 'shared-use', { bankId: 'ram-sram4', kind: 'dma', sizeKiB: 8 });
  assert.ok(has(project, 'placement-shared-use-ipc-overlap', 'error'));
  placement.kind = 'shared';
  assert.equal(has(project, 'placement-shared-use-ipc-overlap'), false);
  placement.offsetKiB = 60;
  assert.ok(has(project, 'placement-shared-use-ipc-overlap', 'error'));
  const bank = project.memory.ram.banks.find(bank => bank.id === 'ram-sram4');
  bank.cores = ['cm7'];
  assert.ok(has(project, 'ipc-core-access', 'error'));
  project.memory.ram.banks = project.memory.ram.banks.filter(item => item !== bank);
  assert.ok(has(project, 'ipc-bank-missing', 'pending'));
});

test('MCU changes preserve old declarations; unknown CPUs keep explicit capabilities without inventing core metadata', () => {
  const project = configured(), before = structuredClone(project.memory.ram);
  project.target.mcu = 'HPM5361';
  assert.ok(has(project, 'target-mismatch', 'error'));
  assert.ok(has(project, 'cores-invalid', 'error'));
  assert.deepEqual(project.memory.ram, before);
  const rebound = ramAction(project, 'ram-rebind');
  assert.equal(rebound.memory.ram.mcu, 'HPM5361');
  assert.ok(has(rebound, 'cores-invalid', 'error'));
  const manual = createProject(); manual.target.mcu = 'MY_MCU';
  manual.memory.ram = { mcu: 'MY_MCU', banks: [{ ...createRamBank(), id: 'local', baseAddress: 0x1000, sizeKiB: 4, cores: ['my-core'], executable: true }], placements: [] };
  addPlacement(manual, 'data', { coreId: 'my-core', bankId: 'local', sizeKiB: 1 });
  assert.equal(validateRam(manual).some(issue => issue.level === 'error'), false);
  assert.ok(has(manual, 'cores-unknown', 'pending'));
});

test('actions and edits are immutable, preserve dangling references, and can restore the untouched template default', () => {
  const original = configured(), before = structuredClone(original);
  let project = ramAction(original, 'ram-add-placement', { name: '应用栈' });
  const id = project.memory.ram.placements[0].id;
  project = ramEdit(project, 'ram-placement', { id, key: 'bankId' }, 'ram-data');
  project = ramEdit(project, 'ram-placement', { id, key: 'loadBankId' }, 'flash-load');
  project = ramAction(project, 'ram-clear-load-source', { id });
  assert.equal(project.memory.ram.placements[0].loadBankId, '');
  const cores = ['cm7', 'cm4'];
  project = ramEdit(project, 'ram-bank', { id: 'ram-data', key: 'cores' }, cores);
  cores.push('injected');
  assert.deepEqual(project.memory.ram.banks.find(bank => bank.id === 'ram-data').cores, ['cm7', 'cm4']);
  project = ramAction(project, 'ram-remove-bank', { id: 'ram-data' });
  assert.equal(project.memory.ram.placements[0].bankId, 'ram-data');
  assert.ok(has(project, `placement-${id}-bank-dangling`, 'error'));
  assert.throws(() => ramEdit(project, 'ram-placement', { id, key: 'id' }, 'other'), /配置项不存在/);
  assert.throws(() => ramAction(project, 'unknown'), /未知/);
  assert.deepEqual(original, before);
  assert.equal(Object.hasOwn(ramAction(project, 'ram-reset').memory, 'ram'), false);
  const fresh = createProject(); fresh.target.mcu = 'CUSTOM';
  const withBank = ramAction(fresh, 'ram-add-bank');
  assert.equal(withBank.memory.ram.mcu, 'CUSTOM');
  assert.ok(has(withBank, 'geometry-missing', 'pending'));
});

test('optional RAM survives project serialization and validation exposes unique global issue IDs without mutation', () => {
  const project = configured();
  addPlacement(project, 'copy', { kind: 'code', bankId: 'ram-instruction', loadBankId: 'flash-load' });
  const before = structuredClone(project);
  const issues = validateRam(project);
  assert.equal(new Set(issues.map(issue => issue.id)).size, issues.length);
  assert.ok(issues.every(issue => issue.id.startsWith('ram-') && issue.designPage === 'memory'));
  assert.deepEqual(project, before);
  const globalIssues = validateProject(project);
  for (const issue of issues) assert.ok(globalIssues.some(item => item.id === issue.id), issue.id);
  assert.deepEqual(parseProject(serializeProject(project)).memory.ram, project.memory.ram);
});
