/** Independent design-time layer releases. These snapshots do not contain firmware.
 * Shared interface structures, faults, protocol, build settings and equipment catalogs
 * stay on the project: applying a layer never deletes cross-layer references.
 */
import { LAYERS, MODULES, TARGET_FIELDS, checkParameter } from '../../core/catalog.mjs';
import { createMemoryLayout, createMemoryPlan, checkMemoryLayoutShape } from '../deployment/flash.mjs';

export const LAYER_VERSION_IDS = Object.freeze(['hardware', 'foc', 'app']);
const layerNames = Object.fromEntries(LAYERS.map(layer => [layer.id, layer.name]));
const layerModules = Object.fromEntries(LAYER_VERSION_IDS.map(layer => [layer, MODULES.filter(module => module.layer === layer)]));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const emptySelection = () => ({ hardware: '', foc: '', app: '' });
const stable = value => Array.isArray(value) ? value.map(stable) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const canonical = value => JSON.stringify(stable(value));

export function createLayerVersions() { return { selected: emptySelection(), releases: [] }; }

function keys(value, allowed, location, optional = []) {
  if (!plain(value)) throw new Error(`${location} 必须是对象。`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${location} 含未知字段：${key}`);
  for (const key of allowed) if (!optional.includes(key) && !Object.hasOwn(value, key)) throw new Error(`${location} 缺少字段：${key}`);
}
function text(value, location, nonempty = false) {
  if (typeof value !== 'string' || (nonempty && !value.trim())) throw new Error(`${location} 必须是${nonempty ? '非空' : ''}文本。`);
}
function optionalLabel(value, location) {
  text(value, location);
  if (value !== '' && !value.trim()) throw new Error(`${location} 必须为空文本或非空版本标识。`);
}

const retiredSafety = 'foc-safety';
const currentLoop = 'foc-lifecycle';
const protectionKeys = ['referenceTimeoutMs', 'maxCurrentA'];
const optimizationLevels = ['O0', 'Og', 'O1', 'O2', 'O3', 'Os', 'Oz'];
function checkRetiredSafety(instance, location) {
  keys(instance, ['enabled', 'runtimeEnabled', 'parameters'], location, ['runtimeEnabled']);
  if (typeof instance.enabled !== 'boolean' || (Object.hasOwn(instance, 'runtimeEnabled') && typeof instance.runtimeEnabled !== 'boolean')) throw new Error(`${location} 的运行与编译开关必须是布尔值。`);
  keys(instance.parameters, protectionKeys, `${location}.parameters`, protectionKeys);
  for (const [key, value] of Object.entries(instance.parameters)) if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${location}.${key} 必须是有限数字或 null。`);
}

/** Retired configuration is retained as read-only history, not active module state. */
export function checkCompatibilityShape(value) {
  keys(value, ['focSafety'], 'compatibility', ['focSafety']);
  if (!Object.hasOwn(value, 'focSafety')) return true;
  if (!Array.isArray(value.focSafety)) throw new Error('compatibility.focSafety 必须是数组。');
  for (const [index, record] of value.focSafety.entries()) {
    const at = `compatibility.focSafety[${index}]`;
    keys(record, ['instance', 'provenance', 'optimization', 'core', 'conflicts'], at, ['instance', 'optimization', 'core']);
    if (Object.hasOwn(record, 'instance')) checkRetiredSafety(record.instance, `${at}.instance`);
    keys(record.provenance, protectionKeys, `${at}.provenance`, protectionKeys);
    for (const source of Object.values(record.provenance)) if (!['user', 'example'].includes(source)) throw new Error(`${at}.provenance 来源无效。`);
    if (Object.hasOwn(record, 'optimization') && !optimizationLevels.includes(record.optimization)) throw new Error(`${at}.optimization 不是允许的优化等级。`);
    if (Object.hasOwn(record, 'core')) text(record.core, `${at}.core`);
    const conflictNames = ['enabled', 'runtimeEnabled', 'optimization', 'core', ...protectionKeys.flatMap(key => [`parameters.${key}`, `provenance.${key}`])];
    if (!Array.isArray(record.conflicts) || record.conflicts.some(item => !conflictNames.includes(item)) || new Set(record.conflicts).size !== record.conflicts.length) throw new Error(`${at}.conflicts 含未知或重复项。`);
  }
  return true;
}
function appendSafetyHistory(compatibility, records) {
  const result = structuredClone(compatibility || {});
  checkCompatibilityShape(result);
  if (!records?.length) return result;
  result.focSafety ||= [];
  for (const record of records) if (!result.focSafety.some(existing => canonical(existing) === canonical(record))) result.focSafety.push(structuredClone(record));
  return result;
}

/** Pure migration shared by project imports and directly applied historical snapshots. */
export function migrateLegacySafetyState(value) {
  if (!plain(value)) return structuredClone(value);
  const next = structuredClone(value);
  if (Object.hasOwn(next, 'compatibility')) checkCompatibilityShape(next.compatibility);
  const record = { provenance: {}, conflicts: [] };
  let found = false;
  const current = next.instances?.[currentLoop];
  const supplied = new Set(plain(current?.parameters) ? Object.keys(current.parameters) : []);
  if (plain(next.instances) && Object.hasOwn(next.instances, retiredSafety)) {
    const previous = next.instances[retiredSafety];
    checkRetiredSafety(previous, retiredSafety);
    if (!plain(current?.parameters)) throw new Error('旧电流环保护迁移需要保留电流环实例。');
    found = true; record.instance = structuredClone(previous);
    for (const key of protectionKeys) if (Object.hasOwn(previous.parameters, key)) {
      if (!Object.hasOwn(current.parameters, key)) current.parameters[key] = previous.parameters[key];
      else if (current.parameters[key] !== previous.parameters[key]) record.conflicts.push(`parameters.${key}`);
    }
    for (const key of ['enabled', 'runtimeEnabled']) if (Object.hasOwn(previous, key) && previous[key] !== current[key]) record.conflicts.push(key);
    delete next.instances[retiredSafety];
  }
  if (plain(next.provenance)) for (const path of Object.keys(next.provenance)) {
    if (!path.startsWith(`${retiredSafety}.`)) continue;
    const key = path.slice(retiredSafety.length + 1), source = next.provenance[path];
    if (!protectionKeys.includes(key) || !['user', 'example'].includes(source)) throw new Error(`provenance 含无效旧保护参数路径：${path}`);
    found = true; record.provenance[key] = source;
    const destination = `${currentLoop}.${key}`;
    if (!Object.hasOwn(next.provenance, destination) && !supplied.has(key)) next.provenance[destination] = source;
    else if (next.provenance[destination] !== source) record.conflicts.push(`provenance.${key}`);
    delete next.provenance[path];
  }
  const overrides = next.build?.moduleOptimizations;
  if (plain(overrides) && Object.hasOwn(overrides, retiredSafety)) {
    const optimization = overrides[retiredSafety];
    if (!optimizationLevels.includes(optimization)) throw new Error('旧电流环保护的优化等级无效。');
    found = true; record.optimization = optimization;
    if (!Object.hasOwn(overrides, currentLoop)) overrides[currentLoop] = optimization;
    else if (overrides[currentLoop] !== optimization) record.conflicts.push('optimization');
    delete overrides[retiredSafety];
  }
  const assignments = next.execution?.assignments;
  if (plain(assignments) && Object.hasOwn(assignments, retiredSafety)) {
    const core = assignments[retiredSafety]; text(core, '旧电流环保护核心分配');
    found = true; record.core = core;
    if (!Object.hasOwn(assignments, currentLoop)) assignments[currentLoop] = core;
    else if (assignments[currentLoop] !== core) record.conflicts.push('core');
    delete assignments[retiredSafety];
  }
  if (found) next.compatibility = appendSafetyHistory(next.compatibility, [record]);
  return next;
}
function checkLayer(layer) {
  if (!LAYER_VERSION_IDS.includes(layer)) throw new Error(`未知层：${String(layer)}`);
}
function checkProvenance(provenance, layer, location) {
  if (!plain(provenance)) throw new Error(`${location} 必须是对象。`);
  const paths = layerModules[layer].flatMap(module => module.params.map(param => `${module.id}.${param.key}`));
  for (const [path, source] of Object.entries(provenance)) {
    if (!paths.includes(path)) throw new Error(`${location} 含未知或其他层参数路径：${path}`);
    if (!['user', 'example'].includes(source)) throw new Error(`${location} 的来源无效：${path}`);
  }
}
function checkSnapshot(snapshot, layer, location) {
  if (layer === 'foc') snapshot = migrateLegacySafetyState(snapshot);
  keys(snapshot, ['instances', 'provenance', ...(layer === 'hardware' ? ['target','memoryLayout'] : []), ...(layer === 'foc' ? ['compatibility'] : [])], location, layer==='hardware'?['memoryLayout']:layer==='foc'?['compatibility']:[]);
  if (Object.hasOwn(snapshot, 'compatibility')) checkCompatibilityShape(snapshot.compatibility);
  keys(snapshot.instances, layerModules[layer].map(module => module.id), `${location}.instances`,layer==='foc'?['foc-compensation']:[]);
  for (const module of layerModules[layer]) {
    const instance = snapshot.instances[module.id], path = `${location}.instances.${module.id}`;
    if(!instance&&module.id==='foc-compensation')continue;
    keys(instance, ['enabled', 'runtimeEnabled', 'parameters'], path);
    for (const key of ['enabled', 'runtimeEnabled']) if (typeof instance[key] !== 'boolean') throw new Error(`${path}.${key} 必须是布尔值。`);
    // Known parameters may be absent in an older snapshot; restore their catalog defaults.
    const parameterKeys = module.params.map(param => param.key);
    keys(instance.parameters, parameterKeys, `${path}.parameters`, parameterKeys);
    for (const param of module.params) if (Object.hasOwn(instance.parameters, param.key)) checkParameter(instance.parameters[param.key], param, `${path}.${param.key}`);
  }
  checkProvenance(snapshot.provenance, layer, `${location}.provenance`);
  if (layer === 'hardware') {
    if(Object.hasOwn(snapshot,'memoryLayout'))checkMemoryLayoutShape(snapshot.memoryLayout);
    keys(snapshot.target, TARGET_FIELDS.map(field => field.key), `${location}.target`);
    for (const field of TARGET_FIELDS) checkParameter(snapshot.target[field.key], field, `${location}.target.${field.key}`);
  }
}

export function checkLayerVersionsShape(value) {
  keys(value, ['selected', 'releases'], 'layerVersions');
  keys(value.selected, LAYER_VERSION_IDS, 'layerVersions.selected');
  for (const layer of LAYER_VERSION_IDS) optionalLabel(value.selected[layer], `layerVersions.selected.${layer}`);
  if (!Array.isArray(value.releases)) throw new Error('layerVersions.releases 必须是数组。');
  const ids = new Set();
  value.releases.forEach((release, index) => {
    const path = `layerVersions.releases[${index}]`;
    keys(release, ['id', 'layer', 'version', 'interfaceVersion', 'requires', 'notes', 'snapshot'], path);
    text(release.id, `${path}.id`, true);
    if (ids.has(release.id)) throw new Error(`layerVersions.releases 含重复 id：${release.id}`);
    ids.add(release.id);
    checkLayer(release.layer);
    text(release.version, `${path}.version`, true);
    optionalLabel(release.interfaceVersion, `${path}.interfaceVersion`);
    text(release.notes, `${path}.notes`);
    keys(release.requires, LAYER_VERSION_IDS, `${path}.requires`);
    for (const layer of LAYER_VERSION_IDS) optionalLabel(release.requires[layer], `${path}.requires.${layer}`);
    if (release.requires[release.layer] !== '') throw new Error(`${path}.requires 不应要求自身层的接口版本。`);
    checkSnapshot(release.snapshot, release.layer, `${path}.snapshot`);
  });
  return true;
}

function normalizedSnapshot(snapshot, layer) {
  const normalized = layer === 'foc' ? migrateLegacySafetyState(snapshot) : structuredClone(snapshot);
  if(layer==='hardware')normalized.memoryLayout??=createMemoryLayout();
  const calibration=normalized.instances['app-calibration']?.parameters;
  if(calibration&&!Object.hasOwn(calibration,'enabledProcedures'))calibration.enabledProcedures=Array.isArray(calibration.procedures)?[...calibration.procedures]:[];
  if(layer==='foc'&&!Object.hasOwn(normalized.instances,'foc-compensation'))normalized.instances['foc-compensation']={enabled:false,runtimeEnabled:false,parameters:{}};
  for (const module of layerModules[layer]) for (const parameter of module.params) {
    if (!Object.hasOwn(normalized.instances[module.id].parameters, parameter.key)) normalized.instances[module.id].parameters[parameter.key] = structuredClone(parameter.defaultValue);
  }
  return normalized;
}
function captureSnapshot(project, layer) {
  if (!plain(project?.instances) || !plain(project?.provenance)) throw new Error('项目 instances 和 provenance 必须是对象。');
  const snapshot = {
    instances: Object.fromEntries(layerModules[layer].map(module => [module.id, structuredClone(project.instances[module.id])])),
    provenance: Object.fromEntries(Object.entries(project.provenance).filter(([path]) => layerModules[layer].some(module => path.startsWith(`${module.id}.`)))),
    ...(layer === 'hardware' ? { target: structuredClone(project.target), memoryLayout: structuredClone(project.memory?.layout||createMemoryLayout()) } : {}),
    ...(layer === 'foc' && project.compatibility ? { compatibility: structuredClone(project.compatibility) } : {}),
  };
  checkSnapshot(snapshot, layer, `${layer} 层快照`);
  return normalizedSnapshot(snapshot, layer);
}

/** Returns a detached release, so read helpers cannot mutate saved history. */
export function getSelectedLayerRelease(project, layer) {
  checkLayer(layer);
  const release = project?.layerVersions?.releases?.find(item => item.id === project.layerVersions.selected?.[layer] && item.layer === layer);
  return release ? structuredClone(release) : null;
}

export function layerMatchesRelease(project, layer, release = getSelectedLayerRelease(project, layer)) {
  checkLayer(layer);
  if (!release || release.layer !== layer) return false;
  checkSnapshot(release.snapshot, layer, `${layer} 层快照`);
  const current = captureSnapshot(project, layer), saved = normalizedSnapshot(release.snapshot, layer);
  // Provenance is explanatory metadata, not a difference in layer configuration.
  delete current.provenance; delete saved.provenance;
  delete current.compatibility; delete saved.compatibility;
  return canonical(current) === canonical(saved);
}

export function getLayerVersionState(project, layer) {
  checkLayer(layer);
  const release = getSelectedLayerRelease(project, layer);
  return { selectedId: project?.layerVersions?.selected?.[layer] ?? '', release, matches: release ? layerMatchesRelease(project, layer, release) : false };
}

/** Save-as creates a new immutable history entry and selects it. No clock/random input. */
export function saveLayerVersion(project, options) {
  keys(options, ['layer', 'version', 'id', 'interfaceVersion', 'requires', 'notes'], '层版本保存选项', ['id', 'interfaceVersion', 'requires', 'notes']);
  const { layer, version } = options;
  checkLayer(layer); text(version, '层版本号', true);
  if (options.requires !== undefined) keys(options.requires, LAYER_VERSION_IDS, '层版本保存选项.requires', LAYER_VERSION_IDS);
  const source = project.layerVersions ?? createLayerVersions();
  checkLayerVersionsShape(source);
  if (source.releases.some(release => release.layer === layer && release.version === version)) throw new Error(`${layerNames[layer]}已存在版本“${version}”，请使用新的版本号。`);
  let sequence = 1;
  while (source.releases.some(release => release.id === `${layer}-release-${sequence}`)) sequence++;
  const release = {
    id: options.id === undefined ? `${layer}-release-${sequence}` : options.id, layer, version,
    interfaceVersion: options.interfaceVersion === undefined ? '' : options.interfaceVersion,
    requires: { ...emptySelection(), ...options.requires }, notes: options.notes === undefined ? '' : options.notes,
    snapshot: captureSnapshot(project, layer),
  };
  const next = structuredClone(project);
  next.layerVersions = structuredClone(source);
  next.layerVersions.releases.push(release);
  next.layerVersions.selected[layer] = release.id;
  checkLayerVersionsShape(next.layerVersions);
  return next;
}

function requireRelease(versions, layer, id) {
  const release = versions.releases.find(item => item.id === id);
  if (!release) throw new Error(`${layerNames[layer]}所选版本不存在：${id || '尚未选择'}`);
  if (release.layer !== layer) throw new Error(`版本“${release.version}”不属于${layerNames[layer]}。`);
  return release;
}

/** Select prepares a combination; applying that combination is a separate operation. */
export function selectLayerVersion(project, layer, id) {
  checkLayer(layer); optionalLabel(id, '所选版本 id');
  const versions = project.layerVersions ?? createLayerVersions();
  checkLayerVersionsShape(versions);
  if (id !== '') requireRelease(versions, layer, id);
  const next = structuredClone(project);
  next.layerVersions = structuredClone(versions);
  next.layerVersions.selected[layer] = id;
  return next;
}

function restoreLayer(next, layer, release) {
  const snapshot = normalizedSnapshot(release.snapshot, layer);
  if (!plain(next.instances) || !plain(next.provenance)) throw new Error('项目 instances 和 provenance 必须是对象。');
  for (const module of layerModules[layer]) next.instances[module.id] = snapshot.instances[module.id];
  for (const path of Object.keys(next.provenance)) if (layerModules[layer].some(module => path.startsWith(`${module.id}.`))) delete next.provenance[path];
  Object.assign(next.provenance, snapshot.provenance);
  if (layer === 'hardware') { next.target = snapshot.target; next.memory??=createMemoryPlan(); next.memory.layout=snapshot.memoryLayout; }
  if (layer === 'foc' && snapshot.compatibility?.focSafety) next.compatibility = appendSafetyHistory(next.compatibility, snapshot.compatibility.focSafety);
  next.layerVersions.selected[layer] = release.id;
}

export function applyLayerVersion(project, layer, id = project?.layerVersions?.selected?.[layer]) {
  checkLayer(layer);
  checkLayerVersionsShape(project.layerVersions);
  const release = requireRelease(project.layerVersions, layer, id);
  const next = structuredClone(project);
  restoreLayer(next, layer, release);
  return next;
}

/** Empty selections leave those layers alone. Invalid references abort atomically. */
export function applySelectedLayerVersions(project) {
  checkLayerVersionsShape(project.layerVersions);
  const releases = LAYER_VERSION_IDS.filter(layer => project.layerVersions.selected[layer] !== '').map(layer => [layer, requireRelease(project.layerVersions, layer, project.layerVersions.selected[layer])]);
  const next = structuredClone(project);
  for (const [layer, release] of releases) restoreLayer(next, layer, release);
  return next;
}

export function validateLayerVersions(project) {
  const issues = [];
  const add = (id, level, title, message, layer) => issues.push({ id: `layer-version-${id}`, level, title, message, designPage: 'versions', ...(layer ? { layer } : {}) });
  const versions = project?.layerVersions;
  try { checkLayerVersionsShape(versions); }
  catch (error) { add('format', 'error', '层版本结构不合法', error.message); return issues; }
  add('runtime-unverified', 'pending', '版本组合尚未验证运行', '版本号和接口要求仅为设计声明；没有生成固件或连接设备，不能据此确认构建成功、实时性能或板上运行兼容性。');
  const selected = {};
  for (const layer of LAYER_VERSION_IDS) {
    const id = versions.selected[layer];
    if (!id) { add(`unselected-${layer}`, 'pending', `${layerNames[layer]}尚未选择版本`, '保存当前层配置为独立版本后，可与其他层自由组合。', layer); continue; }
    const release = versions.releases.find(item => item.id === id);
    if (!release || release.layer !== layer) { add(`selection-${layer}`, 'error', `${layerNames[layer]}版本引用无效`, '所选版本不存在或属于其他层，请重新选择。', layer); continue; }
    selected[layer] = release;
    try {
      if (!layerMatchesRelease(project, layer, release)) add(`modified-${layer}`, 'warning', `${layerNames[layer]}当前配置与所选版本不同`, '当前模块参数、编译包含、运行开关或硬件目标已偏离所选快照；应用所选版本可恢复，或另存为新版本。', layer);
    } catch (error) { add(`snapshot-${layer}`, 'error', `${layerNames[layer]}当前配置无法比较`, error.message, layer); }
    if (!release.interfaceVersion) add(`interface-${layer}`, 'pending', `${layerNames[layer]}接口版本未知`, '可填写独立的接口标识；层版本号不用于推断接口兼容性。', layer);
  }
  const labels = new Set();
  versions.releases.forEach((release, index) => {
    const key = canonical([release.layer, release.version]);
    if (labels.has(key)) add(`duplicate-label-${index}`, 'warning', `${layerNames[release.layer]}版本号重复`, `“${release.version}”对应多个快照，请使用不同标签以便区分。`, release.layer);
    labels.add(key);
  });
  for (const layer of LAYER_VERSION_IDS) {
    const release = selected[layer];
    if (!release) continue;
    for (const dependency of LAYER_VERSION_IDS.filter(other => other !== layer)) {
      const expected = release.requires[dependency], provided = selected[dependency]?.interfaceVersion;
      const pair = `${layer}-${dependency}`, pairName = `${layerNames[layer]} → ${layerNames[dependency]}`;
      if (!expected || !provided) add(`compatibility-${pair}`, 'pending', `${pairName}兼容性未知`, '需要明确接口要求及对方所选接口版本；未声明不能当作兼容。', layer);
      else if (expected !== provided) add(`compatibility-${pair}`, 'error', `${pairName}接口声明不匹配`, `要求接口“${expected}”，所选接口为“${provided}”。仅按显式接口标识核对，不比较层版本号大小。`, layer);
      else add(`compatibility-${pair}`, 'info', `${pairName}接口声明匹配`, `声明的接口标识“${expected}”一致；该结果不是实现、构建或运行兼容性的验证。`, layer);
    }
  }
  return issues;
}
