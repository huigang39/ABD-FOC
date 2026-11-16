import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { getMcuCores } from '../web/src/modules/hardware/hw-platform/targets.mjs';
import { getSelectedLayerRelease } from '../web/src/features/configuration/versions.mjs';
import { BuildFailure } from './errors.mjs';
import { encodeIntelHex } from './intel-hex.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new BuildFailure('INVALID_FIRMWARE', message, {status:422, stage:'delivery'}); };
const inside = (root, file) => { const path = relative(root, file); return path && !path.startsWith('..') && !isAbsolute(path); };
const MAX_IMAGE = 16 * 1024 * 1024;

/** A direct flashable HEX file for development, not an encrypted Bootloader package. */
export async function deliverFirmware({ project, result, outputRoot, buildId, fingerprint }) {
  const manifest = result?.manifest;
  if (result?.status !== 'built' || manifest?.firmwareReady !== true || manifest?.artifactKind === 'module-library') fail('构建结果不是完整固件镜像，不能交付模块库。');
  if (manifest.projectFingerprint !== fingerprint || manifest.mcu !== project.target.mcu) fail('固件目标或配置指纹与本次请求不一致。');
  const expected = getMcuCores(project.target.mcu).map(core => core.id);
  if (!expected.length) fail('目标 MCU 尚未定义固件内核。');
  const artifacts = (result.artifacts || manifest.artifacts || []).filter(item => item.kind === 'bin');
  if (artifacts.length !== expected.length || new Set(artifacts.map(item=>item.core)).size !== expected.length || artifacts.some(item=>!expected.includes(item.core))) fail('目标 MCU 的各内核镜像不完整或重复，无法导出 HEX。');
  const base = await realpath(outputRoot), root = await realpath(result.root);
  if (!inside(base, root)) fail('构建产物不在本次构建目录内。');
  const images = [];
  for (const core of expected) {
    const artifact = artifacts.find(item => item.core === core);
    const file = await realpath(artifact.path);
    if (!inside(root, file)) fail('镜像文件不在本次构建目录内。');
    const info = await stat(file);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE || artifact.size !== info.size) fail('镜像长度不符合构建记录。');
    const data = await readFile(file), sha256 = hash(data);
    if (data.length !== info.size || artifact.sha256 !== sha256) fail('镜像校验值不符合构建记录。');
    const address = artifact.loadAddress ?? artifact.address ?? manifest.flashaddresses?.[core];
    if (!Number.isSafeInteger(address) || address < 0 || address % 4 || address + data.length > 0x100000000) fail('镜像缺少有效的烧录地址。');
    const banks = project.memory.layout.banks;
    if (!banks.some(bank => bank.executable === true && address >= bank.baseAddress && address + data.length <= bank.baseAddress + bank.sizeKiB * 1024)) fail('镜像超出已配置的可执行 Flash 区域。');
    for (const id of ['motion-calibration','parameters','fault-records']) {
      const placement = project.memory.placements[id], bank = banks.find(bank => bank.id === placement.bankId);
      for (const sector of bank?.sectors.filter(sector => placement.sectorIds.includes(sector.id)) || []) {
        const start = bank.baseAddress + sector.offsetKiB * 1024;
        if (address < start + sector.sizeKiB * 1024 && address + data.length > start) fail('固件镜像与校准、参数或日志扇区重叠。');
      }
    }
    if (images.some(image => address < image.address + image.data.length && address + data.length > image.address)) fail('不同内核镜像的烧录范围发生重叠。');
    images.push({core, file:`${core}.bin`, address, size:data.length, sha256, data});
  }
  const publicManifest = { schemaVersion:1, format:'intel-hex', buildId, fingerprint, target:{mcu:project.target.mcu,board:project.target.board}, encrypted:false, signed:false,
    layers:Object.fromEntries(['hardware','foc','app'].map(layer=>[layer,getSelectedLayerRelease(project,layer)?.version || null])),
    images:images.map(({data,...image})=>image) };
  const bytes = encodeIntelHex(images);
  return {bytes,filename:`firmware-${buildId}.hex`,contentType:'application/octet-stream',format:'intel-hex',sha256:hash(bytes),manifest:publicManifest};
}
