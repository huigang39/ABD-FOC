import test from 'node:test';
import assert from 'node:assert/strict';
import { driverIssuePresentation } from '../web/src/modules/hardware/hw-drivers/issue-view.mjs';

const pending = (id, paramKey, extra = {}) => ({ id, level: 'pending', moduleId: 'hw-drivers', paramKey, title: '原始问题', message: '原始说明', ...extra });

test('hidden role fields and command sub-items aggregate without changing visible fields or raw inputs', () => {
  const issues = [
    pending('sensor-motorEncoderTiming', 'motorEncoderTiming'),
    pending('sensor-command-motorEncoder-data', 'motorEncoderCommands'),
    pending('sensor-command-motorEncoder-frameBytes', 'motorEncoderCommands'),
    pending('sensor-encoderBits', 'encoderBits'),
    pending('sensor-motorEncoderResource', 'motorEncoderResource'),
    pending('sensor-motorEncoderSinResource', 'motorEncoderSinResource'),
    pending('sensor-motorEncoderModel', 'motorEncoderModel'),
    pending('sensor-motorEncoderBitrate', 'motorEncoderBitrate'),
    pending('hardware-gate-enable-pin-map', 'gateDriverEnablePin'),
  ];
  const params = { motorEncoderModel: 'MC_ENCODER_GW_OUTER', motorEncoderResource: '' };
  const before = structuredClone({ issues, params });
  const displayed = driverIssuePresentation(params, issues);
  assert.equal(displayed.length, 6);
  const preset = displayed.find(issue => issue.id === 'sensor-motorEncoder-preset-pending');
  assert.equal(preset.title, '角度编码器 · 型号预设待完善');
  assert.equal(preset.paramKey, 'motorEncoderModel');
  assert.deepEqual(preset.sourceIssueIds, issues.slice(0, 4).map(issue => issue.id));
  assert.match(preset.message, /型号预设仍缺少通信协议或参数适配/);
  assert.doesNotMatch(preset.message, /填写|配置帧|选择数据|输入来源/);
  const resource = displayed.find(issue => issue.id === 'sensor-motorEncoder-resource-pending');
  assert.equal(resource.title, '角度编码器 · 外设关联待确定');
  assert.equal(resource.paramKey, 'motorEncoderModel');
  assert.match(resource.message, /不会自动猜测/);
  assert.deepEqual(resource.sourceIssueIds, ['sensor-motorEncoderSinResource']);
  assert.ok(displayed.includes(issues[4]), 'the visible peripheral selector retains its own pending issue');
  for (const original of [issues[6], issues[8]]) assert.ok(displayed.includes(original));
  assert.equal(displayed.find(issue => issue.id === issues[7].id).paramKey, 'motorEncoderResource');
  assert.deepEqual({ issues, params }, before);
});

test('visible peripheral selectors retain the original pending issue for every built-in role', () => {
  const issues = ['motorEncoder','outputEncoder','torqueSensor','gateDriver'].map(prefix => pending(`${prefix}-resource`, `${prefix}Resource`));
  const displayed = driverIssuePresentation({}, issues);
  assert.deepEqual(displayed, issues);
  assert(displayed.every((issue, index) => issue === issues[index]));
});

test('removed driver rate fields point to peripheral configuration without mutating raw validation', () => {
  const roles = [['motorEncoder','角度编码器'], ['outputEncoder','角度编码器（出轴侧）'], ['torqueSensor','力矩传感器'], ['gateDriver','门极驱动器']];
  const issues = roles.map(([prefix]) => pending(`${prefix}-bitrate`, `${prefix}Bitrate`));
  const before = structuredClone(issues), displayed = driverIssuePresentation({}, issues);
  for (const [index, [prefix, title]] of roles.entries()) {
    assert.equal(displayed[index].id, issues[index].id);
    assert.equal(displayed[index].level, 'pending');
    assert.equal(displayed[index].title, `${title} · 外设速率待配置`);
    assert.equal(displayed[index].message, '在外设页配置波特率或时钟频率。');
    assert.equal(displayed[index].paramKey, `${prefix}Resource`);
  }
  assert.deepEqual(issues, before);
});

test('all errors, warnings, other modules and custom-driver diagnostics remain unchanged and separate', () => {
  const issues = [
    pending('frame-error', 'motorEncoderCommands', { level: 'error' }),
    pending('hidden-warning', 'motorEncoderAngleDomain', { level: 'warning' }),
    pending('resource-error', 'motorEncoderResource', { level: 'error' }),
    pending('other-module', 'motorEncoderCommands', { moduleId: 'app-comms' }),
    pending('custom-driver-one-adapter', 'customDrivers'),
    pending('generic-driver-error', '', { level: 'error' }),
  ];
  assert.deepEqual(driverIssuePresentation({}, issues), issues);
  assert(driverIssuePresentation({}, issues).every((issue, index) => issue === issues[index]));
});

test('each role has its own preset gap and capability prompts point to visible model selection', () => {
  const issues = [pending('capability', 'torqueCapability'), pending('torque-unit', 'torqueSensorUnit'), pending('gate-command', 'gateDriverCommands'), pending('output-bits', 'outputEncoderBits')];
  const displayed = driverIssuePresentation({}, issues);
  assert.equal(displayed[0].title, '力矩传感器 · 型号待选择');
  assert.equal(displayed[0].paramKey, 'torqueSensorModel');
  assert.equal(displayed[0].id, 'capability');
  assert.equal(issues[0].paramKey, 'torqueCapability');
  assert.deepEqual(displayed.slice(1).map(issue => issue.id), ['sensor-torqueSensor-preset-pending','sensor-gateDriver-preset-pending','sensor-outputEncoder-preset-pending']);
  assert.deepEqual(driverIssuePresentation({}, []), []);
});
