import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { createActuator } from '../web/src/features/equipment/model.mjs';
import { applyImportedConfiguration } from '../web/src/features/configuration/workspace.mjs';
import { createProjectLibrary, PROJECT_LIBRARY_KEY, PROJECT_BACKUP_FORMAT } from '../web/src/features/configuration/project-library.mjs';
import { createPerformanceDraft, savePerformanceRecord } from '../web/src/features/performance/model.mjs';

function storageFixture(raw = '') {
  const values = new Map(raw ? [[PROJECT_LIBRARY_KEY, raw]] : []), writes = [];
  return {
    fail: false, values, writes,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { if (this.fail) throw new Error('quota'); values.set(key, value); writes.push(key); },
  };
}

test('an existing draft becomes the first project without writing during initialization', () => {
  const current = createNeo75hProject('KW'), before = structuredClone(current), storage = storageFixture();
  const library = createProjectLibrary({ storage, current });
  assert.equal(library.restored, false); assert.equal(library.error, '');
  assert.equal(library.activeId, current.id); assert.equal(library.list()[0].name, current.name);
  assert.equal(storage.writes.length, 0); assert.deepEqual(current, before);
  library.save(current);
  const stored = JSON.parse(storage.getItem(PROJECT_LIBRARY_KEY));
  assert.equal(stored.activeId, current.id); assert.equal(stored.workspace.name, current.name);
  assert.equal(stored.projects.length, 1);
  assert.deepEqual(storage.writes, [PROJECT_LIBRARY_KEY]);
});

test('new projects preserve the last edits to the previous project and can switch back without replacement', () => {
  const storage = storageFixture(), first = createNeo75hProject('KW'); first.name = '工程 A';
  const library = createProjectLibrary({ storage, current: first }), firstId = library.activeId;
  first.name = '工程 A · 最后修改'; first.instances['foc-current'].parameters.bandwidthHz = 777;
  const second = applyImportedConfiguration(first, createProject()); second.name = '工程 B';
  const secondId = library.replace(first, second);
  assert.notEqual(secondId, firstId); assert.equal(library.list().length, 2);
  assert.equal(library.load(firstId).name, first.name);
  assert.equal(library.load(firstId).instances['foc-current'].parameters.bandwidthHz, 777);
  second.name = '工程 B · 修改'; second.instances['foc-current'].parameters.bandwidthHz = 333;
  const restored = applyImportedConfiguration(second, library.load(firstId));
  library.replace(second, restored, { savedId: firstId });
  assert.equal(library.activeId, firstId); assert.equal(library.list().length, 2);
  assert.equal(library.current.name, first.name);
  assert.equal(library.load(secondId).name, second.name);
  assert.equal(library.load(secondId).instances['foc-current'].parameters.bandwidthHz, 333);
  assert.equal(storage.writes.length, 2, 'each project transition is one atomic storage write');
});

test('reload restores the selected project and full shared shelf while snapshots keep only selected equipment', () => {
  const storage = storageFixture(), first = createNeo75hProject('KW'), spare = createActuator('货架备用');
  first.catalog.actuators.push(spare);
  const library = createProjectLibrary({ storage, current: first });
  library.save(first);
  assert(!library.load(library.activeId).catalog.actuators.some(item => item.id === spare.id));
  const second = applyImportedConfiguration(first, createProject()); second.name = '新工程';
  library.replace(first, second);
  const reopened = createProjectLibrary({ storage, current: createProject() });
  assert.equal(reopened.restored, true); assert.equal(reopened.activeId, library.activeId);
  assert.equal(reopened.current.name, '新工程'); assert.equal(reopened.list().length, 2);
  assert(reopened.current.catalog.actuators.some(item => item.id === spare.id));
  assert.equal(reopened.load(reopened.activeId).catalog.actuators.length, 0);
  const copy = reopened.current; copy.name = '不应写回';
  assert.equal(reopened.current.name, '新工程');
});

test('quota failures keep current selection, prior snapshots and persisted data unchanged', () => {
  const storage = storageFixture(), first = createNeo75hProject('KW');
  const library = createProjectLibrary({ storage, current: first }); library.save(first);
  const original = storage.getItem(PROJECT_LIBRARY_KEY), active = library.activeId;
  storage.fail = true;
  assert.throws(() => library.replace(first, createProject()), /quota/);
  assert.equal(library.activeId, active); assert.equal(library.list().length, 1);
  assert.equal(storage.getItem(PROJECT_LIBRARY_KEY), original);
  assert.equal(library.current.name, first.name);
});

test('malformed stored lists are preserved and never overwritten by fallback drafts', () => {
  const storage = storageFixture('{broken'), current = createProject();
  const library = createProjectLibrary({ storage, current });
  assert.match(library.error, /工程列表未能读取/); assert.equal(library.restored, false);
  assert.throws(() => library.save(current), /工程列表未能读取/);
  assert.equal(storage.getItem(PROJECT_LIBRARY_KEY), '{broken');
  assert.equal(storage.writes.length, 0);
});

test('unknown IDs reject the transition and autosave updates only the active project', () => {
  const storage = storageFixture(), first = createProject(); first.name = 'A';
  const library = createProjectLibrary({ storage, current: first }), firstId = library.activeId;
  const second = createProject(); second.name = 'B'; library.replace(first, second);
  const activeId = library.activeId;
  assert.throws(() => library.load('missing'), /工程不存在/);
  assert.throws(() => library.replace(second, first, {savedId:'missing'}), /工程不存在/);
  assert.equal(library.activeId, activeId);
  second.name = 'B renamed'; library.save(second);
  assert.equal(library.load(activeId).name, 'B renamed'); assert.equal(library.load(firstId).name, 'A');
});

test('stale tabs cannot save over newly added projects or restore over another tab', () => {
  const storage = storageFixture(), first = createProject();
  const writer = createProjectLibrary({storage, current:first}); writer.save(first);
  const stale = createProjectLibrary({storage, current:first});
  const backup = JSON.parse(stale.exportBackup(first));
  const second = createProject(); second.name = '另一标签页的新工程'; writer.replace(first, second);
  const latest = storage.getItem(PROJECT_LIBRARY_KEY), writes = storage.writes.length;
  assert.throws(() => stale.save(first), /其他标签页更新/);
  assert.throws(() => stale.replace(first, createProject()), /其他标签页更新/);
  assert.throws(() => stale.restoreBackup(backup, first), /其他标签页更新/);
  assert.equal(storage.getItem(PROJECT_LIBRARY_KEY), latest);
  assert.equal(storage.writes.length, writes);
  assert.equal(createProjectLibrary({storage,current:first}).list().length, 2);
});

test('full backup restores all projects, active selection, shared shelf and measurements', () => {
  let first = createNeo75hProject('KW');
  const draft = createPerformanceDraft(first); draft.measuredAt = '2026-11-15T12:00:00Z'; draft.samples = [{currentA:1,torqueNm:8,series:'正向'}];
  first = savePerformanceRecord(first, draft);
  first.catalog.actuators.push(createActuator('未选中货架设备'));
  const library = createProjectLibrary({storage:storageFixture(), current:first}), firstId = library.activeId;
  const second = applyImportedConfiguration(first, createProject()); second.name = '备用方案';
  library.replace(first, second); second.name = '未等自动保存的新名称';
  const backup = JSON.parse(library.exportBackup(second));
  assert.equal(backup.format, PROJECT_BACKUP_FORMAT);
  assert.equal(backup.library.projects.length, 2);
  assert.deepEqual(backup.library.workspace.performance, first.performance);
  const storage = storageFixture(), prior = createProject(); prior.name = '恢复前的本地工程';
  const receiver = createProjectLibrary({storage,current:prior}); receiver.save(prior);
  const restored = receiver.restoreBackup(backup, prior);
  assert.equal(receiver.activeId, library.activeId);
  assert.equal(receiver.list().length, 2); assert.equal(receiver.current.name, second.name);
  assert.equal(receiver.load(firstId).name, first.name);
  assert.deepEqual(receiver.current.catalog, second.catalog);
  assert.deepEqual(receiver.current.performance, first.performance);
  assert.deepEqual(restored.project, receiver.current);
  const recovery = JSON.parse(storage.getItem(restored.recoveryKey));
  assert.equal(recovery.workspace.name, prior.name); assert.equal(recovery.projects.length, 1);
  const reopened = createProjectLibrary({storage,current:createProject()});
  assert.deepEqual(reopened.current, receiver.current); assert.deepEqual(reopened.list(), receiver.list());
});

test('invalid or unwritable backup restores leave every original project intact', () => {
  const storage = storageFixture(), first = createProject();
  const library = createProjectLibrary({storage,current:first}); library.save(first);
  const original = storage.getItem(PROJECT_LIBRARY_KEY), count = storage.writes.length;
  const backup = JSON.parse(library.exportBackup()); backup.library.activeId = 'missing';
  assert.throws(() => library.restoreBackup(backup), /当前工程不在列表中/);
  assert.equal(storage.writes.length, count);
  storage.fail = true;
  assert.throws(() => library.restoreBackup(JSON.parse(library.exportBackup())), /quota/);
  assert.equal(storage.getItem(PROJECT_LIBRARY_KEY), original);
  assert.equal(library.activeId, first.id); assert.equal(library.list().length, 1);
});

test('unnamed initial projects and replacements share one normalized name across workspace and snapshot', () => {
  const current = createProject(); current.name = '未命名工程';
  const storage = storageFixture(), library = createProjectLibrary({ storage, current });
  assert.match(library.current.name, /^\d{8}_\d{6}(?:_\d+)?$/);
  assert.equal(library.load(library.activeId).name, library.current.name);
  assert.equal(library.list(current)[0].name, library.current.name);
  assert.equal(current.name, '未命名工程');
  assert.equal(storage.writes.length, 0);
  library.save(library.current);
  const first = library.current, incoming = createProject(); incoming.name = '';
  library.replace(first, incoming);
  assert.equal(library.load(library.activeId).name, library.current.name);
  assert.notEqual(library.current.name, first.name);
  const reopened = createProjectLibrary({ storage, current: createProject() });
  assert.deepEqual(reopened.list(), library.list());
  assert.equal(reopened.current.name, library.current.name);
});

test('old library migration renames only unnamed projects, with distinct names and a consistent active workspace', () => {
  const first = createProject(), second = createProject(), named = createProject();
  first.name = '未命名驱动方案'; second.name = '未命名配置'; named.name = '用户的现有工程';
  const raw = JSON.stringify({ version: 1, activeId: 'first', workspace: first, projects: [
    { id: 'first', configuration: first }, { id: 'second', configuration: second }, { id: 'named', configuration: named },
  ] });
  const storage = storageFixture(raw), library = createProjectLibrary({ storage, current: createProject() });
  assert.equal(library.restored, true); assert.equal(library.error, '');
  assert.equal(library.current.name, library.load('first').name);
  assert.notEqual(library.load('first').name, library.load('second').name);
  assert.equal(library.load('named').name, '用户的现有工程');
  assert.equal(storage.getItem(PROJECT_LIBRARY_KEY), raw, 'initial migration stays read-only until the normal save path');
  library.save(library.current);
  const reopened = createProjectLibrary({ storage, current: createProject() });
  assert.deepEqual(reopened.list(), library.list());
  assert.equal(reopened.current.name, library.current.name);
});
