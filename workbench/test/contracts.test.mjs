import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesign, createStructure, createField, createFault, createMessage, checkDesignShape, checkCommissioningShape, getStructureSize, validateDesign, configurationFingerprint } from '../web/src/core/contracts.mjs';
import { createProject, createExampleProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { saveLayerVersion, selectLayerVersion } from '../web/src/features/configuration/versions.mjs';

const has = (project, id, level = 'error') => validateDesign(project).some(issue => issue.id === `design-${id}` && issue.level === level);
function withTransport(transport) {
  const project = createExampleProject();
  project.instances['app-comms'].parameters.bus = transport;
  Object.assign(project.design.protocol, { transport, nodeId: 1, bitrate: 500000, timeoutMs: 100, integrity: transport === 'uart' ? 'crc16_ccitt' : 'transport_crc' });
  return project;
}

test('七个可编辑模板标明方向、坐标和生效输出边界，无协议硬件默认数值', () => {
  const design = createDesign();
  assert.deepEqual(design.structures.slice(0, 7).map(item => item.name), ['SampleFrame', 'DriveFeedback', 'ObserverSamples', 'ObserverEstimate', 'ControlRef', 'ControlStatus', 'FaultEvent']);
  assert.equal(design.structures.length, 58);
  assert.doesNotThrow(() => checkDesignShape(design));
  assert.equal(design.protocol.transport, 'unselected');
  for (const key of ['nodeId', 'bitrate', 'timeoutMs']) assert.equal(design.protocol[key], null);
  const observer = design.structures.find(item => item.name === 'ObserverSamples');
  assert.match(observer.description, /并非所有观测器/);
  assert.match(observer.description, /实际已生效输出与采样时间/);
  assert.ok(observer.fields.some(field => field.name === 'applied_sequence'));
  const sample = design.structures[0];
  assert.ok(sample.fields.some(field => field.name === 'motor_angle'));
  assert.ok(sample.fields.some(field => field.name === 'output_angle'));
  design.structures[0].fields[0].name = 'changed';
  assert.notEqual(createDesign().structures[0].fields[0].name, 'changed');
});

test('创建函数接受指定 ID，默认 ID 唯一且未知引用留空', () => {
  for (const fn of [createStructure, createField, createFault, createMessage]) {
    assert.equal(fn('fixed').id, 'fixed');
    assert.notEqual(fn().id, fn().id);
  }
  assert.equal(createStructure().owner, ''); assert.equal(createFault().source, ''); assert.equal(createMessage().payload, '');
});

test('字节数仅为紧凑字段估计，不按 C 对齐或添加传输开销', () => {
  const structure = createStructure();
  structure.fields = [{ ...createField(), type: 'u8', count: 1 }, { ...createField(), type: 'f32', count: 2 }, { ...createField(), type: 'bool', count: 1 }];
  assert.equal(getStructureSize(structure), 10);
  assert.equal(getStructureSize({ fields: [] }), 0);
  structure.fields[1].count = 0; assert.equal(getStructureSize(structure), null);
  structure.fields[1].count = Number.MAX_SAFE_INTEGER; assert.equal(getStructureSize(structure), null);
  assert.equal(getStructureSize(null), null);
});

test('草案可保存重复结构、字段、故障码与操作码，校验分别报告', () => {
  const project = createProject();
  project.design.structures[1].name = project.design.structures[0].name;
  project.design.structures[0].fields[1].name = project.design.structures[0].fields[0].name;
  project.design.faults[1].code = project.design.faults[0].code;
  project.design.protocol.messages[1].opcode = project.design.protocol.messages[0].opcode;
  assert.ok(has(project, 'structure-name-duplicate-1'));
  assert.ok(has(project, 'structure-0-field-name-duplicate-1'));
  assert.ok(has(project, 'fault-code-duplicate-1'));
  assert.ok(has(project, 'message-opcode-duplicate-1'));
  assert.deepEqual(parseProject(serializeProject(project)), project);
});

test('合法格式的未知 owner / consumer / source / payload 不阻止保存但报告引用错误', () => {
  const project = createProject();
  project.design.structures[0].owner = 'missing'; project.design.structures[0].consumers.push('missing');
  project.design.faults[0].source = 'missing'; project.design.protocol.messages[0].payload = 'missing';
  assert.ok(has(project, 'structure-0-owner-unknown'));
  assert.ok(validateDesign(project).some(issue => issue.id.includes('consumer-') && issue.level === 'error'));
  assert.ok(has(project, 'fault-0-source-unknown'));
  assert.ok(has(project, 'message-0-payload-unknown'));
  assert.deepEqual(parseProject(serializeProject(project)), project);
});

test('删除被消息引用的数据结构会保留清楚的悬空引用问题', () => {
  const project = createProject(); project.design.structures = project.design.structures.filter(item => item.id !== 'control-ref');
  assert.ok(has(project, 'message-0-payload-unknown'));
  assert.ok(validateProject(project).some(issue => issue.id === 'design-message-0-payload-unknown' && issue.designPage === 'protocol'));
});

test('严重故障仅上报不被接受，但逻辑冲突草案可往返', () => {
  const project = createProject(); project.design.faults[0].action = 'report';
  assert.ok(has(project, 'fault-0-critical-action'));
  assert.deepEqual(parseProject(serializeProject(project)), project);
});

test('协议必须与编译包含的通信模块和总线选择一致', () => {
  const project = withTransport('canfd');
  project.instances['app-comms'].enabled = false;
  assert.ok(has(project, 'protocol-module'));
  project.instances['app-comms'].enabled = true; project.instances['app-comms'].parameters.bus = 'uart';
  assert.ok(has(project, 'protocol-bus-mismatch'));
  project.design.protocol.timeoutMs = 200;
  assert.ok(has(project, 'protocol-timeout-mismatch'));
});

test('经典 CAN 与 CAN FD 按应用字段估计检查 8 / 64 字节上界，不虚构帧头', () => {
  const project = withTransport('can');
  const structure = project.design.structures[0];
  structure.fields = [{ ...createField(), name: 'data', type: 'u8', count: 8, meaning: '载荷测试' }];
  project.design.protocol.messages = [{ ...createMessage(), name: 'Test', payload: structure.id }];
  assert.ok(!has(project, 'message-0-payload-limit'));
  structure.fields[0].count = 9; assert.ok(has(project, 'message-0-payload-limit'));
  project.design.protocol.transport = 'canfd'; project.instances['app-comms'].parameters.bus = 'canfd';
  structure.fields[0].count = 64; assert.ok(!has(project, 'message-0-payload-limit'));
  structure.fields[0].count = 65; assert.ok(has(project, 'message-0-payload-limit'));
  assert.match(validateDesign(project).find(issue => issue.id === 'design-message-0-payload-limit').message, /分片.*未实现/);
});

test('UART 不能假定已有整条消息传输 CRC；CRC16-CCITT 仍需定义变体', () => {
  const project = withTransport('uart');
  project.design.protocol.integrity = 'transport_crc';
  assert.ok(has(project, 'protocol-uart-integrity'));
  project.design.protocol.integrity = 'crc16_ccitt';
  assert.ok(!has(project, 'protocol-uart-integrity'));
  assert.ok(has(project, 'protocol-crc-definition', 'pending'));
});

test('未知协议参数与空白接口保留 pending，不等于通过硬件验证', () => {
  const project = createProject();
  assert.ok(has(project, 'protocol-transport', 'info'));
  project.instances['app-comms'].enabled = true;
  assert.ok(has(project, 'protocol-transport', 'pending'));
  project.design.structures.push(createStructure());
  project.design.faults.push(createFault()); project.design.protocol.messages.push(createMessage());
  assert.ok(validateDesign(project).some(issue => issue.level === 'pending' && issue.designPage === 'structures'));
  assert.doesNotThrow(() => parseProject(serializeProject(project)));
});

test('严格 shape 拒绝未知字段、非有限数字、非法枚举和非法数组', () => {
  const bads = [
    design => { design.extra = true; },
    design => { design.structures[0].fields[0].extra = true; },
    design => { design.structures[0].fields[0].count = 1.5; },
    design => { design.structures[0].fields[0].type = 'float'; },
    design => { design.structures[0].consumers = 'foc-current'; },
    design => { design.protocol.timeoutMs = Infinity; },
    design => { design.protocol.messages[0].ack = 1; },
    design => { design.faults[0].latched = null; },
  ];
  for (const mutate of bads) { const design = createDesign(); mutate(design); assert.throws(() => checkDesignShape(design)); }
});

test('联调记录只接受五个已知 ID，存储状态不包含 stale', () => {
  assert.doesNotThrow(() => checkCommissioningShape({ checks: {} }));
  const record = { status: 'passed', note: '人工证据', fingerprint: 'cfg2-test', updatedAt: new Date().toISOString() };
  assert.doesNotThrow(() => checkCommissioningShape({ checks: Object.fromEntries(['build', 'timing', 'trip', 'calibration', 'closed_loop'].map(id => [id, { ...record }])) }));
  assert.throws(() => checkCommissioningShape({ checks: { surprise: record } }), /未知字段/);
  assert.throws(() => checkCommissioningShape({ checks: { build: { ...record, status: 'stale' } } }), /选项/);
  assert.throws(() => checkCommissioningShape({ checks: { build: { ...record, note: 2 } } }), /文本/);
});

test('指纹忽略说明性项目元数据及联调记录，但捕捉参数、运行、构建和接口变更', () => {
  const project = createProject(); const fingerprint = configurationFingerprint(project);
  project.name = 'rename'; project.revision++; project.updatedAt = new Date().toISOString(); project.id = 'other'; project.provenance['foc-current.kpD'] = 'user';
  project.commissioning.checks.build = { status: 'passed', note: 'test', fingerprint, updatedAt: new Date().toISOString() };
  assert.equal(configurationFingerprint(project), fingerprint);
  assert.equal(configurationFingerprint(parseProject(serializeProject(project))), fingerprint);
  for (const mutate of [
    p => { p.instances['foc-current'].parameters.kpD = 1; },
    p => { p.instances['foc-observer'].runtimeEnabled = true; },
    p => { p.build.optimization = 'O2'; },
    p => { p.design.structures[0].fields[0].unit = 'new'; },
    p => { p.target.board = 'v2'; },
  ]) { const changed = structuredClone(project); mutate(changed); assert.notEqual(configurationFingerprint(changed), fingerprint); }
});

test('指纹对对象键顺序稳定，设备库变更会过期，但排除 appliedFingerprint', () => {
  const project = createProject(); const fingerprint = configurationFingerprint(project);
  const reordered = Object.fromEntries(Object.entries(project).reverse());
  reordered.target = Object.fromEntries(Object.entries(project.target).reverse());
  assert.equal(configurationFingerprint(reordered), fingerprint);
  project.catalog.appliedFingerprint = 'anything';
  assert.equal(configurationFingerprint(project), fingerprint);
  project.catalog.activeAssemblyId = 'new';
  assert.notEqual(configurationFingerprint(project), fingerprint);
});

test('默认设计问题 ID 唯一且始终标记应用消息草案', () => {
  const project = createProject(); const issues = validateDesign(project);
  assert.equal(new Set(issues.map(issue => issue.id)).size, issues.length);
  assert.ok(has(project, 'protocol-draft', 'info'));
  for (const issue of issues) assert.ok(['structures', 'faults', 'protocol'].includes(issue.designPage));
});

test('指纹包含所选版本声明，不受未使用历史、版本备注或上位机运行草案影响', () => {
  let project = saveLayerVersion(createProject(), { layer: 'foc', version: 'beta', interfaceVersion: 'ctrl-a', requires: { hardware: 'sample-a' } });
  const originalId = project.layerVersions.selected.foc;
  const fingerprint = configurationFingerprint(project);
  project = saveLayerVersion(project, { layer: 'foc', version: 'next' });
  assert.notEqual(configurationFingerprint(project), fingerprint);
  project = selectLayerVersion(project, 'foc', originalId);
  assert.equal(configurationFingerprint(project), fingerprint);
  const unused = project.layerVersions.releases.find(release => release.id !== originalId);
  unused.version = 'renamed history'; unused.snapshot.instances['foc-current'].parameters.kpD = 123;
  project.layerVersions.releases.find(release => release.id === originalId).notes = '修改说明';
  Object.assign(project.operation, { transport: 'ethernet', mode: 'position', address: 'host', positionRad: 1.2 });
  assert.equal(configurationFingerprint(project), fingerprint);
  for (const mutate of [
    release => { release.version = 'stable'; },
    release => { release.interfaceVersion = 'ctrl-b'; },
    release => { release.requires.hardware = 'sample-b'; },
  ]) {
    const changed = structuredClone(project); mutate(changed.layerVersions.releases.find(release => release.id === originalId));
    assert.notEqual(configurationFingerprint(changed), fingerprint);
  }
  project.build.moduleOptimizations['foc-current'] = 'O3';
  assert.notEqual(configurationFingerprint(project), fingerprint);
});
