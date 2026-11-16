/** NEO_75_H_GW_* M7 trace ABI v5. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, realpath, stat, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_JLINK = '/Applications/SEGGER/JLink_V992';
export const TRACE_ABI = Object.freeze({ version: 5, magic: 0x05545243, controlSize: 688, dataSize: 4096, sampleSize: 8, channels: 16 });
export const TRACE_TYPES = Object.freeze(['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f32']);
export const BUILD_IDENTITY = Object.freeze({ magic: 0x42415641, version: 1, size: 64, mailboxAddress: 0x2001ffc0 });
const typeSizes = [1, 1, 2, 2, 4, 4, 4];
const supportedProfile = profile => typeof profile === 'string' && /^NEO_75_H_GW_(?:KW|LD|SMH|XH)$/.test(profile);
const RAM = [[0x20000000, 0x20000], [0x24000000, 0x80000], [0x30000000, 0x48000], [0x38000000, 0x10000], [0x38800000, 0x1000]];
const uint = (value, label, min = 0, max = 0xffffffff) => {
  const number = typeof value === 'string' && /^(?:0x[0-9a-f]+|\d+)$/i.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label}必须为 ${min}–${max} 的整数。`);
  return number;
};
const ramAddress = (value, size = 4) => {
  const address = uint(value, '地址');
  if (!RAM.some(([start, length]) => address >= start && address + size <= start + length)) throw new Error('地址不属于 NEO_75_H_GW_* 可采样的 RAM 区域。');
  return address;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const contained = (root, path) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith(`..`) && !isAbsolute(rel); };

/** Decode independently of transport so ABI checks are testable without hardware. */
export function decodeTraceControl(buffer, expectedDataAddress) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== TRACE_ABI.controlSize) throw new Error('采样控制区读取长度不正确。');
  const u32 = offset => buffer.readUInt32LE(offset);
  if (u32(0) !== TRACE_ABI.magic || u32(4) !== TRACE_ABI.controlSize) throw new Error('设备采样控制区不是受支持的 trace ABI v5，未写入任何配置。');
  if (u32(164) !== 8 || u32(172) !== 4096) throw new Error('设备采样缓冲区布局与 ABI 不一致。');
  const dataAddress = ramAddress(u32(168), 4096);
  if (dataAddress % 4 || (expectedDataAddress !== undefined && dataAddress !== expectedDataAddress)) throw new Error('设备波形区地址与构建符号不一致。');
  const enabledMask = u32(16);
  if (enabledMask > 0xffff || u32(160) > 16 || u32(152) > 6) throw new Error('采样控制区内容无效。');
  const states = Array.from({ length: 16 }, (_, index) => {
    const at = 176 + 32 * index;
    const state = { index, address: u32(at), type: u32(at + 4), active: u32(at + 8), bufferAddress: u32(at + 12), capacity: u32(at + 16), generation: u32(at + 20), writeSeq: u32(at + 24), overwrites: u32(at + 28) };
    if (state.active) {
      if (state.active !== 1 || state.type >= TRACE_TYPES.length || !state.capacity || state.capacity > 512 || state.bufferAddress % 4 || state.bufferAddress < dataAddress || state.bufferAddress + state.capacity * 8 > dataAddress + 4096) throw new Error(`通道 ${index + 1} 的波形区布局无效。`);
      ramAddress(state.address, typeSizes[state.type]);
    }
    return state;
  });
  return { sequence: u32(8), ack: u32(12), enabledMask, divider: u32(20), status: u32(152), errorChannel: u32(156), activeCount: u32(160), dataAddress, states };
}

export function decodeTraceValue(raw, type) {
  if (type === 'u8') return raw & 0xff;
  if (type === 'i8') return (raw << 24) >> 24;
  if (type === 'u16') return raw & 0xffff;
  if (type === 'i16') return (raw << 16) >> 16;
  if (type === 'u32') return raw >>> 0;
  if (type === 'i32') return raw | 0;
  if (type === 'f32') { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(raw); const value = bytes.readFloatLE(); return Number.isFinite(value) ? value : null; }
  throw new Error('不支持的采样类型。');
}

class PythonTransport {
  constructor({ python, library }) { this.python = python; this.library = library; this.child = null; this.pending = new Map(); this.sequence = 0; this.logs = ''; }
  start() {
    if (this.child) return;
    const child = spawn(this.python, ['-u', join(here, 'jlink_bridge.py'), this.library], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child; let output = '';
    const fail = error => { for (const [id, request] of this.pending.entries()) if (request.child === child) { clearTimeout(request.timer); request.reject(error); this.pending.delete(id); } if (this.child === child) this.child = null; };
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.on('exit', (code, signal) => fail(new Error(`J-Link 服务退出（${signal || code}）。${this.logs.slice(-700)}`)));
    child.stderr.on('data', data => { this.logs = (this.logs + data).slice(-6000); });
    child.stdout.on('data', data => {
      output += data.toString();
      if (output.length > 1024 * 1024) { child.kill(); fail(new Error('J-Link 服务响应过大。')); return; }
      while (output.includes('\n')) {
        const end = output.indexOf('\n'), line = output.slice(0, end); output = output.slice(end + 1);
        let response; try { response = JSON.parse(line); } catch { continue; }
        const request = this.pending.get(response.id); if (!request) continue;
        this.pending.delete(response.id); clearTimeout(request.timer);
        if (response.error) request.reject(new Error(response.error)); else request.resolve(response.result);
      }
    });
  }
  request(method, args = {}) {
    this.start(); const id = ++this.sequence, child = this.child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('J-Link 请求超时。')); child.kill(); }, 15000);
      this.pending.set(id, { resolve, reject, timer, child });
      child.stdin.write(JSON.stringify({ id, method, args }) + '\n');
    });
  }
  close() { const child = this.child; this.child = null; child?.stdin.end(); }
}

export class DebugService {
  constructor(options = {}) {
    this.workspaceRoot = resolve(options.workspaceRoot || join(here, '../..'));
    this.library = options.jlinkLibrary || join(DEFAULT_JLINK, 'libjlinkarm.dylib');
    this.jlinkExe = options.jlinkExe || join(DEFAULT_JLINK, 'JLinkExe');
    this.transport = options.transport || new PythonTransport({ python: options.python || 'python3', library: this.library });
    this.state = { connected: false, device: 'STM32H745II_M7', serialNumber: null, capture: null, lastError: null, activeRateUnknown: true };
    this.queue = Promise.resolve(); this.trace = null; this.channels = []; this.cursors = new Map(); this.sampleHz = null;
    this.expectedIdentity = null; this.identityRequired = false; this.bootSequence = null;
    this.exec = options.execFile || exec;
  }
  _run(operation) {
    const result = this.queue.then(operation).catch(error => { this.state.lastError = error.message; throw error; });
    this.queue = result.catch(() => {}); return result;
  }
  _call(method, args) { return this.transport.request(method, args); }
  async _read(address, size) {
    const result = await this._call('read', { address, size });
    const bytes = Buffer.from(result.data, 'base64'); if (bytes.length !== size) throw new Error('J-Link 返回的 RAM 数据不完整。');
    return bytes;
  }
  _require() { if (!this.state.connected) throw new Error('请先连接 J-Link。'); }
  _setTrace(options = {}) {
    const trace = options.manifest?.trace || options.manifest?.debug?.trace || {};
    const address = options.controlAddress ?? trace.controlAddress ?? this.trace?.controlAddress;
    const data = options.dataAddress ?? trace.dataAddress ?? this.trace?.dataAddress;
    if (address !== undefined && address !== null) {
      const controlAddress = ramAddress(address, 688);
      if (controlAddress % 4) throw new Error('控制区地址必须 4 字节对齐。');
      this.trace = { controlAddress, ...(data !== undefined && data !== null ? { dataAddress: ramAddress(data, 4096) } : {}) };
    }
    const sampleHz = options.sampleHz ?? trace.sampleHz;
    if (sampleHz !== undefined && sampleHz !== null) { if (!Number.isFinite(sampleHz) || sampleHz <= 0) throw new Error('控制周期标称频率无效。'); this.sampleHz = sampleHz; }
  }
  async _control() {
    if (!this.trace) throw new Error('缺少 M7 的 g_debug_trace_ctrl 地址，请构建后选择符号或填写地址。');
    return decodeTraceControl(await this._read(this.trace.controlAddress, 688), this.trace.dataAddress);
  }
  async _verifyIdentity() {
    const expected = this.expectedIdentity;
    if (!expected) return this.state.identity = { verified: false, status: 'unavailable', message: '未提供构建身份，不能确认 ELF 符号与设备运行映像一致。' };
    try {
      const first = await this._read(BUILD_IDENTITY.mailboxAddress, BUILD_IDENTITY.size);
      const second = await this._read(BUILD_IDENTITY.mailboxAddress, BUILD_IDENTITY.size);
      const read = offset => second.readUInt32LE(offset), bootSequence = read(48);
      if (!first.equals(second) || read(0) !== BUILD_IDENTITY.magic || read(4) !== 1 || read(8) !== 64 || ((bootSequence ^ read(52)) >>> 0) !== 0xffffffff) throw new Error('设备构建邮箱尚未发布完整信息。');
      const actual = second.subarray(16, 48).toString('hex');
      const verified = actual === expected.buildId && read(12) === expected.imageAddress && (read(56) & ~1) === (expected.resetHandler & ~1);
      if (this.bootSequence !== null && this.bootSequence !== bootSequence) this.cursors.clear();
      this.bootSequence = bootSequence;
      return this.state.identity = { verified, status: verified ? 'verified' : 'mismatch', buildId: actual, expectedBuildId: expected.buildId, bootSequence, observedAt: new Date().toISOString(), message: verified ? '设备运行映像与所选 M7 构建身份一致。' : '设备运行映像与所选 M7 构建不同，请选择对应产物或重新烧录并启动。' };
    } catch (error) { return this.state.identity = { verified: false, status: 'unavailable', message: error.message }; }
  }
  async _requireIdentity() {
    if (this.identityRequired && !(await this._verifyIdentity()).verified) throw new Error(this.state.identity.message);
  }
  status() { return this._run(async () => {
    if (this.state.connected) Object.assign(this.state, await this._call('status'));
    return structuredClone(this.state);
  }); }
  probe() { return this._run(async () => {
    try { const result = await this._call('probe'); this.state.available = result.available; return result; }
    catch (error) { this.state.available = false; return { available: false, library: this.library, probes: [], error: error.message }; }
  }); }
  connect(options = {}) { return this._run(async () => {
    if (this.state.connected) throw new Error('请先断开当前连接。');
    if (options.manifest && !supportedProfile(options.manifest.profile)) throw new Error('仅支持已构建的 NEO_75_H_GW_* 硬件配置。');
    this.trace = null; this.sampleHz = null; this.channels = []; this.cursors.clear();
    this.identityRequired = Boolean(options.manifest); this.expectedIdentity = null; this.bootSequence = null;
    const identity = options.manifest?.identity;
    if (identity) {
      if (!/^[a-f0-9]{64}$/i.test(identity.buildId || '') || /^0{64}$/.test(identity.buildId)) throw new Error('所选构建身份无效，请重新编译。');
      const mailboxAddress = uint(identity.mailboxAddress, '构建邮箱地址'), imageAddress = uint(identity.imageAddress, '构建信息地址'), resetHandler = uint(identity.resetHandler, '复位入口');
      if (mailboxAddress !== BUILD_IDENTITY.mailboxAddress || imageAddress < 0x08000000 || imageAddress + 64 > 0x08100000 || (resetHandler & ~1) < 0x08000000 || (resetHandler & ~1) >= 0x08100000) throw new Error('所选 M7 构建身份地址不符合 NEO_75_H_GW_* 布局。');
      this.expectedIdentity = { ...identity, buildId: identity.buildId.toLowerCase(), imageAddress, resetHandler };
    }
    this._setTrace(options);
    const speedKHz = uint(options.speedKHz ?? 4000, 'SWD 速度', 5, 50000);
    const serialNumber = options.serialNumber === undefined || options.serialNumber === null || options.serialNumber === '' ? undefined : uint(options.serialNumber, '探针序列号', 1);
    Object.assign(this.state, await this._call('connect', { speedKHz, ...(serialNumber ? { serialNumber } : {}) }), { capture: null, lastError: null });
    if (this.identityRequired) await this._verifyIdentity();
    else this.state.identity = { verified: false, status: 'manual', message: '手动地址连接，未核对构建身份。' };
    // Only the fixed build mailbox is read; no trace configuration is written.
    return structuredClone(this.state);
  }); }
  disconnect() { return this._run(async () => {
    try { if (this.state.connected) await this._call('disconnect'); }
    finally { this.transport.close?.(); this.state.connected = false; this.state.serialNumber = null; this.state.capture = null; this.cursors.clear(); }
    return structuredClone(this.state);
  }); }
  configureCapture(options = {}) { return this._run(async () => {
    this._require(); await this._requireIdentity(); this._setTrace(options);
    const divider = uint(options.divider ?? 1, '采样分频', 1, 1000000);
    if (!Array.isArray(options.channels) || options.channels.length > 16) throw new Error('采样通道必须为不超过 16 项的列表。');
    const channels = options.channels.map((channel, index) => {
      if (!channel || !TRACE_TYPES.includes(channel.type)) throw new Error(`通道 ${index + 1} 类型无效。`);
      const type = TRACE_TYPES.indexOf(channel.type), address = ramAddress(channel.address, typeSizes[type]);
      if (address % typeSizes[type]) throw new Error(`通道 ${index + 1} 地址未按类型对齐。`);
      if (channel.name !== undefined && (typeof channel.name !== 'string' || channel.name.length > 120)) throw new Error('通道名称过长或格式无效。');
      return { name: channel.name || `通道 ${index + 1}`, address, type: channel.type };
    });
    const before = await this._control();
    if (before.sequence !== before.ack) throw new Error('设备仍在处理上次采样配置，请稍后重试。');
    const bytes = Buffer.alloc(136); bytes.writeUInt32LE(channels.length ? (1 << channels.length) - 1 : 0, 0); bytes.writeUInt32LE(divider, 4);
    channels.forEach((channel, index) => { bytes.writeUInt32LE(channel.address, 8 + index * 8); bytes.writeUInt32LE(TRACE_TYPES.indexOf(channel.type), 12 + index * 8); });
    const sequence = (before.sequence + 1) >>> 0, commit = Buffer.alloc(4); commit.writeUInt32LE(sequence);
    await this._call('authorizeTrace', { address: this.trace.controlAddress });
    await this._call('write', { address: this.trace.controlAddress + 16, data: bytes.toString('base64') });
    await this._call('write', { address: this.trace.controlAddress + 8, data: commit.toString('base64') });
    const deadline = Date.now() + 2000;
    let applied;
    do {
      applied = await this._control();
      if (applied.ack === sequence) break;
      await sleep(20);
    } while (Date.now() < deadline);
    if (applied.ack !== sequence) throw new Error('采样配置尚未获固件确认；M7 可能停止或未执行采样中断。');
    if (applied.status !== 1) throw new Error(`固件拒绝采样配置：状态 ${applied.status}，通道 ${applied.errorChannel + 1}。`);
    this.channels = channels; this.cursors.clear();
    this.state.capture = { configured: true, enabled: channels.length > 0, divider, channels, sequence };
    this.state.lastError = null;
    return { ...structuredClone(this.state.capture), nominalSampleHz: this.sampleHz ? this.sampleHz / divider : null, activeRateUnknown: true, timebase: 'sample-index' };
  }); }
  readCapture() { return this._run(async () => {
    this._require(); await this._requireIdentity();
    const before = await this._control();
    if (before.sequence !== before.ack) throw new Error('采样配置更新中，请稍后读取。');
    // Two snapshots and firmware sequence markers reject slots overwritten mid-read.
    const first = await this._read(before.dataAddress, 4096), second = await this._read(before.dataAddress, 4096), after = await this._control();
    if (before.sequence !== after.sequence || before.ack !== after.ack || before.dataAddress !== after.dataAddress || before.divider !== after.divider) throw new Error('读取期间采样配置发生变化，请重新读取。');
    const channels = [];
    for (const state of before.states) {
      if (!state.active) continue;
      const latest = after.states[state.index];
      if (!latest.active || ['generation', 'bufferAddress', 'capacity', 'type', 'address'].some(key => state[key] !== latest[key])) { this.cursors.delete(state.index); continue; }
      const previous = this.cursors.get(state.index), delta = previous ? (state.writeSeq - previous.nextSeq) >>> 0 : 0;
      const sameGeneration = previous?.generation === state.generation && delta <= 0x7fffffff;
      const available = sameGeneration ? delta : (state.overwrites ? state.capacity : Math.min(state.writeSeq, state.capacity));
      const count = Math.min(available, state.capacity), start = (state.writeSeq - count) >>> 0;
      let dropped = Math.max(0, available - count); const samples = [];
      for (let offset = 0; offset < count; offset++) {
        const seq = (start + offset) >>> 0, address = state.bufferAddress - before.dataAddress + (seq % state.capacity) * 8;
        if (seq === 0xffffffff || first.readUInt32LE(address) !== seq || second.readUInt32LE(address) !== seq || first.readUInt32LE(address + 4) !== second.readUInt32LE(address + 4)) { dropped++; continue; }
        const raw = first.readUInt32LE(address + 4);
        samples.push({ seq, raw, value: decodeTraceValue(raw, TRACE_TYPES[state.type]) });
      }
      this.cursors.set(state.index, { generation: state.generation, nextSeq: state.writeSeq });
      const configured = this.channels[state.index];
      channels.push({ index: state.index, name: configured?.address === state.address && configured?.type === TRACE_TYPES[state.type] ? configured.name : `通道 ${state.index + 1}`, address: state.address, type: TRACE_TYPES[state.type], generation: state.generation, overwrites: state.overwrites, dropped, samples });
    }
    this.state.lastError = null;
    return { channels, sequence: after.sequence, status: after.status, divider: after.divider, nominalSampleHz: this.sampleHz && after.divider ? this.sampleHz / after.divider : null, activeRateUnknown: true, timebase: 'sample-index', receivedAt: new Date().toISOString() };
  }); }

  flash(options = {}) { return this._run(async () => {
    if (this.state.connected) throw new Error('烧录前请先断开波形调试连接。');
    const manifest = options.manifest;
    if (!manifest || !Array.isArray(manifest.artifacts)) throw new Error('缺少服务器保存的本地构建清单。');
    if (!supportedProfile(manifest.profile)) throw new Error('仅支持已构建的 NEO_75_H_GW_* 硬件配置。');
    const root = await realpath(join(this.workspaceRoot, '.workbench-local/generated'));
    const images = [];
    for (const [core, address] of [['cm7', 0x08000000], ['cm4', 0x08100000]]) {
      const candidates = manifest.artifacts.filter(item => item.core === core && item.kind === 'bin');
      if (candidates.length !== 1) throw new Error(`构建清单需要唯一的 ${core} bin 产物。`);
      const artifact = candidates[0], path = await realpath(resolve(this.workspaceRoot, artifact.path));
      if (!contained(root, path) || /["\r\n]/.test(path)) throw new Error('仅允许烧录当前工作区生成目录内的产物。');
      const info = await stat(path);
      if (!info.isFile() || info.size < 8 || info.size > 1024 * 1024 || artifact.size !== info.size || (artifact.loadAddress !== undefined && uint(artifact.loadAddress, '加载地址') !== address)) throw new Error(`${core} 产物大小或 Flash 地址不符合双核构建布局。`);
      if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error(`${core} 构建产物缺少 SHA-256 校验，请重新构建。`);
      if (createHash('sha256').update(await readFile(path)).digest('hex') !== artifact.sha256.toLowerCase()) throw new Error(`${core} 产物已改变，请重新构建后再烧录。`);
      images.push({ core, path, address, size: info.size });
    }
    const probes = await this._call('probe');
    const serialNumber = options.serialNumber === undefined ? (probes.probes.length === 1 ? probes.probes[0].serialNumber : null) : uint(options.serialNumber, '探针序列号', 1);
    if (!probes.probes.some(item => item.serialNumber === serialNumber)) throw new Error('请指定已枚举的 J-Link 序列号。');
    const speedKHz = uint(options.speedKHz ?? 4000, 'SWD 速度', 5, 50000);
    await access(this.jlinkExe); await mkdir(join(root, '.flash'), { recursive: true });
    const script = join(root, '.flash', `program-${Date.now()}.jlink`), haltScript = script.replace('.jlink', '-cm4.jlink');
    const common = ['-if', 'SWD', '-speed', String(speedKHz), '-SelectEmuBySN', String(serialNumber), '-NoGui', '1', '-ExitOnError', '1'];
    let output = '';
    try {
      // Stop M4 before its flash bank is changed. Keep both cores stopped afterwards.
      await writeFile(haltScript, 'exec SetRestartOnClose = 0\nconnect\nh\nq\n');
      output += (await this.exec(this.jlinkExe, ['-device', 'STM32H745II_M4', ...common, '-CommandFile', haltScript], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 })).stdout;
      const commands = ['exec SetRestartOnClose = 0', 'connect', 'h', ...images.flatMap(image => [`loadfile "${image.path}" 0x${image.address.toString(16)}`, `verifybin "${image.path}" 0x${image.address.toString(16)}`]), 'q'];
      await writeFile(script, commands.join('\n') + '\n');
      output += (await this.exec(this.jlinkExe, ['-device', 'STM32H745II_M7', ...common, '-CommandFile', script], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 })).stdout;
      const blocks = output.split(/(?:^|\n)J-Link>/);
      const verified = images.every(image => blocks.some(block => /^verifybin\s/i.test(block) && block.split('\n')[0].includes(image.path) && /(?:Verify successful|\bO\.K\.)/i.test(block.slice(block.indexOf('\n')))));
      if (!verified || /ERROR:|Failed to|Cannot connect|Verification failed/i.test(output)) throw new Error(`J-Link 未确认双核校验成功。\n${output.slice(-6000)}`);
      return { programmed: true, verified: true, resumed: false, images, serialNumber, output: output.slice(-20000), message: '双核固件已烧录并校验，未执行复位或运行命令。' };
    } finally { await Promise.all([rm(script, { force: true }), rm(haltScript, { force: true })]); }
  }); }
}
