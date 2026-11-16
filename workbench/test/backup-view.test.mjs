import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { backupStorageState, renderBackupStorage } from '../web/src/features/configuration/backup-view.mjs';

test('NEO backup view resolves three Flash locations from project placements without inventing device usage', () => {
  const project = createNeo75hProject();
  const before = structuredClone(project);
  const state = backupStorageState(project);
  assert.equal(state.totalKiB, 2048);
  assert.equal(state.allocatedKiB, 384);
  assert.equal(state.availableKiB, 768);
  assert.deepEqual(state.regions.map(region => [region.id, region.startAddress, region.endAddress, region.requiredKiB, region.allocatedKiB]), [
    ['motion-calibration', 0x081A0000, 0x081C0000, 128, 128],
    ['parameters', 0x081C0000, 0x081E0000, 128, 128],
    ['fault-records', 0x081E0000, 0x08200000, 128, 128],
  ]);
  for (const region of state.regions) {
    assert.equal(region.storedBytes, null);
    assert.equal(region.deviceAvailableBytes, null);
    assert.equal(region.spareKiB, 0);
  }
  const html = renderBackupStorage(project);
  assert.match(html, /0x081A0000 – 0x081BFFFF/);
  assert.match(html, /0x081E0000 – 0x081FFFFF/);
  assert.match(html, /设备已存<\/dt><dd>未知 <small>未读回/);
  assert.doesNotMatch(html, /调整存储分区|section=memory|href="#\/project\/memory"/);
  assert.deepEqual(project, before);
});

test('configured demand, allocated sectors and spare reservation remain separate quantities', () => {
  const project = createNeo75hProject();
  project.instances['app-params'].parameters.parametersKiB = 8;
  const region = backupStorageState(project).regions.find(region => region.id === 'parameters');
  assert.equal(region.requiredKiB, 8);
  assert.equal(region.allocatedKiB, 128);
  assert.equal(region.spareKiB, 120);
  assert.equal(region.storedBytes, null);
  project.instances['app-params'].parameters.parametersKiB = 256;
  const insufficient = backupStorageState(project).regions.find(region => region.id === 'parameters');
  assert.equal(insufficient.allocatedKiB, 128);
  assert.equal(insufficient.spareKiB, null);
  assert.equal(insufficient.status, 'error');
});

test('locations follow the selected project partition instead of hardcoded NEO addresses', () => {
  const project = createNeo75hProject();
  Object.assign(project.memory.placements.parameters, { bankId: 'neo-bank-1', sectorIds: ['neo-bank-1-sector-7'] });
  const region = backupStorageState(project).regions.find(region => region.id === 'parameters');
  assert.equal(region.bank.id, 'neo-bank-1');
  assert.equal(region.startAddress, 0x080E0000);
  assert.equal(region.endAddress, 0x08100000);
  assert.equal(region.allocatedKiB, 128);
});

test('missing, disconnected and conflicting sector assignments do not produce trusted ranges or capacity', () => {
  for (const mutate of [
    project => { project.memory.placements.parameters.sectorIds = ['missing']; },
    project => { project.memory.placements.parameters.sectorIds = ['neo-bank-2-sector-4', 'neo-bank-2-sector-6']; },
    project => { project.memory.placements.parameters.sectorIds = [...project.memory.placements['motion-calibration'].sectorIds]; },
    project => { project.memory.layout.board = 'different board'; },
  ]) {
    const project = createNeo75hProject();
    mutate(project);
    const state = backupStorageState(project);
    const region = state.regions.find(region => region.id === 'parameters');
    assert.equal(region.allocatedKiB, null);
    assert.equal(region.startAddress, null);
    assert.equal(region.spareKiB, null);
    assert.equal(region.status, 'error');
    assert.equal(state.allocatedKiB, null);
  }
  const conflict = createNeo75hProject();
  conflict.memory.placements.parameters.sectorIds = [...conflict.memory.placements['motion-calibration'].sectorIds];
  const state = backupStorageState(conflict);
  assert.equal(state.regions[0].allocatedKiB, null, 'first owner must also be marked untrusted');
  assert.equal(state.regions[0].status, 'error');
  assert.equal(state.availableKiB, null);
});

test('unconfigured layout and deliberately disabled storage stay explicit', () => {
  const project = createProject();
  const empty = backupStorageState(project);
  assert.equal(empty.totalKiB, null);
  assert.equal(empty.availableKiB, null);
  assert.equal(empty.regions[0].allocatedKiB, 0);
  assert.equal(empty.regions[0].requiredKiB, null);
  assert.match(renderBackupStorage(project), /尚未定义 Flash/);
  project.instances['app-params'].parameters.runtimeRecordsKiB = 0;
  const region = backupStorageState(project).regions.find(region => region.id === 'fault-records');
  assert.equal(region.status, 'unused');
  assert.equal(region.allocatedKiB, 0);
  assert.equal(region.storedBytes, null);
});

test('free allocation counts declared usable sectors only, while display escapes user names', () => {
  const project = createNeo75hProject();
  const bank = project.memory.layout.banks[0];
  bank.name = '<img src=x onerror=bad>';
  bank.sectors[0].name = '<script>bad()</script>';
  bank.sectors.pop(); // The physical gap is not a known allocatable erase sector.
  assert.equal(backupStorageState(project).availableKiB, 640);
  const html = renderBackupStorage(project);
  assert.match(html, /&lt;img src=x onerror=bad&gt;/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img src=x|<script>bad/);
});
