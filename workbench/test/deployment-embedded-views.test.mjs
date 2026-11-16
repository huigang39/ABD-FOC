import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { deploymentAction } from '../web/src/features/deployment/actions.mjs';
import { renderExecution } from '../web/src/features/deployment/execution-view.mjs';
import { renderMemory } from '../web/src/features/deployment/flash-view.mjs';
import { renderRam } from '../web/src/features/deployment/ram-view.mjs';
import { renderBuild } from '../web/src/features/build/view.mjs';
import { renderBackupStorage } from '../web/src/features/configuration/backup-view.mjs';
import { renderNativeBuild } from '../web/src/features/device/view.mjs';

function fixture() {
  let project = createProject();
  project.target = { vendor: 'st', mcu: 'STM32H745ZI', board: 'BOARD-A' };
  project = deploymentAction(project, 'execution-preset');
  project = deploymentAction(project, 'memory-add-bank');
  Object.assign(project.memory.layout.banks[0], { name: '<Flash>', baseAddress: 0x08000000, sizeKiB: 64 });
  project.memory.ram = {
    mcu: project.target.mcu,
    banks: [{ id: 'ram-a', name: '<RAM>', baseAddress: 0x24000000, sizeKiB: 64, cores: ['cm7', 'cm4'], executable: true, dma: true }],
    placements: [{ id: 'data-a', name: '控制数据', kind: 'data', coreId: 'cm7', bankId: 'ram-a', offsetKiB: 0, sizeKiB: 8, loadBankId: '' }],
  };
  return project;
}

const bindingAttributes = html => [...html.matchAll(/\bdata-(?:edit|action|key|id|child|live|state-key|issue-ids|value-type)="[^"]*"/g)].map(match => match[0]);
const noPageChrome = html => {
  assert.doesNotMatch(html, /<h[12]\b|href="#\/project\/(?:memory|execution)"|>选择(?: MCU|硬件) →<|>返回/);
  assert.match(html, /deployment-embedded/);
};

test('embedded core editor preserves assignments and IPC bindings without page headings or self-navigation', () => {
  const project = fixture();
  const before = structuredClone(project);
  for (const mcu of ['STM32H745ZI', 'STM32G474RE', '']) {
    project.target.mcu = mcu;
    const full = renderExecution(project), embedded = renderExecution(project, { embedded: true });
    noPageChrome(embedded);
    assert.deepEqual(bindingAttributes(embedded), bindingAttributes(full));
    assert.match(full, /<h2>内核运行<\/h2>/);
  }
  project.target.mcu = before.target.mcu;
  assert.deepEqual(project, before);
});

test('embedded Flash and RAM retain every editing and live-update binding and do not change plans', () => {
  const project = fixture(), before = structuredClone(project);
  const issues = [{ id: 'memory-budget', level: 'error', title: 'Flash 容量' }, { id: 'ram-overlap', level: 'error', title: 'RAM 地址' }];
  const sectorSizes = { [project.memory.layout.banks[0].id]: 4 };
  for (const [full, embedded] of [
    [renderMemory(project, issues, { sectorSizes }), renderMemory(project, issues, { sectorSizes, embedded: true })],
    [renderRam(project, issues), renderRam(project, issues, { embedded: true })],
  ]) {
    noPageChrome(embedded);
    assert.deepEqual(bindingAttributes(embedded), bindingAttributes(full));
    assert.match(embedded, /data-action="show-issues"/);
    assert.doesNotMatch(embedded, /<(?:Flash|RAM)>/);
  }
  const generator = renderMemory(project, issues, { sectorSizes, embedded: true }).match(/<input\b[^>]*data-edit="memory-generator"[^>]*>/)?.[0];
  assert.match(generator, /value="4"/);
  assert.deepEqual(project, before);
});

test('embedded empty memory editors remain disabled until MCU selection without redundant hardware links', () => {
  const project = createProject();
  for (const [html, prefix] of [[renderMemory(project, [], { embedded: true }), 'memory'], [renderRam(project, [], { embedded: true }), 'ram']]) {
    noPageChrome(html);
    assert.match(html, new RegExp(`<fieldset class="${prefix}-editing" disabled>`));
    assert.match(html, new RegExp(`data-action="${prefix}-add-bank"[^>]* disabled`));
    assert.doesNotMatch(html, /href="#\/project\/hardware/);
  }
});

test('build and backup omit removed deployment entries while parameter mappings lead to basic core settings', () => {
  const project = fixture();
  const build = renderBuild(project);
  const backup = renderBackupStorage(project);
  const native = renderNativeBuild(project, { job: { status: 'generated', manifest: { applied: [{ path: 'execution.bootCore', target: 'BOOT_CORE', value: 'cm7' }, { path: 'memory.layout', target: 'FLASH_BASE', value: '0x08000000' }] } } });
  assert.doesNotMatch(build, /配置协作|配置部署|内存划分/);
  assert.doesNotMatch(backup, /调整存储分区/);
  for (const html of [build, backup, native]) {
    assert.doesNotMatch(html, /href="#\/project\/(?:memory|execution)"|section=(?:memory|execution)/);
  }
  assert.equal((native.match(/href="#\/project\/hardware\?module=hw-platform"/g) || []).length, 2);
});
