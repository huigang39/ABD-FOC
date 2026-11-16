import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationHistory, notificationIndicator } from '../web/src/shared/notifications/history.mjs';
import { renderIssueMessage } from '../web/src/shared/ui/issue-message.mjs';

const KEY = 'actuator-console.notifications.v1';
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
const notification = (message = '配置已保存', projectId = 'project-a') => ({ level: 'success', title: '保存项目', message, projectId, projectName: 'NEO 75' });

test('bell follows the highest unread severity and resets as notifications are read', () => {
  const history = createNotificationHistory();
  assert.deepEqual(notificationIndicator(history.entries), {count:0,level:'normal'});
  history.add({...notification('普通通知'),level:'info'});
  history.add(notification('保存完成'));
  assert.deepEqual(notificationIndicator(history.entries), {count:2,level:'normal'});
  const warning = history.add({...notification('配置警告'),level:'warning'});
  const error = history.add({...notification('操作错误'),level:'error'});
  assert.deepEqual(notificationIndicator(history.entries), {count:4,level:'error'});
  history.markRead(error.id);
  assert.deepEqual(notificationIndicator(history.entries), {count:3,level:'warning'});
  history.markRead(warning.id);
  assert.deepEqual(notificationIndicator(history.entries), {count:2,level:'normal'});
  history.add({...notification('待确认配置'),level:'pending'});
  assert.deepEqual(notificationIndicator(history.entries), {count:3,level:'warning'});
  history.markAllRead();
  assert.deepEqual(notificationIndicator(history.entries), {count:0,level:'normal'});
});

test('persists newest-first history and unread state across reloads', () => {
  const storage = memoryStorage(), history = createNotificationHistory({ storage });
  assert.equal(history.persistent, true);
  const first = history.add(notification('第一条')), second = history.add(notification('第二条'));
  history.markRead(first.id);
  const restored = createNotificationHistory({ storage });
  assert.deepEqual(restored.entries.map(entry => [entry.id, entry.read]), [[second.id, false], [first.id, true]]);
  assert.equal(JSON.parse(storage.getItem(KEY)).version, 1);
});

test('recent duplicates merge within the same project, move to top and become unread', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-15T00:00:00Z') });
  let changes = 0;
  const history = createNotificationHistory({ storage: memoryStorage(), onChange: () => changes++ });
  const first = history.add(notification());
  t.mock.timers.tick(1000);
  history.add(notification('其他消息'));
  history.markRead(first.id);
  t.mock.timers.tick(5000);
  const repeated = history.add(notification());
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.count, 2);
  assert.equal(repeated.read, false);
  assert.equal(repeated.createdAt, first.createdAt);
  assert.equal(repeated.updatedAt, '2026-11-15T00:00:06.000Z');
  assert.equal(history.entries[0].id, first.id);
  assert.equal(changes, 4);
  assert.notEqual(history.add(notification(undefined, 'project-b')).id, first.id);
  t.mock.timers.tick(10001);
  assert.notEqual(history.add(notification()).id, first.id);
});

test('reading does not extend the duplicate window; matching issues may arrive in a different order', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-15T00:00:00Z') });
  const history = createNotificationHistory();
  const issues = [{ id: 'a', message: '参数缺失' }, { id: 'b', message: '引脚冲突' }];
  const first = history.add({ ...notification(), issues });
  t.mock.timers.tick(5000);
  assert.equal(history.add({ ...notification(), issues: [...issues].reverse() }).id, first.id);
  t.mock.timers.tick(9000);
  history.markRead(first.id);
  assert.equal(history.entries[0].updatedAt, '2026-11-15T00:00:05.000Z');
  t.mock.timers.tick(2000);
  assert.notEqual(history.add({ ...notification(), issues }).id, first.id);
});

test('returned records, issue arrays and callback snapshots cannot mutate the history', () => {
  let snapshot;
  const history = createNotificationHistory({ onChange: entries => { snapshot = entries; } });
  const issues = [{ id: 'a', title: '输入无效', message: '选择 MCU', level: 'error', moduleId: 'hw-platform', paramKey: 'mcu', designPage: 'build', itemId: 'driver-a', path: 'target.mcu', secret: 'discard', nested: { value: 1 } }];
  const entry = history.add({ ...notification(), issues });
  issues[0].title = 'changed'; entry.issues[0].title = 'changed'; snapshot[0].message = 'changed';
  const result = history.entries;
  result[0].issues[0].title = 'changed'; result.length = 0;
  const stored = history.entries[0];
  assert.equal(stored.message, '配置已保存');
  assert.equal(stored.issues[0].title, '输入无效');
  assert.deepEqual(Object.keys(stored.issues[0]), ['id', 'title', 'message', 'level', 'moduleId', 'paramKey', 'designPage', 'itemId', 'path']);
});

test('history preserves reference annotations across reloads and deeply isolates every snapshot', () => {
  const storage=memoryStorage(); let snapshot;
  const history=createNotificationHistory({storage,onChange:entries=>{snapshot=entries;}});
  const issue={id:'conflict',message:'UART4 被编码器使用。',messageParts:[{type:'reference',label:'UART4',kind:'peripheral',html:'discard'},' 被',{type:'reference',label:'编码器',kind:'driver'},'使用。']};
  const entry=history.add({...notification(),issues:[issue]});
  issue.messageParts[0].label='changed input';
  entry.issues[0].messageParts[0].label='changed returned entry';
  snapshot[0].issues[0].messageParts[0].label='changed callback';
  history.entries[0].issues[0].messageParts[0].label='changed getter';
  const restored=createNotificationHistory({storage}).entries[0].issues[0];
  assert.equal(restored.message,'UART4 被编码器使用。');
  assert.deepEqual(restored.messageParts[0],{type:'reference',label:'UART4',kind:'peripheral'});
  assert.equal(restored.messageParts[2].label,'编码器');
  assert.match(renderIssueMessage(restored),/<span class="attribute-tag issue-reference-tag">UART4<\/span>/);
});

test('invalid reference annotations are discarded without losing the plain history issue', () => {
  const storage=memoryStorage(),history=createNotificationHistory({storage});
  const entry=history.add({...notification(),issues:[{id:'a',message:'保留消息',messageParts:[{type:'html',label:'bad'}]}]});
  assert.equal(Object.hasOwn(entry.issues[0],'messageParts'),false);
  const payload=JSON.parse(storage.getItem(KEY));
  payload.entries[0].issues[0].messageParts=Array(257).fill('too many parts');
  storage.setItem(KEY,JSON.stringify(payload));
  const restored=createNotificationHistory({storage}).entries[0].issues[0];
  assert.deepEqual(restored,{id:'a',message:'保留消息'});
  assert.equal(renderIssueMessage(restored),'保留消息');
});

test('read and clear emit only on changes, and clearing survives a reload', () => {
  const storage = memoryStorage(); let changes = 0;
  const history = createNotificationHistory({ storage, onChange: () => changes++ });
  assert.equal(history.markRead('missing'), false); assert.equal(history.markAllRead(), false); assert.equal(history.clear(), false);
  const first = history.add(notification('一')); history.add(notification('二'));
  assert.equal(history.markRead(first.id), true); assert.equal(history.markRead(first.id), false);
  assert.equal(history.markAllRead(), true); assert.equal(history.markAllRead(), false);
  assert.equal(history.clear(), true); assert.equal(history.clear(), false);
  assert.equal(changes, 5);
  assert.deepEqual(createNotificationHistory({ storage }).entries, []);
});

test('keeps the newest entries within the configured limit, including restored data', () => {
  const storage = memoryStorage(), history = createNotificationHistory({ storage, limit: 3 });
  for (let index = 0; index < 6; index++) history.add(notification(String(index)));
  assert.deepEqual(history.entries.map(entry => entry.message), ['5', '4', '3']);
  assert.equal(JSON.parse(storage.getItem(KEY)).entries.length, 3);
  assert.deepEqual(createNotificationHistory({ storage, limit: 2 }).entries.map(entry => entry.message), ['5', '4']);
  const defaults = createNotificationHistory();
  for (let index = 0; index < 105; index++) defaults.add(notification(String(index)));
  assert.equal(defaults.entries.length, 100);
});

test('unavailable or damaged storage falls back to a usable session history without migration', () => {
  for (const storage of [undefined, { getItem() { throw new Error('denied'); }, setItem() {} }, { getItem: () => '{broken', setItem() { throw new Error('must not repair'); } }, { getItem: () => JSON.stringify({ version: 0, entries: [] }), setItem() { throw new Error('must not migrate'); } }]) {
    const history = createNotificationHistory({ storage });
    assert.equal(history.persistent, false);
    assert.doesNotThrow(() => history.add(notification()));
    assert.equal(history.entries.length, 1);
    assert.equal(history.markAllRead(), true);
    assert.equal(history.clear(), true);
  }
});

test('a failed write keeps records in memory and disables further persistence attempts', () => {
  let writes = 0, changes = 0;
  const storage = { getItem: () => null, setItem() { writes++; throw new Error('quota'); } };
  const history = createNotificationHistory({ storage, onChange: () => { changes++; } });
  assert.doesNotThrow(() => history.add(notification()));
  assert.equal(history.persistent, false);
  history.add(notification('另一条')); history.markAllRead(); history.clear();
  assert.equal(writes, 1); assert.equal(changes, 4);
  assert.deepEqual(history.entries, []);
});
