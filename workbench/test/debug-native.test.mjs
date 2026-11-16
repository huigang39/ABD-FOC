import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DebugService, TRACE_ABI, BUILD_IDENTITY, decodeTraceControl, decodeTraceValue } from '../native/debug.mjs';

const CTRL = 0x2001c000, DATA = 0x2001d000, VARIABLE = 0x20000100;
const identity = { buildId: '12'.repeat(32), imageAddress: 0x08000400, resetHandler: 0x08000801, mailboxAddress: BUILD_IDENTITY.mailboxAddress };
function mailbox() {
  const data = Buffer.alloc(64);
  [BUILD_IDENTITY.magic, 1, 64, identity.imageAddress].forEach((value, index) => data.writeUInt32LE(value, index * 4));
  Buffer.from(identity.buildId, 'hex').copy(data, 16);
  data.writeUInt32LE(1, 48); data.writeUInt32LE(0xfffffffe, 52); data.writeUInt32LE(identity.resetHandler, 56);
  return data;
}
function memory() {
  const ctrl = Buffer.alloc(688), data = Buffer.alloc(4096);
  ctrl.writeUInt32LE(TRACE_ABI.magic, 0); ctrl.writeUInt32LE(688, 4);
  ctrl.writeUInt32LE(1, 20); ctrl.writeUInt32LE(8, 164);
  ctrl.writeUInt32LE(DATA, 168); ctrl.writeUInt32LE(4096, 172);
  return { ctrl, data };
}
function transportFixture() {
  const { ctrl, data } = memory(), calls = [];
  let connected = false, reads = 0;
  const transport = {
    ctrl, data, calls, identity: mailbox(), mutateData: null,
    async request(method, args = {}) {
      calls.push({ method, args });
      if (method === 'probe') return { available: true, probes: [{ serialNumber: 123, product: 'fixture' }] };
      if (method === 'connect') { connected = true; return { connected: true, serialNumber: 123, halted: false }; }
      if (method === 'disconnect') { connected = false; return { connected: false }; }
      if (method === 'status') return { connected };
      if (method === 'authorizeTrace') return { authorized: true };
      if (method === 'read') {
        if (args.address === BUILD_IDENTITY.mailboxAddress) return { data: transport.identity.toString('base64') };
        if (args.address === CTRL) return { data: ctrl.toString('base64') };
        if (args.address === DATA) { reads++; transport.mutateData?.(reads, data, ctrl); return { data: data.toString('base64') }; }
        throw new Error('unexpected address');
      }
      if (method === 'write') {
        Buffer.from(args.data, 'base64').copy(ctrl, args.address - CTRL);
        if (args.address === CTRL + 8) {
          ctrl.writeUInt32LE(ctrl.readUInt32LE(8), 12); ctrl.writeUInt32LE(1, 152);
        }
        return { written: Buffer.from(args.data, 'base64').length };
      }
      throw new Error('unexpected method');
    },
  };
  return transport;
}
function activate(transport, { capacity = 4, generation = 1, writeSeq = 3, overwrites = 0, type = 4 } = {}) {
  const ctrl = transport.ctrl;
  ctrl.writeUInt32LE(1, 16); ctrl.writeUInt32LE(1, 152); ctrl.writeUInt32LE(1, 160);
  [VARIABLE, type, 1, DATA, capacity, generation, writeSeq, overwrites].forEach((value, index) => ctrl.writeUInt32LE(value, 176 + index * 4));
  const count = Math.min(writeSeq, capacity);
  for (let index = writeSeq - count; index < writeSeq; index++) {
    transport.data.writeUInt32LE(index >>> 0, (index % capacity) * 8);
    transport.data.writeUInt32LE(100 + index, (index % capacity) * 8 + 4);
  }
}
async function connectedFixture() {
  const transport = transportFixture(), service = new DebugService({ transport });
  await service.connect({ manifest: { profile: 'NEO_75_H_GW_KW', identity, trace: { controlAddress: CTRL, dataAddress: DATA, sampleHz: 20000 } } });
  return { transport, service };
}

test('真实 ABI v5 解码严格检查 magic、控制区长度、数据区地址和通道边界', () => {
  const { ctrl } = memory();
  assert.equal(decodeTraceControl(ctrl, DATA).dataAddress, DATA);
  for (const [offset, value] of [[0, 0], [4, 684], [164, 4], [172, 4000], [168, 0x40000000], [160, 17]]) {
    const corrupt = Buffer.from(ctrl); corrupt.writeUInt32LE(value, offset);
    assert.throws(() => decodeTraceControl(corrupt, DATA));
  }
  const transport = transportFixture(); activate(transport);
  transport.ctrl.writeUInt32LE(DATA + 4090, 188);
  assert.throws(() => decodeTraceControl(transport.ctrl), /布局/);
});

test('有符号整数和 float 位模式还原，非有限浮点明确为空值', () => {
  assert.equal(decodeTraceValue(255, 'i8'), -1); assert.equal(decodeTraceValue(65535, 'i16'), -1);
  assert.equal(decodeTraceValue(0xffffffff, 'u32'), 4294967295); assert.equal(decodeTraceValue(0xffffffff, 'i32'), -1);
  assert.equal(decodeTraceValue(0x3fc00000, 'f32'), 1.5); assert.equal(decodeTraceValue(0x7f800000, 'f32'), null);
});

test('连接只发 attach 连接请求，不读未知地址、不写配置且支持手填十六进制地址', async () => {
  const transport = transportFixture(), service = new DebugService({ transport });
  await service.connect({ serialNumber: '123', controlAddress: '0x2001c000' });
  assert.deepEqual(transport.calls.map(item => item.method), ['connect']);
  assert.equal((await service.status()).connected, true);
  await service.disconnect(); assert.equal((await service.status()).connected, false);
  await assert.rejects(service.readCapture(), /先连接/);
});

test('构建调试连接拒绝旧型号名称且不访问设备', async () => {
  const transport = transportFixture(), service = new DebugService({ transport });
  await assert.rejects(service.connect({ manifest: { profile: 'NEO_75H_KW', identity } }), /仅支持/);
  assert.deepEqual(transport.calls, []);
});

test('配置先核验 ABI 再写完整配置，最后提交 seq，并且不触碰控制区以外', async () => {
  const { service, transport } = await connectedFixture();
  const result = await service.configureCapture({ divider: 20, channels: [{ name: 'Iq', address: VARIABLE, type: 'f32' }] });
  const writes = transport.calls.filter(item => item.method === 'write');
  assert.deepEqual(writes.map(item => item.args.address), [CTRL + 16, CTRL + 8]);
  assert.deepEqual(writes.map(item => Buffer.from(item.args.data, 'base64').length), [136, 4]);
  assert.equal(transport.ctrl.readUInt32LE(24), VARIABLE); assert.equal(transport.ctrl.readUInt32LE(28), 6);
  assert.equal(result.sequence, 1); assert.equal(result.nominalSampleHz, 1000); assert.equal(result.activeRateUnknown, true);
  assert.equal(result.timebase, 'sample-index');
  await service.configureCapture({ divider: 1, channels: [] }); assert.equal(transport.ctrl.readUInt32LE(16), 0);
});

test('坏地址、对齐、通道类型、分频和设备 ABI 均在写入前拒绝', async () => {
  for (const options of [
    { divider: 0, channels: [] }, { channels: [{ address: 0x40000000, type: 'u32' }] },
    { channels: [{ address: VARIABLE + 1, type: 'f32' }] }, { channels: [{ address: VARIABLE, type: 'f64' }] },
    { channels: Array(17).fill({ address: VARIABLE, type: 'u32' }) },
  ]) {
    const { service, transport } = await connectedFixture();
    await assert.rejects(service.configureCapture(options));
    assert.equal(transport.calls.some(item => item.method === 'write'), false);
  }
  const { service, transport } = await connectedFixture(); transport.ctrl.writeUInt32LE(4, 4);
  await assert.rejects(service.configureCapture({ channels: [] }), /ABI/);
  assert.equal(transport.calls.some(item => item.method === 'write'), false);
});

test('采样只返回环形缓冲区已提交数据，重复拉取不会重复，容量覆盖计入丢样', async () => {
  const { service, transport } = await connectedFixture(); activate(transport);
  const first = await service.readCapture();
  assert.deepEqual(first.channels[0].samples.map(item => item.seq), [0, 1, 2]);
  assert.deepEqual(first.channels[0].samples.map(item => item.value), [100, 101, 102]);
  assert.equal((await service.readCapture()).channels[0].samples.length, 0);
  activate(transport, { writeSeq: 10, overwrites: 6 });
  const next = await service.readCapture();
  assert.deepEqual(next.channels[0].samples.map(item => item.seq), [6, 7, 8, 9]);
  assert.equal(next.channels[0].dropped, 3); assert.equal(next.channels[0].overwrites, 6);
});

test('读取时被覆盖的样本丢弃，配置代次改变不会混入旧布局', async () => {
  const { service, transport } = await connectedFixture(); activate(transport);
  transport.mutateData = (read, data) => { if (read === 2) data.writeUInt32LE(0xffffffff, 8); };
  const samples = await service.readCapture();
  assert.deepEqual(samples.channels[0].samples.map(item => item.seq), [0, 2]); assert.equal(samples.channels[0].dropped, 1);
  const second = await connectedFixture(); activate(second.transport);
  second.transport.mutateData = (read, data, ctrl) => { if (read === 2) ctrl.writeUInt32LE(2, 196); };
  assert.deepEqual((await second.service.readCapture()).channels, []);
});

test('USB 服务失败不产生模拟探针或波形，也不会把失败缓存成成功', async () => {
  const service = new DebugService({ transport: { request: async () => { throw new Error('library unavailable'); } } });
  assert.deepEqual((await service.probe()).probes, []);
  assert.equal((await service.probe()).available, false);
  await assert.rejects(service.connect(), /library unavailable/);
  assert.equal((await service.status()).connected, false);
  await assert.rejects(service.readCapture(), /先连接/);
});

test('连接只读固定构建邮箱核对build ID，不匹配则禁止配置和波形读取', async () => {
  const { service, transport } = await connectedFixture();
  assert.equal((await service.status()).identity.verified, true);
  transport.identity.fill(0x34, 16, 48);
  await assert.rejects(service.configureCapture({ channels: [{ address: VARIABLE, type: 'u32' }] }), /构建不同/);
  await assert.rejects(service.readCapture(), /构建不同/);
  assert.equal(transport.calls.some(call => call.method === 'write' || call.method === 'authorizeTrace'), false);
  assert.equal(transport.calls.some(call => call.method === 'read' && call.args.address === CTRL), false);
  const state = await service.status();
  assert.equal(state.connected, true); assert.equal(state.identity.verified, false); assert.equal(state.identity.status, 'mismatch');
});

test('缺失身份、未发布邮箱和半写入启动计数均不会允许使用符号地址', async () => {
  const transport = transportFixture(), service = new DebugService({ transport });
  await service.connect({ manifest: { profile: 'NEO_75_H_GW_KW', trace: { controlAddress: CTRL, dataAddress: DATA } } });
  assert.equal((await service.status()).identity.status, 'unavailable');
  await assert.rejects(service.configureCapture({ channels: [] }), /未提供构建身份/);
  const connected = await connectedFixture(); connected.transport.identity.writeUInt32LE(0, 52);
  await assert.rejects(connected.service.readCapture(), /尚未发布完整/);
  assert.equal((await connected.service.status()).identity.verified, false);
});

test('同一构建重新启动后重置读取游标，保留区数据不与上次启动拼接', async () => {
  const { service, transport } = await connectedFixture(); activate(transport);
  assert.equal((await service.readCapture()).channels[0].samples.length, 3);
  assert.equal((await service.readCapture()).channels[0].samples.length, 0);
  transport.identity.writeUInt32LE(2, 48); transport.identity.writeUInt32LE(0xfffffffd, 52);
  assert.equal((await service.readCapture()).channels[0].samples.length, 3);
});

test('32位序号回绕保留有效样本，保留字 UINT32_MAX 不作为已提交样本', async () => {
  const { service, transport } = await connectedFixture(); activate(transport, { writeSeq: 2, overwrites: 20 });
  for (const [seq, value] of [[0xfffffffe, 10], [0xffffffff, 11], [0, 12], [1, 13]]) {
    transport.data.writeUInt32LE(seq, seq % 4 * 8); transport.data.writeUInt32LE(value, seq % 4 * 8 + 4);
  }
  const result = await service.readCapture();
  assert.deepEqual(result.channels[0].samples.map(item => item.seq), [0xfffffffe, 0, 1]);
  assert.equal(result.channels[0].dropped, 1);
});

test('烧录只接受服务器本地生成的完整双核产物，拒绝外部路径与软链接逃逸', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actuator-debug-'));
  const generated = join(root, '.workbench-local/generated/a'); await mkdir(generated, { recursive: true });
  const outside = join(root, 'outside.bin'); await writeFile(outside, Buffer.alloc(16));
  const cm4 = join(generated, 'cm4.bin'); await writeFile(cm4, Buffer.alloc(16));
  await symlink(outside, join(generated, 'escape.bin'));
  const service = new DebugService({ workspaceRoot: root, transport: transportFixture(), execFile: async () => { throw new Error('must not execute'); } });
  try {
    await assert.rejects(service.flash({ manifest: { profile: 'NEO_75_H_GW_KW', artifacts: [] } }), /唯一/);
    for (const profile of ['NEO_75_E_GW_KW', 'NEO_75_H_JG_KW', 'NEO_75_H_GW_OTHER', 'NEO_75H_KW', 'NEO_75H_LD', 'NEO_75H_SMH', 'NEO_75H_XH']) {
      await assert.rejects(service.flash({ manifest: { profile, artifacts: [] } }), /仅支持/);
    }
    for (const path of [outside, join(generated, 'escape.bin')]) {
      await assert.rejects(service.flash({ manifest: { profile: 'NEO_75_H_GW_KW', artifacts: [{ core: 'cm7', kind: 'bin', path, size: 16 }, { core: 'cm4', kind: 'bin', path: cm4, size: 16 }] } }), /仅允许/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('规范型号可烧录且不改写清单，双核校验成功后保持停止', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actuator-program-'));
  const generated = join(root, '.workbench-local/generated/a'); await mkdir(generated, { recursive: true });
  const artifacts = [];
  for (const core of ['cm7', 'cm4']) { const path = join(generated, `${core}.bin`); await writeFile(path, Buffer.alloc(16)); artifacts.push({ core, kind: 'bin', path, size: 16, sha256: createHash('sha256').update(Buffer.alloc(16)).digest('hex') }); }
  const executable = join(root, 'JLinkExe'); await writeFile(executable, '');
  const calls = [];
  const execFile = async (exe, args) => {
    const script = await readFile(args.at(-1), 'utf8'); calls.push({ args, script });
    return { stdout: script.trim().split('\n').map(command => `J-Link>${command}\n${command.startsWith('verifybin ') ? 'O.K.' : ''}`).join('\n') };
  };
  const service = new DebugService({ workspaceRoot: root, jlinkExe: executable, transport: transportFixture(), execFile });
  try {
    for (const variant of ['KW', 'LD', 'SMH', 'XH']) {
      const profile = `NEO_75_H_GW_${variant}`;
      const manifest = { profile, artifacts }, before = JSON.stringify(manifest);
      const result = await service.flash({ manifest });
      assert.equal(result.programmed, true); assert.equal(result.verified, true); assert.equal(result.resumed, false);
      assert.equal(JSON.stringify(manifest), before);
    }
    assert.equal(calls[0].args[1], 'STM32H745II_M4'); assert.equal(calls[1].args[1], 'STM32H745II_M7');
    assert.equal(calls[0].script.includes('loadfile'), false);
    assert.equal((calls[1].script.match(/verifybin/g) || []).length, 2);
    for (const call of calls) assert.equal(/^(?:r|reset|g|go)$/m.test(call.script), false);
    service.exec = async () => ({ stdout: 'O.K.\nO.K.\n' });
    await assert.rejects(service.flash({ manifest: { profile: 'NEO_75_H_GW_KW', artifacts } }), /未确认双核校验成功/);
    artifacts[0].sha256 = '0'.repeat(64);
    await assert.rejects(service.flash({ manifest: { profile: 'NEO_75_H_GW_KW', artifacts } }), /产物已改变/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
