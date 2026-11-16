import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperation, checkOperationShape, OPERATION_TRANSPORTS, OPERATION_MODES } from '../web/src/features/operation/model.mjs';
import { renderOperation } from '../web/src/features/operation/view.mjs';

const project = () => ({ operation: createOperation(), catalog: { activeAssemblyId: '', assemblies: [] } });

test('运行配置默认未选接口，所有未知数值为 null，工厂之间无共享状态', () => {
  const value = createOperation();
  assert.equal(checkOperationShape(value), true);
  assert.equal(value.transport, 'unselected');
  assert.equal(value.mode, 'disabled');
  assert.equal(value.adapter, '');
  assert.equal(value.address, '');
  for (const key of ['nodeId', 'periodMs', 'positionRad', 'speedRadS', 'torqueNm', 'kp', 'kd']) assert.equal(value[key], null);
  value.adapter = 'changed';
  assert.equal(createOperation().adapter, '');
});

test('各接口与模式可独立保存，不推断节点协议含义或配置兼容性', () => {
  for (const transport of OPERATION_TRANSPORTS) for (const mode of OPERATION_MODES) {
    const value = { ...createOperation(), transport, mode, adapter: '适配器甲', address: '地址约定待实现', nodeId: 7, periodMs: 2.5, positionRad: -1.2, speedRadS: -2, torqueNm: -0.4, kp: 10, kd: 0.1 };
    const before = structuredClone(value);
    assert.equal(checkOperationShape(value), true);
    assert.deepEqual(value, before);
    assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  }
});

test('运行配置拒绝错误类型、未知字段、伪造状态与非有限数', () => {
  const badValues = [null, [], 'operation', new Date()];
  for (const value of badValues) assert.throws(() => checkOperationShape(value));
  for (const mutate of [
    value => { value.connected = true; },
    value => { value.telemetry = { positionRad: 0 }; },
    value => { delete value.kp; },
    value => { value.transport = 'can'; },
    value => { value.mode = 'magic'; },
    value => { value.address = 123; },
    value => { value.adapter = null; },
    value => { value.nodeId = 1.5; },
    value => { value.nodeId = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.periodMs = '1'; },
    value => { value.positionRad = Infinity; },
    value => { value.speedRadS = NaN; },
    value => { value.torqueNm = false; },
    value => { value.kp = undefined; },
  ]) { const value = createOperation(); mutate(value); assert.throws(() => checkOperationShape(value)); }
  const poison = JSON.parse(JSON.stringify(createOperation()).replace('{', '{"__proto__":{},'));
  assert.throws(() => checkOperationShape(poison), /未知字段/);
});

test('运行页可编辑全部配置，设备操作始终禁用且没有下发处理器', () => {
  const value = project(), before = structuredClone(value), html = renderOperation(value);
  assert.match(html, /<h1>运行<\/h1>/);
  assert.match(html, /本地通信服务未接入/);
  assert.match(html, /href="#\/equipment\/assemblies"/);
  for (const key of Object.keys(value.operation)) assert.ok(html.includes(`data-edit="operation" data-key="${key}"`), key);
  const buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].filter(match => !match[1].includes('data-help='));
  assert.deepEqual(buttons.map(match => match[2]), ['连接', '使能', '发送给定', '停机']);
  for (const [, attrs] of buttons) {
    assert.match(attrs, /\bdisabled\b/);
    assert.doesNotMatch(attrs, /data-action=|onclick=/);
    assert.match(attrs, /aria-describedby="operation-service-note"/);
  }
  const inputs = [...html.matchAll(/<input\b([^>]*)>/g)];
  assert.ok(inputs.length > 0);
  for (const [, attrs] of inputs) assert.doesNotMatch(attrs, /\bdisabled\b/);
  assert.deepEqual(value, before);
});

test('反馈保持未知，不以目标值冒充实测值，也不显示虚构连接状态', () => {
  const value = project();
  Object.assign(value.operation, { transport: 'ethernet', mode: 'position', positionRad: 123.456, speedRadS: 78.9, torqueNm: 4.321 });
  const html = renderOperation(value);
  assert.match(html, /value="123.456"/);
  const feedback = html.slice(html.indexOf('id="operation-feedback"'));
  for (const target of ['123.456', '78.9', '4.321']) assert.equal(feedback.includes(target), false);
  assert.equal((feedback.match(/<strong>—<\/strong>/g) || []).length, 3);
  assert.match(feedback, /未连接/);
  assert.doesNotMatch(html, /已连接|发送成功|实时曲线|无故障|运行正常/);
  const blank = renderOperation(project());
  assert.match(blank, /<input(?=[^>]*data-key="positionRad")(?=[^>]*value="")[^>]*>/);
});

test('选型名称与连接文本正确转义，旧项目未初始化运行配置时仍能展示', () => {
  const value = project();
  value.catalog.activeAssemblyId = 'joint';
  value.catalog.actuators = [{id:'actuator'}];
  value.catalog.drivers = [{id:'driver'}];
  value.catalog.assemblies.push({ id: 'joint', name: '<img src=x onerror=alert(1)>',actuatorId:'actuator',driverId:'driver' });
  value.operation.adapter = '" onclick="bad';
  const html = renderOperation(value);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&quot; onclick=&quot;bad'));
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /尚未选择关节模组/);
  delete value.operation;
  assert.match(renderOperation(value), /data-edit="operation"/);
  value.catalog.drivers=[];
  assert.match(renderOperation(value), /尚未选择关节模组/);
});
