import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeOptions, createNotificationCenter } from '../web/src/shared/notifications/center.mjs';

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) { for (const callback of this.listeners.get(type) || []) callback({ type, target: this, ...event }); }
}

class Element extends Events {
  constructor(tag, doc) { super(); this.tag = tag; this.ownerDocument = doc; this.children = []; this.parentElement = null; this.dataset = {}; this.attributes = {}; this.className = ''; this.textContent = ''; this.open = false; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentElement?.isConnected; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { this.ownerDocument.focusCalls.push(this); this.ownerDocument.activeElement = this; }
  showModal() { this.ownerDocument.modalCalls.push(this); this.open = true; }
  close() { this.open = false; this.ownerDocument.emit('close', { target: this }); }
}

function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }
function withClass(node, className) { return descendants(node).find(child => child.className.split(' ').includes(className)); }

class Document extends Events {
  constructor() { super(); this.hidden = false; this.focusCalls = []; this.modalCalls = []; this.body = new Element('body', this); this.activeElement = this.body; }
  createElement(tag) { return new Element(tag, this); }
  querySelectorAll(selector) {
    assert.equal(selector, 'dialog[open]');
    return descendants(this.body).filter(node => node.tag === 'dialog' && node.open);
  }
  querySelector(selector) { assert.equal(selector, '#workspace'); return descendants(this.body).find(node => node.id === 'workspace') || null; }
}

class Clock {
  now = 100000; sequence = 0; jobs = new Map();
  setTimeout(callback, delay) { const id = ++this.sequence; this.jobs.set(id, { callback, due: this.now + delay }); return id; }
  clearTimeout(id) { this.jobs.delete(id); }
  advance(milliseconds) {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.jobs.entries()].filter(([, job]) => job.due <= target).sort((left, right) => left[1].due - right[1].due)[0];
      if (!next) break;
      this.now = next[1].due; this.jobs.delete(next[0]); next[1].callback();
    }
    this.now = target;
  }
}

function fixture(t) {
  const doc = new Document(), clock = new Clock(), details = [];
  const workspace = doc.createElement('main'); workspace.id = 'workspace';
  const host = doc.createElement('div'); doc.body.append(workspace, host);
  doc.activeElement = workspace;
  t.mock.method(Date, 'now', () => clock.now);
  const center = createNotificationCenter({ host, clock, onDetails: (message, options) => details.push({ message, ...options }) });
  t.after(() => center.destroy());
  return { doc, clock, host, workspace, center, details };
}

test('普通消息按通知展示，错误默认常驻，问题详情和显式选择才进入对话框', () => {
  for (const level of ['info', 'success', 'warning', 'error']) assert.equal(noticeOptions('操作结果', { level }).presentation, 'notification');
  assert.equal(noticeOptions('操作失败', { level: 'error' }).duration, 0);
  assert.equal(noticeOptions('已保存', { level: 'success' }).duration, 4000);
  assert.equal(noticeOptions('查看说明', { presentation: 'dialog' }).presentation, 'dialog');
  const issues = [{ level: 'error', message: '缺少配置' }];
  assert.equal(noticeOptions('检查结果', { issues }).presentation, 'dialog');
  assert.equal(noticeOptions('检查结果', { issues, presentation: 'notification' }).presentation, 'notification');
});

test('普通show不调用focus或showModal，通知保留原输入焦点并使用合适的朗读角色', t => {
  const { doc, host, workspace, center } = fixture(t);
  for (const level of ['info', 'success', 'error']) center.show(`${level} 消息`, { level });
  assert.equal(host.children.length, 3);
  assert.equal(doc.activeElement, workspace); assert.deepEqual(doc.focusCalls, []); assert.deepEqual(doc.modalCalls, []);
  assert.equal(host.children.find(node => node.dataset.level === 'error').attributes.role, 'alert');
  assert.equal(host.children.find(node => node.dataset.level === 'success').attributes.role, 'status');
});

test('重复通知合并计数并延长同一条通知的可读时间', t => {
  const { host, clock, center, doc } = fixture(t);
  center.show('已保存', { level: 'success', title: '保存完成' });
  const node = host.children[0]; clock.advance(3000);
  center.show('已保存', { level: 'success', title: '保存完成' });
  assert.equal(host.children.length, 1); assert.equal(host.children[0], node);
  const badge = withClass(node, 'notification-toast-count'); assert.equal(badge.hidden, false); assert.equal(badge.textContent, '×2');
  assert.equal(clock.jobs.size, 1); clock.advance(3999); assert.equal(host.children.length, 1);
  clock.advance(1); assert.equal(host.children.length, 0); assert.deepEqual(doc.focusCalls, []);
});

test('success按时移除，error不会自动消失且可以手动关闭', t => {
  const { host, clock, center } = fixture(t);
  center.show('编译完成', { level: 'success' }); center.show('连接失败', { level: 'error' });
  assert.equal(clock.jobs.size, 1);
  clock.advance(4000); assert.equal(host.children.length, 1); assert.equal(host.children[0].dataset.level, 'error');
  clock.advance(60000); assert.equal(host.children.length, 1); assert.equal(clock.jobs.size, 0);
  withClass(host.children[0], 'notification-toast-close').emit('click'); assert.equal(host.children.length, 0);
});

test('悬停和键盘焦点暂停剩余时间，焦点在通知内部移动时不提前恢复倒计时', t => {
  const { doc, host, clock, workspace, center } = fixture(t);
  center.show('配置已应用', { level: 'success' }); const node = host.children[0];
  clock.advance(1000); node.emit('pointerenter'); assert.equal(clock.jobs.size, 0);
  clock.advance(10000); assert.equal(host.children.length, 1);
  const close = withClass(node, 'notification-toast-close'); close.focus(); node.emit('focusin');
  node.emit('pointerleave'); clock.advance(10000); assert.equal(host.children.length, 1); assert.equal(clock.jobs.size, 0);
  node.emit('focusout', { relatedTarget: close }); assert.equal(clock.jobs.size, 0);
  doc.activeElement = workspace; node.emit('focusout', { relatedTarget: workspace }); assert.equal(clock.jobs.size, 1);
  clock.advance(2999); assert.equal(host.children.length, 1); clock.advance(1); assert.equal(host.children.length, 0);
});

test('对话框打开后同步通知容器，关闭上层和最后一层时恢复正确父容器', t => {
  const { doc, host, center } = fixture(t);
  center.show('已有通知', { level: 'error' }); const node = host.children[0];
  const first = doc.createElement('dialog'), second = doc.createElement('dialog'); doc.body.append(first, second);
  first.showModal(); center.syncHost(); assert.equal(host.parentElement, first); assert.equal(host.children[0], node);
  const close = withClass(node, 'notification-toast-close'); close.focus(); doc.focusCalls.length = 0;
  second.showModal(); center.syncHost(); assert.equal(host.parentElement, second); assert.equal(doc.activeElement, close); assert.deepEqual(doc.focusCalls, [close]);
  second.close(); assert.equal(host.parentElement, first);
  first.close(); assert.equal(host.parentElement, doc.body); assert.equal(host.children[0], node);
  assert.equal(doc.modalCalls.length, 2);
});

test('长消息的查看详情是显式用户操作，展示时不会自动打开对话框', t => {
  const { doc, host, clock, center, details } = fixture(t);
  const message = '参数说明。'.repeat(30);
  center.show(message, { level: 'info', presentation: 'notification' });
  assert.equal(details.length, 0); assert.equal(clock.jobs.size, 0); assert.deepEqual(doc.modalCalls, []);
  withClass(host.children[0], 'notification-toast-action').emit('click');
  assert.equal(host.children.length, 0); assert.equal(details.length, 1); assert.equal(details[0].message, message); assert.equal(details[0].presentation, 'dialog');
});
