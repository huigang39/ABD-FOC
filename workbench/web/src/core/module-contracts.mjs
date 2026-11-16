/** Module-owned data contracts and explicit cross-layer field mappings.
 * Configuration only: no generated ABI, scheduler, queues or firmware transport.
 * This module depends on catalog metadata only, keeping model/contracts acyclic.
 */
import { MODULES } from './catalog.mjs';
import { createDefaultInterfaces, resolveFieldReference } from './interface-defaults.mjs';
import { createSchedule } from '../features/configuration/schedule.mjs';
import { inputAdapter } from '../modules/entrypoints.mjs';

export const CONTRACT_ROLES = Object.freeze(['input', 'output', 'state']);
export const INTERFACE_RATES = Object.freeze(['unselected', 'fast', 'control', 'background', 'event']);
export const INTERFACE_HANDOFFS = Object.freeze(['unselected', 'snapshot', 'queue', 'call']);
const roleNames = { input: '输入', output: '输出', state: '状态' };
const modules = new Map(MODULES.map(module => [module.id, module]));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const nonempty = value => typeof value === 'string' && value.trim() !== '';

export function createLayerInterface(id = uid('interface')) {
  return { id, name: '', fromModule: '', toModule: '', sourceStructure: '', targetStructure: '', rate: 'unselected', handoff: 'unselected', version: '', notes: '', fieldMap: [] };
}
export function createInterfaceMapping(id = uid('mapping')) { return { id, sourceField: '', targetField: '' }; }

function unique(base, used, separator = '-') {
  let candidate = base, index = 2;
  while (used.has(candidate)) candidate = `${base}${separator}${index++}`;
  used.add(candidate);
  return candidate;
}

/** Pure additive migration. Existing references, deleted targets and edits stay intact. */
export function ensureModuleContracts(design) {
  const next = structuredClone(design);
  if (!plain(next)) return next;
  if (!Object.hasOwn(next, 'moduleContracts')) next.moduleContracts = {};
  if (!Object.hasOwn(next, 'layerInterfaces')) next.layerInterfaces = [];
  if (!Object.hasOwn(next, 'privateStructures')) next.privateStructures = [];
  if (!plain(next.moduleContracts) || !Array.isArray(next.structures)) return next;
  // Clean up former automatically generated names in saved engineering data.
  // Bindings use IDs, so this changes neither field layouts nor connections.
  for (const module of MODULES) for (const role of CONTRACT_ROLES) {
    const structure = next.structures.find(item => item?.id === next.moduleContracts[module.id]?.[role]);
    const name = module.contracts[role].name;
    if (structure && ['Abd','Adb','ABD_','ADB_','abd_','adb_'].some(prefix => structure.name === prefix + name)) structure.name = name;
  }
  for (const [id,oldName,newName] of [['observer-input','ObserverInput','ObserverSamples'],['observer-state','ObserverState','ObserverEstimate']]) {
    const structure = next.structures.find(item => item?.id === id && item.name === oldName);
    if (structure) structure.name = newName;
  }
  const ids = new Set(next.structures.map(item => item?.id));
  const names = new Set(next.structures.map(item => typeof item?.name === 'string' ? item.name.trim() : item?.name));
  for (const module of MODULES) {
    if (!Object.hasOwn(next.moduleContracts, module.id)) next.moduleContracts[module.id] = {};
    const refs = next.moduleContracts[module.id];
    if (!plain(refs)) continue;
    for (const role of CONTRACT_ROLES) {
      if (Object.hasOwn(refs, role)) continue;
      const defaults = module.contracts[role];
      const id = unique(`${module.id}-${role}`, ids);
      const name = unique(defaults.name, names, '');
      next.structures.push({ id, name, owner: module.id, consumers: [], description: `${module.title}的${roleNames[role]}结构${role === 'state' ? '，仅供本模块内部使用' : ''}。`, rate: defaults.rate, fields: structuredClone(defaults.fields) });
      refs[role] = id;
    }
  }
  mergeRetiredSafetyContracts(next);
  if (!Object.hasOwn(next, 'schedule')) {
    next.schedule = createSchedule();
    if (Array.isArray(next.layerInterfaces) && !next.layerInterfaces.length) next.layerInterfaces = createDefaultInterfaces(next);
  }
  return next;
}

/** Keep original layouts for existing payloads, while moving live endpoints to the current loop. */
function mergeRetiredSafetyContracts(design) {
  const previousId = 'foc-safety', currentId = 'foc-current';
  const legacy = design.moduleContracts[previousId], current = design.moduleContracts[currentId];
  if (Object.hasOwn(design.moduleContracts, previousId)) {
    keys(legacy, CONTRACT_ROLES, '旧电流环保护结构绑定');
    for (const role of CONTRACT_ROLES) text(legacy[role], `旧电流环保护结构绑定.${role}`);
  }
  if (legacy && plain(current) && Array.isArray(design.privateStructures)) {
    const migrated = new Map();
    for (const role of CONTRACT_ROLES) {
      const source = design.structures.find(structure => structure?.id === legacy[role]);
      const target = design.structures.find(structure => structure?.id === current[role]);
      // A deleted source or destination remains a visible dangling reference.
      if (role === 'state' && legacy[role] && !design.privateStructures.includes(legacy[role])) design.privateStructures.push(legacy[role]);
      if (!source || !target || !Array.isArray(source.fields) || !Array.isArray(target.fields)) continue;
      if (source === target) { migrated.set(role, { oldId: source.id, newId: target.id, fields: new Map(source.fields.map(field => [field.id, field.id])) }); continue; }
      const ids = new Set(target.fields.map(field => field?.id)), names = new Set(target.fields.map(field => field?.name));
      const mapping = new Map();
      for (const field of source.fields) {
        if (!plain(field) || typeof field.id !== 'string' || typeof field.name !== 'string') continue;
        const copy = structuredClone(field);
        if (ids.has(copy.id)) copy.id = unique(`${copy.id}-protection`, ids); else ids.add(copy.id);
        if (copy.name && names.has(copy.name)) copy.name = unique(`${copy.name}_protection`, names, '_'); else names.add(copy.name);
        target.fields.push(copy);
        if (!mapping.has(field.id)) mapping.set(field.id, copy.id);
      }
      migrated.set(role, { oldId: source.id, newId: target.id, fields: mapping });
    }
    if (Array.isArray(design.layerInterfaces)) for (const item of design.layerInterfaces) {
      if (!plain(item)) continue;
      for (const [role, structureKey, fieldKey] of [['output', 'sourceStructure', 'sourceField'], ['input', 'targetStructure', 'targetField']]) {
        const migration = migrated.get(role);
        if (!migration || item[structureKey] !== migration.oldId) continue;
        item[structureKey] = migration.newId;
        if (Array.isArray(item.fieldMap)) for (const mapping of item.fieldMap) if (plain(mapping) && migration.fields.has(mapping[fieldKey])) mapping[fieldKey] = migration.fields.get(mapping[fieldKey]);
      }
    }
    delete design.moduleContracts[previousId];
  }
  // Other shared contracts and payloads retain their IDs, fields, names and notes.
  for (const structure of design.structures) if (plain(structure)) {
    if (structure.owner === previousId) structure.owner = currentId;
    if (Array.isArray(structure.consumers) && structure.consumers.includes(previousId)) structure.consumers = [...new Set(structure.consumers.map(id => id === previousId ? currentId : id))];
  }
  if (Array.isArray(design.faults)) for (const fault of design.faults) if (plain(fault) && fault.source === previousId) fault.source = currentId;
  if (Array.isArray(design.layerInterfaces)) for (const item of design.layerInterfaces) if (plain(item)) {
    if (item.fromModule === previousId) item.fromModule = currentId;
    if (item.toModule === previousId) item.toModule = currentId;
  }
}

export function getModuleContract(design, moduleId, role) {
  const id = design?.moduleContracts?.[moduleId]?.[role];
  return design?.structures?.find(item => item.id === id) || null;
}
export function getModuleContractRole(design, structureId) {
  if (design?.privateStructures?.includes(structureId)) {
    const structure = design.structures?.find(item => item.id === structureId);
    return { moduleId: structure?.owner || '', role: 'state', compatibility: true };
  }
  for (const module of MODULES) for (const role of CONTRACT_ROLES) {
    if (design?.moduleContracts?.[module.id]?.[role] === structureId) return { moduleId: module.id, role };
  }
  return null;
}

function keys(value, allowed, location) {
  if (!plain(value)) throw new Error(`${location} 必须是对象。`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${location} 含未知字段：${key}`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) throw new Error(`${location} 缺少字段：${key}`);
}
function text(value, location) { if (typeof value !== 'string') throw new Error(`${location} 必须是文本。`); }

/** Checks only the new design fields; contracts.mjs validates shared structures. */
export function checkModuleContractsShape(design) {
  if (!plain(design)) throw new Error('design 必须是对象。');
  keys(design.moduleContracts, MODULES.map(module => module.id), 'design.moduleContracts');
  for (const module of MODULES) {
    const path = `design.moduleContracts.${module.id}`, refs = design.moduleContracts[module.id];
    keys(refs, CONTRACT_ROLES, path);
    for (const role of CONTRACT_ROLES) text(refs[role], `${path}.${role}`);
  }
  if (!Array.isArray(design.privateStructures) || design.privateStructures.some(id => !nonempty(id)) || new Set(design.privateStructures).size !== design.privateStructures.length) throw new Error('design.privateStructures 必须包含互不重复的结构 ID。');
  if (!Array.isArray(design.layerInterfaces)) throw new Error('design.layerInterfaces 必须是数组。');
  for (const [index, item] of design.layerInterfaces.entries()) {
    const path = `design.layerInterfaces[${index}]`;
    keys(item, ['id', 'name', 'fromModule', 'toModule', 'sourceStructure', 'targetStructure', 'rate', 'handoff', 'version', 'notes', 'fieldMap'], path);
    for (const key of ['id', 'name', 'fromModule', 'toModule', 'sourceStructure', 'targetStructure', 'version', 'notes']) text(item[key], `${path}.${key}`);
    if (!INTERFACE_RATES.includes(item.rate)) throw new Error(`${path}.rate 不是允许的更新时序。`);
    if (!INTERFACE_HANDOFFS.includes(item.handoff)) throw new Error(`${path}.handoff 不是允许的交接方式。`);
    if (!Array.isArray(item.fieldMap)) throw new Error(`${path}.fieldMap 必须是数组。`);
    for (const [mappingIndex, mapping] of item.fieldMap.entries()) {
      const at = `${path}.fieldMap[${mappingIndex}]`;
      keys(mapping, ['id', 'sourceField', 'targetField'], at);
      for (const key of ['id', 'sourceField', 'targetField']) text(mapping[key], `${at}.${key}`);
    }
  }
  return true;
}

export function validateModuleContracts(project) {
  const issues = [];
  const add = (id, level, title, message, designPage, moduleId, itemId) => issues.push({ id: `contract-${id}`, level, title, message, designPage, ...(moduleId ? { moduleId } : {}), ...(itemId ? { itemId } : {}) });
  const design = project?.design;
  try {
    checkModuleContractsShape(design);
    if (!Array.isArray(design.structures) || design.structures.some(item => !plain(item) || typeof item.id !== 'string' || typeof item.owner !== 'string' || !Array.isArray(item.consumers) || !Array.isArray(item.fields) || item.fields.some(field => !plain(field) || typeof field.id !== 'string' || typeof field.unit !== 'string'))) throw new Error('关联数据结构格式不合法。');
  } catch (error) { add('format', 'error', '模块契约结构不合法', error.message, 'interfaces'); return issues; }
  const structures = new Map(design.structures.map(item => [item.id, item]));
  const claimed = new Map();
  const stateIds = new Set([...Object.values(design.moduleContracts).map(refs => refs.state).filter(nonempty), ...design.privateStructures]);
  for (const module of MODULES) {
    const empty = [];
    for (const role of CONTRACT_ROLES) {
      const id = design.moduleContracts[module.id][role], structure = structures.get(id);
      const prefix = `${module.id}-${role}`;
      if (!nonempty(id)) { add(`${prefix}-missing`, 'pending', `${module.title}${roleNames[role]}结构待指定`, '请引用本模块拥有的独立结构。', 'structures', module.id); continue; }
      if (claimed.has(id)) add(`${prefix}-shared`, 'error', '模块角色不能共用同一结构', `结构 ${id} 已用于 ${claimed.get(id)}；每个模块的输入、输出和状态需要独立定义。`, 'structures', module.id, id);
      else claimed.set(id, `${module.title} · ${roleNames[role]}`);
      if (!structure) { add(`${prefix}-unknown`, 'error', `${module.title}${roleNames[role]}结构不存在`, `保留的引用 ${id} 已失效，请恢复或重新指定结构。`, 'structures', module.id, id); continue; }
      if (structure.owner !== module.id) add(`${prefix}-owner`, 'error', '模块结构所有者不一致', `${module.title}的${roleNames[role]}结构必须由该模块拥有。`, 'structures', module.id, id);
      if (!structure.fields.length) empty.push(role);
      if (role === 'state' && structure.consumers.some(consumer => consumer !== module.id)) add(`${prefix}-exposed`, 'error', '内部状态不能跨模块暴露', '将需要发布的数据复制到本模块输出结构，再设计层间交接。', 'structures', module.id, id);
    }
    // One actionable reminder per included module, not three empty-structure notices.
    if (empty.length && project.instances?.[module.id]?.enabled) add(`${module.id}-fields`, 'pending', `${module.title}结构字段待设计`, `${empty.map(role => roleNames[role]).join('、')}结构尚无字段，不能生成代码；请载入模块字段或完成数据定义。`, 'structures', module.id, design.moduleContracts[module.id][empty[0]]);
  }
  for (const [index, id] of design.privateStructures.entries()) {
    const structure = structures.get(id), prefix = `private-${index}`;
    if (!structure) { add(`${prefix}-unknown`, 'error', '兼容状态结构不存在', `保留的私有结构 ${id} 已失效。`, 'structures', undefined, id); continue; }
    if (!modules.has(structure.owner)) add(`${prefix}-owner`, 'error', '兼容状态结构归属无效', '私有状态需要归属于现有模块。', 'structures', structure.owner, id);
    if (structure.consumers.some(consumer => consumer !== structure.owner)) add(`${prefix}-exposed`, 'error', '兼容状态不能跨模块暴露', '旧状态结构仍仅供所属模块内部使用。需要发布的数据应放入输出结构。', 'structures', structure.owner, id);
    if (Object.values(design.moduleContracts).some(roles => roles.input === id || roles.output === id)) add(`${prefix}-role`, 'error', '私有状态不能同时绑定输入或输出', '请保留状态的模块私有边界。', 'structures', structure.owner, id);
  }
  for (const [index, message] of (design.protocol?.messages || []).entries()) {
    if (stateIds.has(message.payload)) add(`message-${index}-state`, 'error', '内部状态不能作为通信载荷', '通过模块输出结构发布需要传输的数据。', 'protocol', undefined, message.id);
  }
  const interfaceIds = new Set(), writers = new Map();
  design.layerInterfaces.forEach((item, index) => {
    const prefix = `interface-${index}`;
    const report = (suffix, level, title, message) => add(`${prefix}-${suffix}`, level, title, message, 'interfaces', undefined, item.id);
    if (!nonempty(item.id)) report('id', 'pending', '接口 ID 待填写', '接口需要唯一的引用标识。');
    else if (interfaceIds.has(item.id)) report('id', 'error', '接口 ID 重复', `重复的接口 ID：${item.id}。`);
    interfaceIds.add(item.id);
    if (!item.name.trim()) report('name', 'pending', '接口名称待填写', '填写可区分此数据交接的名称。');
    if (!item.version.trim()) report('version', 'pending', '接口版本待填写', '接口版本可使用任意文本，不按大小推断兼容性。');
    if (item.rate === 'unselected') report('rate', 'pending', '接口更新时序待配置', '明确电流环控制周期、控制任务、后台或事件更新时序。');
    if (item.handoff === 'unselected') report('handoff', 'pending', '接口交接方式待配置', '选择快照、队列或调用约定；这里不会实现实际通信或同步机制。');
    const from = modules.get(item.fromModule), to = modules.get(item.toModule);
    for (const [key, module, label] of [['fromModule', from, '源模块'], ['toModule', to, '目标模块']]) {
      if (!nonempty(item[key])) report(key, 'pending', `${label}待选择`, '请选择已定义的模块。');
      else if (!module) report(key, 'error', `${label}不存在`, `未定义模块：${item[key]}。`);
      else if (!project.instances?.[module.id]?.enabled) report(`${key}-excluded`, 'warning', `${label}未编译包含`, `${module.title}当前未包含在项目中，接口仅作为设计保留。`);
    }
    if (from && to && from.id === to.id) report('same-module', 'error', '接口需要连接不同模块', '同一模块内部使用本地状态与调用顺序，不建立输出回写输入的连接。');
    const endpoints = {};
    for (const [side, module, role, key] of [['source', from, 'output', 'sourceStructure'], ['target', to, 'input', 'targetStructure']]) {
      const id = item[key], structure = structures.get(id), label = side === 'source' ? '源输出结构' : '目标输入结构';
      if (!nonempty(id)) report(`${side}-missing`, 'pending', `${label}待选择`, `请选择对应模块的${roleNames[role]}结构。`);
      else if (!structure) report(`${side}-unknown`, 'error', `${label}不存在`, `保留的结构引用 ${id} 已失效。`);
      if (stateIds.has(id)) report(`${side}-state`, 'error', '内部状态不能作为层间端点', '层间数据只能由源模块输出交给目标模块输入。');
      if (module && id && id !== design.moduleContracts[module.id][role]) report(`${side}-role`, 'error', `${label}不属于所选角色`, `必须使用 ${module.title} 已定义的${roleNames[role]}结构。`);
      if (structure) endpoints[side] = structure;
    }
    const mappingIds = new Set(), mappedTargets = new Set();
    item.fieldMap.forEach((mapping, mappingIndex) => {
      const at = `map-${mappingIndex}`;
      if (!nonempty(mapping.id)) report(`${at}-id`, 'pending', '字段映射 ID 待填写', '每条字段映射需要唯一标识。');
      else if (mappingIds.has(mapping.id)) report(`${at}-id`, 'error', '字段映射 ID 重复', `重复映射 ID：${mapping.id}。`);
      mappingIds.add(mapping.id);
      const matched = {};
      for (const [side, key] of [['source', 'sourceField'], ['target', 'targetField']]) {
        const id = mapping[key], structure = endpoints[side], label = side === 'source' ? '源字段' : '目标字段';
        if (!nonempty(id)) { report(`${at}-${side}-missing`, 'pending', `${label}待选择`, '字段映射按字段 ID 精确引用，不按名称猜测。'); continue; }
        if (!structure) continue;
        const found = resolveFieldReference(structure,id);
        if (!found) { report(`${at}-${side}-unknown`, 'error', `${label}引用无效`, `${id} 不存在、ID 重复或数组下标越界。`); continue; }
        matched[side] = found;
        if (side === 'target') {
          if (mappedTargets.has(id)) report(`${at}-duplicate-target`, 'error', '目标字段被重复映射', `目标字段 ${found.name || id} 需要唯一的数据来源。`);
          mappedTargets.add(id);
          if (project.instances?.[item.fromModule]?.enabled && project.instances?.[item.toModule]?.enabled) {
            const key = `${item.targetStructure}:${found.elementOf || found.id}`;
            const existing = writers.get(key) || [];
            if (existing.some(writer => writer.index === undefined || found.index === undefined || writer.index === found.index)) report(`${at}-multiple-writers`, 'error', '目标字段有多个数据来源', `${found.name} 已由其他连接写入，请明确唯一来源或先进行仲裁。`);
            existing.push(found); writers.set(key, existing);
          }
        }
      }
      if (matched.source && matched.target) {
        const canon = unit => ({ 'μs': 'us', 'µs': 'us' })[unit] || unit;
        if (matched.source.type !== matched.target.type) report(`${at}-type`, 'error', '映射字段类型不一致', `${matched.source.type} → ${matched.target.type}；尚未定义转换，不会自动强制转换。`);
        if (matched.source.count !== matched.target.count) report(`${at}-count`, 'error', '映射字段数量不一致', `${matched.source.count} → ${matched.target.count}；需要匹配完整数组长度。`);
        if (canon(matched.source.unit) !== canon(matched.target.unit)) report(`${at}-unit`, 'warning', '映射字段单位不一致', `“${matched.source.unit || '未注明'}” → “${matched.target.unit || '未注明'}”；需要确认单位并明确换算，当前未执行转换。`);
      }
    });
    if (!item.fieldMap.length) report('unmapped', 'pending', '接口尚未映射字段', '为这个连接选择需要传递的字段；其余输入可以由其他模块或平台适配器提供。');
  });
  for (const module of MODULES.filter(module=>project.instances?.[module.id]?.enabled)) {
    const input=getModuleContract(design,module.id,'input');
    if (!input?.fields.length) continue;
    const missing=input.fields.filter(field=>{
      if(inputAdapter(project,module.id,field.name))return false;
      const refs=writers.get(`${input.id}:${field.id}`)||[];
      return !refs.some(ref=>ref.index===undefined) && new Set(refs.map(ref=>ref.index)).size<field.count;
    });
    if(missing.length)add(`${module.id}-unmapped`,'pending',`${module.title}输入来源待配置`,`待连接：${missing.map(field=>field.name).join('、')}。输入可以来自多个模块，各字段需要明确来源。`,'structures',module.id,input.id);
  }
  return issues;
}
