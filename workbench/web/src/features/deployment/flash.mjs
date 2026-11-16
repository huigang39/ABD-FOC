/** Physical Flash declarations and project placement. No MCU geometry is inferred. */
import { checkRamShape, validateRam } from './ram.mjs';
export const MEMORY_REGIONS = Object.freeze([
  { id: 'hardware', label: '硬件', kind: 'firmware', moduleId: 'hw-platform' },
  { id: 'foc', label: '算法', kind: 'firmware', moduleId: 'foc-lifecycle' },
  { id: 'app', label: '应用', kind: 'firmware', moduleId: 'app-runtime' },
  { id: 'motion-calibration', label: '校准', kind: 'data', moduleId: 'app-params', parameterKey: 'motionCalibrationKiB' },
  { id: 'parameters', label: '参数', kind: 'data', moduleId: 'app-params', parameterKey: 'parametersKiB' },
  { id: 'fault-records', label: '日志', kind: 'data', moduleId: 'app-params', parameterKey: 'runtimeRecordsKiB' },
].map(Object.freeze));

const regionIds = MEMORY_REGIONS.map(region => region.id);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
const emptyPlacement = () => ({ bankId: '', sectorIds: [], budgetKiB: null });
const bytes = (value, allowZero = false) => typeof value === 'number' && Number.isFinite(value)
  && (allowZero ? value >= 0 : value > 0) && Number.isSafeInteger(value * 1024) ? value * 1024 : null;
const address = value => Number.isSafeInteger(value) && value >= 0;
const safeEnd = (start, size) => address(start) && size !== null && Number.isSafeInteger(start + size) ? start + size : null;
const mcuKey = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
const boardKey = value => typeof value === 'string' ? value.trim() : '';

export function createMemoryLayout(target = {}) {
  return { mcu: target.mcu || '', board: target.board || '', banks: [] };
}
export function createMemoryPlan(target = {}) {
  return { layout: createMemoryLayout(target), placements: Object.fromEntries(regionIds.map(id => [id, emptyPlacement()])) };
}
export function createMemoryBank() {
  return { id: makeId('flash'), name: 'Flash', baseAddress: null, sizeKiB: null, executable: true, sectors: [] };
}
/** 旧草稿的可执行代码为三态文本；迁移为开关布尔值（no → false，其余视为可执行）。 */
export function migrateMemoryLayoutValues(layout) {
  for (const bank of layout?.banks || []) if (typeof bank.executable === 'string') bank.executable = bank.executable !== 'no';
}
export function createMemorySector() {
  return { id: makeId('sector'), name: '', offsetKiB: null, sizeKiB: null, reserved: false };
}

function keys(value, allowed, location) {
  if (!plain(value)) throw new Error(`${location} 必须是对象。`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${location} 含未知字段：${key}`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) throw new Error(`${location} 缺少字段：${key}`);
}
function text(value, location, nonempty = false) {
  if (typeof value !== 'string' || (nonempty && !value.trim())) throw new Error(`${location} 必须是${nonempty ? '非空' : ''}文本。`);
}
function number(value, location) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${location} 必须是有限数字或 null。`);
}
function collection(value, location, limit) {
  if (!Array.isArray(value)) throw new Error(`${location} 必须是数组。`);
  if (value.length > limit) throw new Error(`${location} 最多包含 ${limit} 项。`);
  const ids = new Set();
  for (const item of value) {
    if (!plain(item)) throw new Error(`${location} 的条目必须是对象。`);
    text(item.id, `${location}.id`, true);
    if (ids.has(item.id)) throw new Error(`${location} 含重复 id：${item.id}`);
    ids.add(item.id);
  }
}
function checkBank(bank, location) {
  keys(bank, ['id', 'name', 'baseAddress', 'sizeKiB', 'executable', 'sectors'], location);
  text(bank.id, `${location}.id`, true); text(bank.name, `${location}.name`);
  number(bank.baseAddress, `${location}.baseAddress`); number(bank.sizeKiB, `${location}.sizeKiB`);
  if (typeof bank.executable !== 'boolean') throw new Error(`${location}.executable 必须是布尔值。`);
  collection(bank.sectors, `${location}.sectors`, 4096);
  for (const sector of bank.sectors) {
    const at = `${location}.sectors.${sector.id}`;
    keys(sector, ['id', 'name', 'offsetKiB', 'sizeKiB', 'reserved'], at);
    text(sector.id, `${at}.id`, true); text(sector.name, `${at}.name`);
    number(sector.offsetKiB, `${at}.offsetKiB`); number(sector.sizeKiB, `${at}.sizeKiB`);
    if (typeof sector.reserved !== 'boolean') throw new Error(`${at}.reserved 必须是布尔值。`);
  }
}
export function checkMemoryLayoutShape(layout) {
  keys(layout, ['mcu', 'board', 'banks'], 'memory.layout');
  text(layout.mcu, 'memory.layout.mcu'); text(layout.board, 'memory.layout.board');
  collection(layout.banks, 'memory.layout.banks', 64);
  layout.banks.forEach((bank, index) => checkBank(bank, `memory.layout.banks[${index}]`));
  return true;
}
export function checkMemoryPlanShape(plan) {
  keys(plan, ['layout', 'placements', ...(Object.hasOwn(plan || {}, 'ram') ? ['ram'] : [])], 'memory');
  if (Object.hasOwn(plan, 'ram')) checkRamShape(plan.ram);
  checkMemoryLayoutShape(plan.layout);
  keys(plan.placements, regionIds, 'memory.placements');
  for (const id of regionIds) {
    const placement = plan.placements[id], at = `memory.placements.${id}`;
    keys(placement, ['bankId', 'sectorIds', 'budgetKiB'], at);
    text(placement.bankId, `${at}.bankId`); number(placement.budgetKiB, `${at}.budgetKiB`);
    if (!Array.isArray(placement.sectorIds) || placement.sectorIds.length > 4096) throw new Error(`${at}.sectorIds 必须是最多 4096 项的数组。`);
    for (const sectorId of placement.sectorIds) text(sectorId, `${at}.sectorIds`, true);
    if (new Set(placement.sectorIds).size !== placement.sectorIds.length) throw new Error(`${at}.sectorIds 含重复引用。`);
  }
  return true;
}

/** Explicitly create a uniform erase layout; never replace existing sector declarations. */
export function generateUniformSectors(bank, sizeKiB) {
  checkBank(bank, 'Flash');
  if (bank.sectors.length) throw new Error('已有扇区定义，不能覆盖生成。请新增存储区或逐项调整。');
  const totalBytes = bytes(bank.sizeKiB), sectorBytes = bytes(sizeKiB);
  if (totalBytes === null || sectorBytes === null) throw new Error('Flash 容量和擦除扇区大小必须为正数，且能换算为整数个字节。');
  const count = totalBytes / sectorBytes;
  if (!Number.isSafeInteger(count) || count < 1 || count > 4096) throw new Error('Flash 容量必须是擦除扇区大小的整数倍，扇区数量为 1–4096。');
  return Array.from({ length: count }, (_, index) => ({
    id: `${bank.id}-erase-${sectorBytes}-${index}`, name: `扇区 ${index}`,
    offsetKiB: index * sectorBytes / 1024, sizeKiB: sectorBytes / 1024, reserved: false,
  }));
}

/** endAddress is exclusive. Invalid or disconnected spans never produce a fake linker range. */
export function getMemoryRegion(project, regionId) {
  const region = MEMORY_REGIONS.find(item => item.id === regionId);
  if (!region) throw new Error(`未知存储用途：${String(regionId)}`);
  const source = project?.memory?.placements?.[regionId];
  const placement = plain(source) ? source : emptyPlacement();
  const banks = project?.memory?.layout?.banks;
  const bank = Array.isArray(banks) ? banks.find(item => item.id === placement.bankId) || null : null;
  const selected = Array.isArray(placement.sectorIds) ? placement.sectorIds : [];
  const bankSectors = Array.isArray(bank?.sectors) ? bank.sectors : [];
  const sectors = selected.map(id => bankSectors.find(sector => sector.id === id)).filter(Boolean)
    .sort((a, b) => (a.offsetKiB ?? Infinity) - (b.offsetKiB ?? Infinity));
  const required = region.kind === 'data' ? project?.instances?.['app-params']?.parameters?.[region.parameterKey] : placement.budgetKiB;
  const requiredBytes = bytes(required, region.kind === 'data');
  const requiredKiB = requiredBytes === null ? null : requiredBytes / 1024;
  let capacityKiB = null, startAddress = null, endAddress = null, contiguous = false;
  const bankBytes = bytes(bank?.sizeKiB), bankEnd = safeEnd(bank?.baseAddress, bankBytes);
  if (bankEnd !== null && sectors.length && sectors.length === selected.length && new Set(selected).size === selected.length) {
    const spans = sectors.map(sector => ({ start: bytes(sector.offsetKiB, true), size: bytes(sector.sizeKiB), reserved: sector.reserved }));
    const valid = spans.every(span => span.start !== null && span.size !== null && !span.reserved
      && Number.isSafeInteger(span.start + span.size) && span.start + span.size <= bankBytes);
    if (valid) {
      contiguous = spans.every((span, index) => !index || span.start === spans[index - 1].start + spans[index - 1].size);
      if (contiguous) {
        capacityKiB = spans.reduce((sum, span) => sum + span.size, 0) / 1024;
        startAddress = bank.baseAddress + spans[0].start;
        endAddress = startAddress + capacityKiB * 1024;
      }
    }
  }
  return { region, placement, bank, sectors, capacityKiB, requiredKiB, startAddress, endAddress, contiguous };
}

export function validateMemory(project) {
  const issues = validateRam(project);
  const add = (id, level, title, message, moduleId = 'hw-platform', itemId) => issues.push({
    id: `memory-${id}`, level, title, message, moduleId, designPage: 'memory', ...(itemId ? { itemId } : {}),
  });
  const plan = project?.memory === undefined ? createMemoryPlan() : project.memory;
  try { checkMemoryPlanShape(plan); } catch (error) { add('format', 'error', 'Flash 分区结构不合法', error.message); return issues; }
  const { layout, placements } = plan;
  const currentMcu = mcuKey(project?.target?.mcu);
  if (!currentMcu) add('target-missing', 'pending', '先选择目标硬件', '选定 MCU 后，按板卡实际 Flash 器件定义容量、地址和擦除扇区。', 'hw-platform');
  if (!layout.banks.length) {
    if (currentMcu) add('layout-missing', 'pending', 'Flash 扇区尚未定义', '在系统服务中定义实际 Flash 布局，再分配固件与备份数据。');
    for (const region of MEMORY_REGIONS) {
      const placement = placements[region.id];
      if (placement.bankId || placement.sectorIds.length) add(`region-${region.id}-bank-dangling`, 'error', `${region.label} 引用的 Flash 不存在`, '布局可能已移除或更换，原有分配已保留，请选择当前硬件的 Flash。', region.moduleId, region.id);
    }
    return issues;
  }
  if (currentMcu && (mcuKey(layout.mcu) !== currentMcu || boardKey(layout.board) !== boardKey(project?.target?.board))) {
    add('target-mismatch', 'error', 'Flash 布局与目标硬件不一致', '已有布局按原 MCU 与板卡保存。请核对当前硬件的 Flash 器件与擦除方式后，再确认此布局。');
  }
  const bankSpans = [];
  for (const bank of layout.banks) {
    const prefix = `bank-${bank.id}`, label = bank.name.trim() || '未命名 Flash';
    if (!bank.name.trim()) add(`${prefix}-name`, 'pending', 'Flash 名称待填写', '用名称区分内部 Flash、外部 Flash 或不同存储 Bank。', 'hw-platform', bank.id);
    const size = bytes(bank.sizeKiB), end = safeEnd(bank.baseAddress, size);
    if (bank.baseAddress === null || bank.sizeKiB === null) add(`${prefix}-geometry-missing`, 'pending', `${label} 地址与容量待填写`, '填写 CPU 地址空间中的起始地址和实际可用容量。', 'hw-platform', bank.id);
    else if (size === null || end === null) add(`${prefix}-geometry`, 'error', `${label} 地址或容量无效`, '起始地址必须为非负安全整数；容量为正数，换算后的字节数与末尾地址必须是安全整数。', 'hw-platform', bank.id);
    else bankSpans.push({ bank, start: bank.baseAddress, end });
    if (!bank.sectors.length) add(`${prefix}-sectors-missing`, 'pending', `${label} 扇区待定义`, '每行表示一个实际最小擦除单元；可批量生成等大扇区，也可逐项填写不同大小。', 'hw-platform', bank.id);
    const sectorSpans = [];
    for (const sector of bank.sectors) {
      const sectorPrefix = `${prefix}-sector-${sector.id}`, sectorLabel = sector.name.trim() || sector.id;
      const offset = bytes(sector.offsetKiB, true), sectorSize = bytes(sector.sizeKiB);
      if (sector.offsetKiB === null || sector.sizeKiB === null) add(`${sectorPrefix}-missing`, 'pending', `${sectorLabel} 边界待填写`, '填写相对 Flash 起点的偏移与此擦除单元的大小。', 'hw-platform', bank.id);
      else if (offset === null || sectorSize === null || !Number.isSafeInteger(offset + sectorSize)) add(`${sectorPrefix}-geometry`, 'error', `${sectorLabel} 偏移或大小无效`, '偏移不能为负，大小必须为正；两者都须能换算为整数个字节。', 'hw-platform', bank.id);
      else {
        const sectorEnd = offset + sectorSize;
        if (size !== null && sectorEnd > size) add(`${sectorPrefix}-bounds`, 'error', `${sectorLabel} 超出 Flash 容量`, '扇区的结束偏移不能超过所属 Flash 的容量。', 'hw-platform', bank.id);
        sectorSpans.push({ sector, start: offset, end: sectorEnd });
      }
    }
    sectorSpans.sort((a, b) => a.start - b.start);
    let furthest = null;
    for (const span of sectorSpans) {
      if (furthest && span.start < furthest.end) add(`${prefix}-overlap-${span.sector.id}`, 'error', `${label} 擦除扇区重叠`, `${furthest.sector.name || furthest.sector.id} 与 ${span.sector.name || span.sector.id} 的字节范围重叠。`, 'hw-platform', bank.id);
      if (!furthest || span.end > furthest.end) furthest = span;
    }
  }
  bankSpans.sort((a, b) => a.start - b.start);
  let furthestBank = null;
  for (const span of bankSpans) {
    if (furthestBank && span.start < furthestBank.end) add(`banks-overlap-${span.bank.id}`, 'error', 'Flash 地址范围重叠', `${furthestBank.bank.name || furthestBank.bank.id} 与 ${span.bank.name || span.bank.id} 使用了重叠的 CPU 地址范围。`, 'hw-platform', span.bank.id);
    if (!furthestBank || span.end > furthestBank.end) furthestBank = span;
  }

  const occupied = new Map();
  for (const region of MEMORY_REGIONS) {
    const placement = placements[region.id];
    const resolved = getMemoryRegion({ ...project, memory: plan }, region.id);
    const { bank, sectors, capacityKiB, requiredKiB, contiguous } = resolved;
    const prefix = `region-${region.id}`;
    if (placement.budgetKiB !== null && bytes(placement.budgetKiB, true) === null) add(`${prefix}-budget`, 'error', `${region.label} 容量预算无效`, '预算不能为负，换算后必须为整数个字节。', region.moduleId, region.id);
    if (requiredKiB === null) add(`${prefix}-budget-missing`, 'pending', `${region.label} 容量预算待填写`, region.kind === 'firmware' ? '填写此层预计代码容量；最终占用仍需核对链接结果。' : '在参数管理中填写此数据区容量，包含冗余副本和记录头。', region.moduleId, region.id);
    if (!placement.bankId) {
      if (placement.sectorIds.length) add(`${prefix}-bank-missing`, 'error', `${region.label} 缺少所属 Flash`, '已有扇区引用但没有选择 Flash，请重新选择位置。', region.moduleId, region.id);
      else if (region.kind === 'firmware' || requiredKiB !== 0) add(`${prefix}-unassigned`, 'pending', `${region.label} 尚未分配扇区`, '选择 Flash 及一组连续的完整擦除扇区。', region.moduleId, region.id);
      continue;
    }
    if (!bank) { add(`${prefix}-bank-dangling`, 'error', `${region.label} 引用的 Flash 不存在`, '布局可能已更换，请选择当前硬件的 Flash。', region.moduleId, region.id); continue; }
    if (!placement.sectorIds.length) {
      if (region.kind === 'firmware' || requiredKiB !== 0) add(`${prefix}-sectors-missing`, 'pending', `${region.label} 尚未选择扇区`, '选择一组连续的完整擦除扇区。', region.moduleId, region.id);
      continue;
    }
    for (const sectorId of placement.sectorIds) {
      const sector = bank.sectors.find(item => item.id === sectorId);
      if (!sector) { add(`${prefix}-sector-dangling-${sectorId}`, 'error', `${region.label} 引用的扇区不存在`, `扇区 ${sectorId} 不属于当前所选 Flash，请重新分配。`, region.moduleId, region.id); continue; }
      if (sector.reserved) add(`${prefix}-reserved-${sectorId}`, 'error', `${region.label} 占用了保留扇区`, `${sector.name || sector.id} 已保留给启动程序、升级镜像或其他用途。`, region.moduleId, region.id);
      const key = JSON.stringify([bank.id, sector.id]);
      if (occupied.has(key)) add(`${prefix}-conflict-${sectorId}`, 'error', '多个用途共用了擦除扇区', `${region.label} 与 ${occupied.get(key)} 同时使用 ${bank.name} / ${sector.name || sector.id}。`, region.moduleId, region.id);
      else occupied.set(key, region.label);
    }
    const validGeometry = sectors.length === placement.sectorIds.length && sectors.every(sector => bytes(sector.offsetKiB, true) !== null && bytes(sector.sizeKiB) !== null);
    if (validGeometry && sectors.length > 1 && !sectors.some(sector => sector.reserved)) {
      const adjacent = sectors.every((sector, index) => !index || bytes(sector.offsetKiB, true) === bytes(sectors[index - 1].offsetKiB, true) + bytes(sectors[index - 1].sizeKiB));
      if (!adjacent) add(`${prefix}-discontinuous`, 'error', `${region.label} 扇区不连续`, '当前用途需要一个连续地址区间；请选相邻擦除扇区，不跨越空洞或其他分区。', region.moduleId, region.id);
    }
    if (region.kind === 'firmware') {
      if (!bank.executable) add(`${prefix}-not-executable`, 'error', `${region.label} 不能放入此 Flash`, '此 Flash 已声明不可执行，需选择可直接执行或已完成执行映射的存储区。', region.moduleId, region.id);
    }
    if (capacityKiB !== null && requiredKiB !== null && capacityKiB < requiredKiB) add(`${prefix}-capacity`, 'error', `${region.label} 分区容量不足`, `选中 ${capacityKiB} KiB，容量预算为 ${requiredKiB} KiB。`, region.moduleId, region.id);
    if (region.kind === 'data' && requiredKiB !== 0 && project?.instances?.['app-params']?.parameters?.commitStrategy === 'dual_copy' && contiguous && sectors.length < 2) {
      add(`${prefix}-dual-copy`, 'error', `${region.label} 双副本缺少独立擦除空间`, '双副本至少需要两个独立擦除单元；副本尺寸、记录头与提交恢复流程仍需在实现时验证。', region.moduleId, region.id);
    }
  }
  add('runtime-unverified', 'pending', 'Flash 布局仍需构建与板上验证', '这里记录分区意图；链接地址、向量表、层间 ABI、启动及升级恢复尚未实现。分配不同扇区不代表已支持独立 OTA。');
  return issues;
}
