import { getMcuCores, identifyMcu } from './mcu.mjs';

/** Runtime memory declarations. They do not replace a linker map or a firmware template. */
export const RAM_PLACEMENT_KINDS = Object.freeze(['code', 'data', 'stack', 'heap', 'shared', 'dma']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
const mcuKey = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
const bytes = (value, zero = false) => typeof value === 'number' && Number.isFinite(value) && (zero ? value >= 0 : value > 0) && Number.isSafeInteger(value * 1024) ? value * 1024 : null;
const address = value => Number.isSafeInteger(value) && value >= 0;
const span = (start, size) => address(start) && size !== null && Number.isSafeInteger(start + size) ? { start, end: start + size } : null;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

export function createRamPlan() { return { mcu: '', banks: [], placements: [] }; }
export function createRamBank(name = '新 RAM 区域') { return { id: makeId('ram-bank'), name, baseAddress: null, sizeKiB: null, cores: [], executable: false, dma: false }; }
export function createRamPlacement(name = '新内存分配') { return { id: makeId('ram-placement'), name, kind: 'data', coreId: '', bankId: '', offsetKiB: null, sizeKiB: null, loadBankId: '' }; }

function keys(value, allowed, at) {
  if (!plain(value)) throw new Error(`${at} 必须是对象。`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${at} 含未知字段：${key}`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) throw new Error(`${at} 缺少字段：${key}`);
}
function text(value, at, required = false) { if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${at} 必须是${required ? '非空' : ''}文本。`); }
function number(value, at) { if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${at} 必须是有限数字或 null。`); }
function collection(value, at, limit) {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${at} 必须是最多 ${limit} 项的数组。`);
  const ids = new Set();
  for (const item of value) {
    if (!plain(item)) throw new Error(`${at} 条目必须是对象。`);
    text(item.id, `${at}.id`, true);
    if (ids.has(item.id)) throw new Error(`${at} 含重复 id：${item.id}`);
    ids.add(item.id);
  }
}
export function checkRamShape(plan) {
  keys(plan, ['mcu', 'banks', 'placements'], 'memory.ram');
  text(plan.mcu, 'memory.ram.mcu');
  collection(plan.banks, 'memory.ram.banks', 64);
  collection(plan.placements, 'memory.ram.placements', 512);
  for (const bank of plan.banks) {
    const at = `memory.ram.banks.${bank.id}`;
    keys(bank, ['id', 'name', 'baseAddress', 'sizeKiB', 'cores', 'executable', 'dma'], at);
    text(bank.name, `${at}.name`); number(bank.baseAddress, `${at}.baseAddress`); number(bank.sizeKiB, `${at}.sizeKiB`);
    if (!Array.isArray(bank.cores) || bank.cores.length > 16) throw new Error(`${at}.cores 必须是最多 16 项的数组。`);
    bank.cores.forEach(core => text(core, `${at}.cores`, true));
    if (new Set(bank.cores).size !== bank.cores.length) throw new Error(`${at}.cores 含重复内核。`);
    for (const key of ['executable', 'dma']) if (typeof bank[key] !== 'boolean') throw new Error(`${at}.${key} 必须是布尔值。`);
  }
  for (const placement of plan.placements) {
    const at = `memory.ram.placements.${placement.id}`;
    keys(placement, ['id', 'name', 'kind', 'coreId', 'bankId', 'offsetKiB', 'sizeKiB', 'loadBankId'], at);
    for (const key of ['name', 'coreId', 'bankId', 'loadBankId']) text(placement[key], `${at}.${key}`);
    if (!RAM_PLACEMENT_KINDS.includes(placement.kind)) throw new Error(`${at}.kind 不是允许的用途。`);
    number(placement.offsetKiB, `${at}.offsetKiB`); number(placement.sizeKiB, `${at}.sizeKiB`);
  }
  return true;
}

function copy(project) {
  const next = structuredClone(project);
  if (!plain(next.memory)) throw new Error('项目缺少部署配置。');
  next.memory.ram ??= createRamPlan();
  checkRamShape(next.memory.ram);
  return next;
}
function requireTarget(project) { if (!mcuKey(project.target?.mcu)) throw new Error('请先选择 MCU。'); }
function itemFor(plan, collection, id) {
  const item = plan[collection].find(entry => entry.id === id);
  if (!item) throw new Error(collection === 'banks' ? 'RAM 区域已不存在。' : '内存分配已不存在。');
  return item;
}

/** STM32H745 physical regions only, never inferred free space.
 * ST DS12923 §3.3.2: https://www.st.com/resource/en/datasheet/stm32h745xg.pdf
 * Cortex-M7 can fetch instructions from either TCM; MPU permissions still apply:
 * https://support.arm.com/documentation/ddi0489/f/programmers-model/system-address-map
 * dma below means ordinary peripheral DMA. MDMA has a separate route to local RAM.
 */
export function applyRamPreset(project) {
  if (identifyMcu(project.target?.mcu)?.prefix !== 'STM32H745') throw new Error('当前 RAM 预设仅适用于 STM32H745。');
  const next = copy(project), plan = next.memory.ram;
  if (plan.banks.length || plan.placements.length) throw new Error('已有 RAM 配置，不能覆盖预设；可先恢复固件默认布局。');
  const regions = [
    ['instruction', '指令 RAM (ITCM)', 0x00000000, 64, ['cm7'], false],
    ['data', '数据 RAM (DTCM)', 0x20000000, 128, ['cm7'], false],
    ['axi', '通用 RAM (AXI SRAM)', 0x24000000, 512, ['cm7', 'cm4'], true],
    ['sram1', 'SRAM1', 0x30000000, 128, ['cm7', 'cm4'], true],
    ['sram2', 'SRAM2', 0x30020000, 128, ['cm7', 'cm4'], true],
    ['sram3', 'SRAM3', 0x30040000, 32, ['cm7', 'cm4'], true],
    ['sram4', 'SRAM4', 0x38000000, 64, ['cm7', 'cm4'], true],
  ];
  next.memory.ram = { mcu: next.target.mcu, banks: regions.map(([id, name, baseAddress, sizeKiB, cores, dma]) => ({ id: `ram-${id}`, name, baseAddress, sizeKiB, cores, executable: true, dma })), placements: [] };
  return next;
}

export function ramAction(project, action, { id = '', name } = {}) {
  if (action === 'ram-preset') return applyRamPreset(project);
  if (action === 'ram-reset') {
    const next = structuredClone(project);
    if (plain(next.memory)) delete next.memory.ram;
    return next;
  }
  const next = copy(project), plan = next.memory.ram;
  if (action === 'ram-rebind') { requireTarget(next); plan.mcu = next.target.mcu; }
  else if (['ram-add-bank', 'add-bank', 'ram-add-placement', 'add-placement'].includes(action)) {
    requireTarget(next);
    if (!plan.mcu.trim()) plan.mcu = next.target.mcu;
    if (action.endsWith('add-bank')) plan.banks.push(createRamBank(name));
    else plan.placements.push(createRamPlacement(name));
  } else if (['ram-remove-bank', 'remove-bank', 'ram-remove-placement', 'remove-placement'].includes(action)) {
    const collection = action.endsWith('remove-bank') ? 'banks' : 'placements';
    itemFor(plan, collection, id);
    plan[collection] = plan[collection].filter(item => item.id !== id);
    // Leave references visible so removing a region cannot silently relocate data.
  } else if (action === 'ram-clear-load-source') itemFor(plan, 'placements', id).loadBankId = '';
  else throw new Error('未知 RAM 操作。');
  checkRamShape(plan);
  return next;
}
export function ramEdit(project, scope, { id = '', key = '' } = {}, value) {
  const next = copy(project), plan = next.memory.ram;
  const allowed = scope === 'ram-bank' ? ['name', 'baseAddress', 'sizeKiB', 'cores', 'executable', 'dma'] : scope === 'ram-placement' ? ['name', 'kind', 'coreId', 'bankId', 'offsetKiB', 'sizeKiB', 'loadBankId'] : [];
  if (!allowed.includes(key)) throw new Error('RAM 配置项不存在。');
  itemFor(plan, scope === 'ram-bank' ? 'banks' : 'placements', id)[key] = structuredClone(value);
  checkRamShape(plan);
  return next;
}

export function validateRam(project) {
  if (!Object.hasOwn(project?.memory || {}, 'ram')) return [];
  const issues = [], plan = project.memory.ram;
  const add = (id, level, title, message, itemId) => issues.push({ id: `ram-${id}`, level, title, message, moduleId: 'hw-platform', designPage: 'memory', ...(itemId ? { itemId } : {}) });
  try { checkRamShape(plan); } catch (error) { add('format', 'error', 'RAM 结构不合法', error.message); return issues; }
  const target = mcuKey(project.target?.mcu), coreIds = new Set(getMcuCores(project.target?.mcu).map(core => core.id));
  if (!target) add('target-missing', 'pending', 'RAM 尚未确定目标芯片', '先选择 MCU，再核对地址、容量与各内核可访问范围。');
  if (!plan.mcu.trim()) add('target-unbound', 'pending', 'RAM 尚未绑定 MCU', '确认布局对应的目标芯片，避免切换型号后沿用旧地址。');
  else if (mcuKey(plan.mcu) !== target) add('target-mismatch', 'error', 'RAM 与目标 MCU 不一致', `当前布局绑定 ${plan.mcu}，请核对 ${project.target?.mcu || '当前目标'} 后重新绑定；原有分配已保留。`);
  if (!plan.banks.length) add('banks-missing', 'pending', 'RAM 区域待定义', '添加实际 RAM 区域及容量、内核访问和执行能力。');
  if (!coreIds.size && (plan.banks.some(bank => bank.cores.length) || plan.placements.some(item => item.coreId))) add('cores-unknown', 'pending', '内核信息待核对', '当前 MCU 尚无已维护的内核信息，保留手动声明，不能据此确认内核可达性。');
  const bankSpans = [], placementSpans = [], assignedBytes = new Map(), loadedBytes = new Map();
  for (const bank of plan.banks) {
    const prefix = `bank-${bank.id}`, label = bank.name.trim() || '未命名 RAM 区域';
    if (!bank.name.trim()) add(`${prefix}-name`, 'pending', 'RAM 名称待填写', '使用芯片实际区域名称或板级资源名称。', bank.id);
    const size = bytes(bank.sizeKiB), range = span(bank.baseAddress, size);
    if (bank.baseAddress === null || bank.sizeKiB === null) add(`${prefix}-geometry-missing`, 'pending', `${label} 地址与容量待填写`, '起始地址与容量均以实际芯片映射为准。', bank.id);
    else if (!range) add(`${prefix}-geometry`, 'error', `${label} 地址或容量无效`, '地址必须为非负安全整数，容量必须为正且换算为整数个字节，结束地址不能溢出。', bank.id);
    if (range) bankSpans.push({ ...range, bank });
    if (!bank.cores.length) add(`${prefix}-cores-missing`, 'pending', `${label} 可访问内核待选择`, '明确哪些内核可读写此区域。', bank.id);
    if (coreIds.size && bank.cores.some(core => !coreIds.has(core))) add(`${prefix}-cores-invalid`, 'error', `${label} 引用了未知内核`, '可访问内核必须属于当前 MCU。', bank.id);
  }
  const checkOverlaps = (ranges, prefix, title, getId, getName) => {
    ranges.sort((a, b) => a.start - b.start);
    let furthest;
    for (const current of ranges) {
      if (furthest && overlaps(current, furthest)) add(`${prefix}-${getId(current)}`, 'error', title, `${getName(furthest)} 与 ${getName(current)} 的地址范围重叠。`, getId(current));
      if (!furthest || current.end > furthest.end) furthest = current;
    }
  };
  checkOverlaps(bankSpans, 'banks-overlap', 'RAM 区域重叠', item => item.bank.id, item => item.bank.name || item.bank.id);
  for (const placement of plan.placements) {
    const prefix = `placement-${placement.id}`, label = placement.name.trim() || '未命名分配';
    const bank = plan.banks.find(item => item.id === placement.bankId);
    const size = bytes(placement.sizeKiB), offset = bytes(placement.offsetKiB, true), relative = span(offset, size);
    if (!placement.name.trim()) add(`${prefix}-name`, 'pending', '内存用途名称待填写', '用名称区分程序段、数据段、栈、堆与缓冲区。', placement.id);
    if (!placement.coreId) add(`${prefix}-core-missing`, 'pending', `${label} 所属内核待选择`, '共享区的所属内核表示初始化与管理责任，不代表其他内核不可访问。', placement.id);
    else if (coreIds.size && !coreIds.has(placement.coreId)) add(`${prefix}-core-invalid`, 'error', `${label} 所属内核不存在`, '选择当前 MCU 上的内核。', placement.id);
    if (!placement.bankId) add(`${prefix}-bank-missing`, 'pending', `${label} 运行位置待选择`, '选择运行时实际存放的 RAM 区域。', placement.id);
    else if (!bank) add(`${prefix}-bank-dangling`, 'error', `${label} 引用的 RAM 区域不存在`, '原有引用已保留，请重新选择区域。', placement.id);
    if (placement.offsetKiB === null || placement.sizeKiB === null) add(`${prefix}-geometry-missing`, 'pending', `${label} 偏移与预算待填写`, '偏移相对于 RAM 区域起点；预算为规划值，不是实际链接占用。', placement.id);
    else if (!relative) add(`${prefix}-geometry`, 'error', `${label} 偏移或容量无效`, '偏移须非负，容量须为正，二者均须能换算为整数个字节，结束位置不能溢出。', placement.id);
    if (bank) {
      if (placement.coreId && bank.cores.length && !bank.cores.includes(placement.coreId)) add(`${prefix}-core-access`, 'error', `${label} 所属内核无法访问此区域`, '请按区域声明的可访问内核重新分配。', placement.id);
      if (placement.kind === 'code' && !bank.executable) add(`${prefix}-not-executable`, 'error', `${label} 不能在所选区域执行`, '所选区域未声明可执行能力；不能把 Flash 加载源当作运行位置。', placement.id);
      if (placement.kind === 'dma' && !bank.dma) add(`${prefix}-dma-access`, 'error', `${label} 缺少 DMA 访问能力`, '普通 CPU 可访问不等于所用 DMA 可访问；特殊 DMA 通道需单独核对后声明。', placement.id);
      if (placement.kind === 'shared' && bank.cores.length > 0 && bank.cores.length < 2) add(`${prefix}-shared-access`, 'error', `${label} 不能作为跨核共享区`, '跨核共享区必须由至少两个内核共同访问。', placement.id);
      if (relative && bytes(bank.sizeKiB) !== null && relative.end > bytes(bank.sizeKiB)) add(`${prefix}-bounds`, 'error', `${label} 超出所属内存范围`, '结束偏移不能超过区域容量。', placement.id);
      if (size !== null) assignedBytes.set(bank.id, (assignedBytes.get(bank.id) || 0) + size);
      const absolute = relative && span(bank.baseAddress, bytes(bank.sizeKiB)) ? span(bank.baseAddress + offset, size) : null;
      if (absolute) placementSpans.push({ ...absolute, placement });
    }
    if (placement.kind === 'code' && !placement.loadBankId) add(`${prefix}-load-missing`, 'pending', `${label} 加载源待选择`, '指定保存初始程序镜像的 Flash；上电复制与运行地址需由链接和启动代码实现。', placement.id);
    if (placement.loadBankId) {
      if (!['code', 'data'].includes(placement.kind)) add(`${prefix}-load-kind`, 'error', `${label} 的加载源不适用于当前用途`, 'Flash 初始镜像用于程序或初始化数据；其他用途请清除加载源。', placement.id);
      const source = project.memory?.layout?.banks?.find(item => item.id === placement.loadBankId);
      if (!source) add(`${prefix}-load-dangling`, 'error', `${label} 引用的 Flash 加载源不存在`, '请选择当前 Flash 布局中的区域。', placement.id);
      else if (!span(source.baseAddress, bytes(source.sizeKiB))) add(`${prefix}-load-geometry`, 'pending', `${label} 加载源地址尚未确定`, '先补齐 Flash 加载源的实际地址与容量。', placement.id);
      else if (size !== null && ['code', 'data'].includes(placement.kind)) loadedBytes.set(source.id, (loadedBytes.get(source.id) || 0) + size);
    }
  }
  checkOverlaps(placementSpans, 'placements-overlap', 'RAM 分配重叠', item => item.placement.id, item => item.placement.name || item.placement.id);
  for (const bank of plan.banks) if (bytes(bank.sizeKiB) !== null && (assignedBytes.get(bank.id) || 0) > bytes(bank.sizeKiB)) add(`bank-${bank.id}-capacity`, 'error', `${bank.name || 'RAM'} 预算超出容量`, '此区域各用途的容量预算合计超过物理容量。', bank.id);
  for (const [id, total] of loadedBytes) {
    const source = project.memory.layout.banks.find(item => item.id === id);
    if (total > bytes(source.sizeKiB)) add(`load-${id}-capacity`, 'error', 'Flash 加载镜像预算超出容量', `${source.name || id} 中规划的 RAM 初始镜像已超过整个 Flash 区域容量。`, id);
    add(`load-${id}-link-unverified`, 'pending', 'Flash 加载镜像位置仍需链接分配', '选择加载源尚未分配 LMA、对齐与擦除范围；还需扣除已有固件和保留区，不能将整个 Flash 容量视为可用空间。', id);
  }
  const ipc = project.execution?.ipc;
  const shared = ipc?.transport === 'shared_memory' ? span(ipc.sharedAddress, bytes(ipc.sharedSizeKiB)) : null;
  if (shared) {
    const sharedBank = bankSpans.find(bank => shared.start >= bank.start && shared.end <= bank.end)?.bank;
    if (plan.banks.length && !sharedBank) add('ipc-bank-missing', 'pending', '跨核共享区尚未纳入 RAM 声明', 'execution.ipc 的地址范围未被当前区域完整包含，请核对已有共享内存映射。');
    else if (sharedBank && sharedBank.cores.length > 0 && sharedBank.cores.length < 2) add('ipc-core-access', 'error', '跨核共享范围位于单核内存', '已声明的共享地址需要由至少两个内核共同访问。', sharedBank.id);
    for (const item of placementSpans) if (overlaps(item, shared) && !(item.placement.kind === 'shared' && item.start >= shared.start && item.end <= shared.end)) add(`placement-${item.placement.id}-ipc-overlap`, 'error', '内存分配占用了跨核共享范围', '此范围已由 execution.ipc 使用；只能将范围内的共享用途明确记录为 shared，不能再分配为独立程序、数据、栈、堆或 DMA 缓冲区。', item.placement.id);
  }
  if (plan.banks.length || plan.placements.length) add('runtime-unverified', 'pending', 'RAM 规划尚未应用到固件', '物理区域与预算不代表实际空闲。当前模板已有程序、栈、保留数据、DMA 和共享区；需要核对链接映射、加载复制、零初始化、缓存与各核启动。此配置尚未生成或改写链接脚本。');
  return issues;
}
