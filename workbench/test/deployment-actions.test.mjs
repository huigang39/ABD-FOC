import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { MODULES } from '../web/src/core/catalog.mjs';
import { deploymentAction, deploymentEdit, parseAddress } from '../web/src/features/deployment/actions.mjs';
import { renderMemory } from '../web/src/features/deployment/flash-view.mjs';
import { renderExecution } from '../web/src/features/deployment/execution-view.mjs';

function projectWithFlash() {
  let project = createProject();
  project.target = { vendor: 'st', mcu: 'STM32H745ZI', board: 'BOARD-A' };
  project = deploymentAction(project, 'memory-add-bank');
  const id = project.memory.layout.banks[0].id;
  for (const [key, value] of Object.entries({ name: 'Flash Bank 1', baseAddress: 0x08000000, sizeKiB: 64, executable: true })) {
    project = deploymentEdit(project, 'memory-bank', { id, key }, value);
  }
  project = deploymentAction(project, 'memory-generate-sectors', { id, value: 4 });
  return project;
}
const setBank = (project, region, id) => deploymentEdit(project, 'memory-placement', { id: region, key: 'bankId' }, id);
const setSector = (project, region, child, selected = true) => deploymentEdit(project, 'memory-assignment', { id: region, child }, selected);

test('地址输入支持十六进制和十进制，拒绝科学计数、负数、小数与越界', () => {
  assert.equal(parseAddress(' 0x08000000 '), 0x08000000);
  assert.equal(parseAddress('0X30020000'), 0x30020000);
  assert.equal(parseAddress('134217728'), 0x08000000);
  assert.equal(parseAddress('0'), 0);
  assert.equal(parseAddress('   '), null);
  for (const input of ['-1', '1.5', '1e8', '0x', '0xGG', '0b100', '+42', '0x20000000000000', '9007199254740992']) assert.throws(() => parseAddress(input));
});

test('分区操作纯函数保留原快照，可供撤销恢复；首次添加绑定硬件且生成器不覆盖已有表', () => {
  const empty = createProject(), original = structuredClone(empty);
  assert.throws(() => deploymentAction(empty, 'memory-add-bank'), /MCU/);
  assert.deepEqual(empty, original);
  const project = projectWithFlash(), saved = structuredClone(project);
  assert.equal(project.memory.layout.mcu, 'STM32H745ZI');
  assert.equal(project.memory.layout.board, 'BOARD-A');
  const bank = project.memory.layout.banks[0];
  assert.equal(bank.sectors.length, 16);
  assert.throws(() => deploymentAction(project, 'memory-generate-sectors', { id: bank.id, value: 8 }), /覆盖/);
  let next = setBank(project, 'hardware', bank.id);
  next = setSector(next, 'hardware', bank.sectors[0].id);
  assert.deepEqual(project, saved);
  const beforeRemoval = structuredClone(next);
  const removed = deploymentAction(next, 'memory-remove-bank', { id: bank.id });
  assert.equal(removed.memory.layout.banks.length, 0);
  assert.deepEqual(next, beforeRemoval);
  assert.equal(removed.memory.placements.hardware.bankId, bank.id);
  assert.deepEqual(removed.memory.placements.hardware.sectorIds, [bank.sectors[0].id]);
});

test('切换 Flash 清空本用途扇区，重复选择相同 Flash 保留勾选', () => {
  let project = projectWithFlash();
  const first = project.memory.layout.banks[0];
  project = setBank(project, 'hardware', first.id);
  project = setSector(project, 'hardware', first.sectors[0].id);
  project = setBank(project, 'hardware', first.id);
  assert.deepEqual(project.memory.placements.hardware.sectorIds, [first.sectors[0].id]);
  project = deploymentAction(project, 'memory-add-bank');
  const second = project.memory.layout.banks[1];
  project = setBank(project, 'hardware', second.id);
  assert.deepEqual(project.memory.placements.hardware.sectorIds, []);
  assert.equal(project.memory.placements.hardware.bankId, second.id);
  project = setBank(project, 'hardware', '');
  assert.deepEqual(project.memory.placements.hardware, { bankId: '', sectorIds: [], budgetKiB: null });
});

test('保留扇区、重复用途和不存在的扇区不能选入，失败不改变现有数据', () => {
  let project = projectWithFlash();
  const bank = project.memory.layout.banks[0], first = bank.sectors[0].id, second = bank.sectors[1].id;
  project = setBank(project, 'hardware', bank.id);
  project = setBank(project, 'foc', bank.id);
  project = setSector(project, 'hardware', first);
  project = deploymentEdit(project, 'memory-sector', { id: bank.id, child: second, key: 'reserved' }, true);
  const before = structuredClone(project);
  assert.throws(() => setSector(project, 'foc', first), /其他用途/);
  assert.throws(() => setSector(project, 'foc', second), /保留/);
  assert.throws(() => setSector(project, 'foc', 'deleted-sector'), /不存在/);
  assert.deepEqual(project, before);
  project = setSector(project, 'hardware', first, false);
  project = setSector(project, 'foc', first);
  assert.deepEqual(project.memory.placements.foc.sectorIds, [first]);
});

test('删除扇区保留悬空分配并展示可取消的勾选，取消后不需要该扇区仍存在', () => {
  let project = projectWithFlash();
  const bank = project.memory.layout.banks[0], sectorId = bank.sectors[0].id;
  project = setBank(project, 'hardware', bank.id);
  project = setSector(project, 'hardware', sectorId);
  project = deploymentAction(project, 'memory-remove-sector', { id: bank.id, child: sectorId });
  assert.deepEqual(project.memory.placements.hardware.sectorIds, [sectorId]);
  const html = renderMemory(project);
  assert.match(html, /扇区已不存在/);
  const checkbox = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`data-child="${sectorId}"`));
  assert.ok(checkbox.includes('data-edit="memory-assignment"'));
  assert.ok(checkbox.includes(' checked'));
  assert.ok(!checkbox.includes(' disabled'));
  project = setSector(project, 'hardware', sectorId, false);
  assert.deepEqual(project.memory.placements.hardware.sectorIds, []);
});

test('部署编辑只接受已定义的用途和字段，不写入原型属性', () => {
  const project = projectWithFlash(), before = structuredClone(project);
  assert.throws(() => deploymentEdit(project, 'memory-placement', { id: 'unknown-region', key: 'bankId' }, 'x'));
  assert.throws(() => deploymentEdit(project, 'memory-bank', { id: project.memory.layout.banks[0].id, key: 'unknown' }, 'x'));
  const descriptors = Object.fromEntries(['bankId', 'sectorIds'].map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  try {
    assert.throws(() => deploymentEdit(project, 'memory-placement', { id: '__proto__', key: 'bankId' }, 'unsafe'));
    for (const key of Object.keys(descriptors)) assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, key), descriptors[key]);
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete Object.prototype[key];
    }
  }
  assert.deepEqual(project, before);
});

test('双核建议按当前模块目录完整分配，单项修改和 IPC 地址编辑保留其他设置', () => {
  const original = projectWithFlash();
  let project = deploymentAction(original, 'execution-preset');
  assert.deepEqual(Object.keys(project.execution.assignments).sort(), MODULES.map(module => module.id).sort());
  for (const module of MODULES) assert.equal(project.execution.assignments[module.id], module.layer === 'app' ? 'cm4' : 'cm7');
  assert.equal(project.execution.bootCore, 'cm7');
  const assigned = structuredClone(project.execution.assignments);
  project = deploymentEdit(project, 'execution-ipc', { key: 'sharedAddress' }, parseAddress('0x30020000'));
  project = deploymentEdit(project, 'execution-ipc', { key: 'sharedSizeKiB' }, 8);
  assert.equal(project.execution.ipc.sharedAddress, 0x30020000);
  assert.deepEqual(project.execution.assignments, assigned);
  project = deploymentEdit(project, 'execution-module', { id: 'app-motion', key: 'core' }, 'cm7');
  assert.equal(project.execution.assignments['app-motion'], 'cm7');
  assert.equal(project.execution.assignments['foc-current'], 'cm7');
  assert.equal(project.execution.mcu, original.target.mcu);
  const html = renderExecution(project);
  assert.equal((html.match(/data-edit="execution-module"/g) || []).length, MODULES.length);
  assert.match(html, /value="0x30020000"/);
  project = deploymentAction(project, 'execution-reset');
  assert.ok(Object.values(project.execution.assignments).every(value => value === ''));
  assert.equal(project.execution.ipc.sharedAddress, null);
  assert.ok(Object.values(original.execution.assignments).every(value => value === ''));
});

test('Flash 与内核视图转义用户名称，未选硬件时所有 Flash 编辑控件禁用', () => {
  const empty = createProject();
  assert.match(renderMemory(empty), /<fieldset class="memory-editing" disabled>/);
  assert.match(renderMemory(empty), /data-action="memory-add-bank"[^>]* disabled/);
  const project = projectWithFlash();
  project.memory.layout.banks[0].name = '<img src=x onerror=bad>';
  project.execution.mcu = '<script>bad</script>';
  const memory = renderMemory(project), execution = renderExecution(project);
  assert.ok(memory.includes('&lt;img src=x onerror=bad&gt;'));
  assert.ok(!memory.includes('<img src=x onerror=bad>'));
  assert.ok(execution.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!execution.includes('<script>bad</script>'));
});
