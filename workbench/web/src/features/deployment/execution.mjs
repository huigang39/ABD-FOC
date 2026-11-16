import { MODULES, MODULE_IDS } from '../../core/catalog.mjs';
import { getMcuCores, identifyMcu } from './mcu.mjs';

const MODULE_MAP = new Map(MODULES.map(module => [module.id, module]));
const normalize = value => String(value || '').trim().toUpperCase();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const active = (project, id) => project.instances?.[id]?.enabled === true;
const integerBytes = value => typeof value === 'number' && Number.isSafeInteger(value);
const hex = value => `0x${value.toString(16).toUpperCase()}`;

// RM0399, Table 6: these D2/D3 regions are visible from both H745 cores.
// The catalog deliberately does not describe peripheral/DMA reachability or MPU setup.
export const H745_SHARED_RAM = Object.freeze([
  { name: 'SRAM1 · D2', start: 0x30000000, end: 0x30020000 },
  { name: 'SRAM2 · D2', start: 0x30020000, end: 0x30040000 },
  { name: 'SRAM3 · D2', start: 0x30040000, end: 0x30048000 },
  { name: 'SRAM4 · D3', start: 0x38000000, end: 0x38010000 },
].map(region => Object.freeze(region)));
export const EXECUTION_REFERENCE = 'https://www.st.com/resource/en/reference_manual/dm00176879-stm32h745-755-and-stm32h747-757-advanced-arm-based-32-bit-mcus-stmicroelectronics.pdf';

export function createExecutionPlan() {
  return {
    mcu: '', bootCore: '',
    assignments: Object.fromEntries(MODULE_IDS.map(id => [id, ''])),
    ipc: { transport: 'unselected', notification: 'unselected', cachePolicy: 'unselected', sharedAddress: null, sharedSizeKiB: null },
  };
}

function keys(value, allowed, location) {
  if (!plain(value)) throw new Error(`${location} 必须是对象。`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${location} 含未知字段：${key}`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) throw new Error(`${location} 缺少字段：${key}`);
}
function text(value, location) { if (typeof value !== 'string') throw new Error(`${location} 必须是文本。`); }
function choice(value, choices, location) { if (!choices.includes(value)) throw new Error(`${location} 不是允许的选项。`); }
function numeric(value, location) { if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${location} 必须是有限数字或 null。`); }

export function checkExecutionShape(plan) {
  keys(plan, ['mcu', 'bootCore', 'assignments', 'ipc'], 'execution');
  text(plan.mcu, 'execution.mcu'); text(plan.bootCore, 'execution.bootCore');
  keys(plan.assignments, MODULE_IDS, 'execution.assignments');
  for (const id of MODULE_IDS) text(plan.assignments[id], `execution.assignments.${id}`);
  keys(plan.ipc, ['transport', 'notification', 'cachePolicy', 'sharedAddress', 'sharedSizeKiB'], 'execution.ipc');
  choice(plan.ipc.transport, ['unselected', 'shared_memory'], 'execution.ipc.transport');
  choice(plan.ipc.notification, ['unselected', 'hsem', 'polling'], 'execution.ipc.notification');
  choice(plan.ipc.cachePolicy, ['unselected', 'noncacheable', 'maintenance'], 'execution.ipc.cachePolicy');
  numeric(plan.ipc.sharedAddress, 'execution.ipc.sharedAddress');
  numeric(plan.ipc.sharedSizeKiB, 'execution.ipc.sharedSizeKiB');
  return true;
}

/** Explicit assignments are never silently converted after a target change. */
export function moduleCore(project, moduleId) {
  if (!MODULE_MAP.has(moduleId)) return '';
  const assigned = project.execution?.assignments?.[moduleId];
  if (typeof assigned === 'string' && assigned !== '') return assigned;
  const cores = getMcuCores(project.target?.mcu);
  return cores.length === 1 ? cores[0].id : '';
}

/** A proposed split, not a measured scheduling or resource allocation result. */
export function applyExecutionPreset(project) {
  if (identifyMcu(project.target?.mcu)?.prefix !== 'STM32H745') throw new Error('当前分工方案仅适用于 STM32H745。');
  const next = structuredClone(project);
  const previous = next.execution || createExecutionPlan();
  checkExecutionShape(previous);
  next.execution = {
    ...previous, mcu: next.target.mcu, bootCore: 'cm7',
    assignments: Object.fromEntries(MODULES.map(module => [module.id, module.layer === 'app' ? 'cm4' : 'cm7'])),
    // Do not carry a RAM address to a different MCU, nor invent one for the user.
    ipc: normalize(previous.mcu) === normalize(next.target.mcu) ? previous.ipc : createExecutionPlan().ipc,
  };
  return next;
}

export function validateExecution(project) {
  const issues = [];
  const add = (id, level, title, message, moduleId = 'hw-platform') => issues.push({ id: `execution-${id}`, level, title, message, moduleId, designPage: 'execution' });
  const plan = project.execution ?? createExecutionPlan();
  try { checkExecutionShape(plan); } catch (error) { add('format', 'error', '内核配置结构不合法', error.message); return issues; }
  const cores = getMcuCores(project.target?.mcu), coreIds = new Set(cores.map(core => core.id));
  const enabled = MODULES.filter(module => active(project, module.id));
  const hasAssignments = Object.values(plan.assignments).some(core => core !== '') || plan.bootCore !== '';
  if (plan.mcu.trim() && normalize(plan.mcu) !== normalize(project.target?.mcu)) add('target-changed', 'error', '内核分工需要重新确认', `此分工绑定 ${plan.mcu}，当前 MCU 为 ${project.target?.mcu || '未选择'}。请核对内核和共享内存后重新绑定。`);
  if (!cores.length) {
    if (hasAssignments) add('cores-unknown', 'pending', '当前 MCU 内核信息待补齐', '没有已维护的内核信息，无法核对现有模块分配。');
    return issues;
  }
  if (hasAssignments && !plan.mcu.trim()) add('target-unbound', 'pending', '内核分工尚未绑定 MCU', '确认当前 MCU 后保存绑定，避免切换硬件时沿用其他芯片的内核分配。');
  if (plan.bootCore && !coreIds.has(plan.bootCore)) add('boot-core', 'error', '启动管理内核不存在', '所选启动管理内核不属于当前 MCU，请重新选择。');
  for (const module of MODULES) {
    const assigned = plan.assignments[module.id];
    if (assigned && !coreIds.has(assigned)) add(`core-${module.id}`, active(project, module.id) ? 'error' : 'warning', `${module.title}的内核分配无效`, `“${assigned}”不属于当前 MCU。${active(project,module.id) ? '请选择有效内核。' : '模块未参与编译，原分配已保留。'}`, module.id);
  }
  if (cores.length === 1) return issues;
  if (!plan.bootCore) add('boot-unselected', 'pending', '启动管理内核待选择', '指定负责全局时钟和另一内核启动握手的内核；各核仍需独立启动代码。');
  const unassigned = enabled.filter(module => !plan.assignments[module.id]);
  if (unassigned.length) add('modules-unassigned', 'pending', '模块运行内核待分配', `${unassigned.length} 个参与编译的模块尚未选择内核：${unassigned.map(module => module.title).join('、')}。`);

  const fast = enabled.filter(module => module.layer === 'foc' || ['hw-board', 'hw-drivers'].includes(module.id));
  const fastCores = new Set(fast.map(module => moduleCore(project, module.id)).filter(core => coreIds.has(core)));
  if (fastCores.size > 1) add('fast-loop-split', 'error', '电流环控制周期不能直接跨核拆分', '当前架构要求算法电流环、传感器驱动及采样与 PWM 在同一内核执行。跨核版本需要重新设计采样交接、观测器相位与执行预算。', 'foc-lifecycle');

  const onDifferentCores = (source, target) => {
    if (!active(project, source) || !active(project, target)) return false;
    const from = moduleCore(project, source), to = moduleCore(project, target);
    return coreIds.has(from) && coreIds.has(to) && from !== to;
  };
  const crossDependencies = enabled.flatMap(module => (module.dependencies || []).filter(id => onDifferentCores(module.id, id)).map(id => [module.id, id]));
  const crossInterfaces = (project.design?.layerInterfaces || []).filter(item => onDifferentCores(item.fromModule, item.toModule));
  for (const item of crossInterfaces) {
    if (item.handoff === 'call') add(`call-${item.id}`, 'error', '跨核连接不能使用直接函数调用', `“${item.name || '未命名接口'}”跨越两个内核，需改用快照或消息队列并配置跨核传输。`, item.toModule);
  }
  if (crossDependencies.length || crossInterfaces.length) {
    const ipc = plan.ipc;
    const missing = [
      ['transport', '数据通道'], ['notification', '通知方式'], ['cachePolicy', '缓存一致性'],
    ].filter(([key]) => ipc[key] === 'unselected').map(([, label]) => label);
    if (ipc.sharedAddress === null) missing.push('共享 RAM 起始地址');
    if (ipc.sharedSizeKiB === null) missing.push('共享 RAM 容量');
    if (missing.length) add('ipc-incomplete', 'pending', '跨核数据交换待配置', `当前存在跨核依赖，需配置${missing.join('、')}。HSEM 负责同步通知，不能替代缓存维护或数据一致性协议。`, 'app-runtime');
  }

  // Validate explicit values even when current modules happen to use only one core.
  const { sharedAddress: start, sharedSizeKiB: size } = plan.ipc;
  const bytes = size === null ? null : size * 1024;
  const addressValid = start === null || (integerBytes(start) && start >= 0);
  const sizeValid = bytes === null || (integerBytes(bytes) && bytes > 0);
  if (!addressValid) add('shared-address', 'error', '共享 RAM 地址无效', '起始地址必须是非负整数地址。');
  if (!sizeValid) add('shared-size', 'error', '共享 RAM 容量无效', '容量必须大于零，并精确对应整数个字节。');
  if (addressValid && sizeValid && start !== null && bytes !== null) {
    const end = start + bytes;
    if (!Number.isSafeInteger(end)) add('shared-overflow', 'error', '共享 RAM 地址超出范围', '起始地址与容量的和必须处于安全整数范围。');
    else if (identifyMcu(project.target?.mcu)?.prefix === 'STM32H745' && !H745_SHARED_RAM.some(region => start >= region.start && end <= region.end)) {
      add('shared-range', 'error', '共享 RAM 不在已维护区域内', `当前支持 H745 的 D2 SRAM1/2/3 或 D3 SRAM4，需在一段区域内分配完整缓冲区。${hex(start)} 至 ${hex(end - 1)} 不符合此布局；不能把 M7 的 TCM 作为跨核共享区。`);
    }
    if (start % 32 !== 0 || bytes % 32 !== 0) add('shared-alignment', 'error', '共享 RAM 未按缓存行对齐', '共享区起始地址和容量需要按 32 字节对齐，以隔离 M7 缓存行；MPU 或缓存维护仍需实现。');
  }

  for (const layer of ['hardware', 'foc', 'app']) {
    const layerCores = new Set(enabled.filter(module => module.layer === layer).map(module => moduleCore(project, module.id)).filter(core => coreIds.has(core)));
    const placement = project.memory?.placements?.[layer];
    if (layerCores.size > 1 && placement?.sectorIds?.length) add(`images-${layer}`, 'pending', '同层多核镜像需要细分链接区', '该层模块分布在两个内核，当前 Flash 扇区是整层预留。构建时还需为各核镜像划分独立链接区、向量表和启动入口。', layer === 'hardware' ? 'hw-platform' : layer === 'foc' ? 'foc-lifecycle' : 'app-runtime');
  }
  add('runtime-unverified', 'pending', '双核部署尚未联调', '内核分工仅记录配置。各核镜像与链接、启动握手、外设唯一所有者、跨核缓存一致性及执行时序仍需实现并验证。');
  return issues;
}
