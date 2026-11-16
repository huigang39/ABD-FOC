import { migrateMotionLoopParameters } from '../../modules/application/app-motion/migration.mjs';
/** Measured performance belongs to an actuator + driver assembly.
 * No device access, inferred ratings, interpolation or automatic current conversion.
 * Save creates detached history; callers supply the measurement date and firmware ID.
 */
import { MODULES, TARGET_FIELDS, checkParameter } from '../../core/catalog.mjs';
import { checkCatalogShape, createCatalog, isAssemblyComplete } from '../equipment/model.mjs';
import { checkModuleOptimizations } from '../build/options.mjs';
import { migrateAngleDelayParameters } from '../../modules/algorithm/foc-compensation/migration.mjs';
import { migrateSignalConsumerParameters } from '../../modules/algorithm/consumers.mjs';

export const PERFORMANCE_KINDS = Object.freeze(['kt', 'tn_curve']);
export const PERFORMANCE_LIMITS = Object.freeze({ records: 100, samplesPerRecord: 2000, totalSamples: 20000, csvCharacters: 500000, jsonCharacters: 8000000 });
const LAYERS = ['hardware', 'foc', 'app'];
const DRAFT_KEYS = ['name', 'assemblyId', 'kind', 'measuredAt', 'measurementSide', 'currentBasis', 'firmwareId', 'conditions', 'samples'];
const CONDITION_KEYS = ['busVoltageV', 'ambientTemperatureC', 'windingTemperatureC', 'durationS', 'notes'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const stable = value => Array.isArray(value) ? value.map(stable) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const canonical = value => JSON.stringify(stable(value));
const clone = value => structuredClone(value);
const withOptionalFilter = configuration => plain(configuration) && !Object.hasOwn(configuration, 'foc-filter')
  ? { ...configuration, 'foc-filter': { enabled: false, runtimeEnabled: false, parameters: { children: [] } } } : configuration;
function compatibleFocConfiguration(snapshot) {
  const configuration = withOptionalFilter(clone(snapshot.layers.foc.configuration));
  migrateAngleDelayParameters({ ...configuration, 'hw-board': snapshot.layers.hardware?.configuration?.['hw-board'] });
  return configuration;
}
function compatibleAppConfiguration(snapshot) {
  const configuration = clone(snapshot.layers.app.configuration);
  migrateSignalConsumerParameters(configuration);
  migrateMotionLoopParameters(configuration);
  return configuration;
}
function fail(message) { throw new Error(message); }
function keys(value, allowed, location) {
  if (!plain(value)) fail(`${location} 必须是对象。`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${location} 含未知字段：${key}`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) fail(`${location} 缺少字段：${key}`);
}
function text(value, location, max = 300, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${location} 必须是${required ? '非空' : ''}文本，最多 ${max} 字。`);
}
function finite(value, location) { if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${location} 必须是有限数字。`); }
function option(value, options, location) { if (!options.includes(value)) fail(`${location} 不是允许的选项。`); }
function safeJson(value, location = '测试记录') {
  let nodes = 0;
  const ancestors = new Set();
  const visit = (item, depth) => {
    if (++nodes > 300000 || depth > 24) fail(`${location} 结构过大或嵌套过深。`);
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') return finite(item, location);
    if (typeof item === 'string') return text(item, location, 16000);
    if (!Array.isArray(item) && !plain(item)) fail(`${location} 只能包含 JSON 数据。`);
    if (ancestors.has(item)) fail(`${location} 不能包含循环引用。`);
    ancestors.add(item);
    for (const key of Object.keys(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`${location} 含不允许的字段：${key}`);
      visit(item[key], depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  if (JSON.stringify(value).length > PERFORMANCE_LIMITS.jsonCharacters) fail(`${location} 超过保存容量。`);
}

export function createPerformance() { return { records: [] }; }

/** A new draft contains no invented measurements and does not change the project. */
export function createPerformanceDraft(project, assemblyId = project?.catalog?.activeAssemblyId || '', kind = 'kt') {
  option(kind, PERFORMANCE_KINDS, '测试类型');
  const assembly = project?.catalog?.assemblies?.find(item => item.id === assemblyId);
  return {
    name: assembly ? `${assembly.name} · ${kind === 'kt' ? 'Kt' : 'TN'}` : '',
    assemblyId, kind, measuredAt: '', measurementSide: 'output', currentBasis: 'iq', firmwareId: '',
    conditions: { busVoltageV: null, ambientTemperatureC: null, windingTemperatureC: null, durationS: null, notes: '' },
    samples: [],
  };
}

function checkSamples(samples, kind, currentBasis, allowEmpty = false) {
  if (!Array.isArray(samples) || samples.length > PERFORMANCE_LIMITS.samplesPerRecord || (!allowEmpty && samples.length === 0)) fail(`测试样本需要 ${allowEmpty ? '0' : '1'} 至 ${PERFORMANCE_LIMITS.samplesPerRecord} 个点。`);
  const xField = kind === 'kt' ? 'currentA' : 'speedRpm';
  samples.forEach((sample, index) => {
    const path = `样本 ${index + 1}`;
    keys(sample, [xField, 'torqueNm', 'series'], path);
    finite(sample[xField], `${path}.${xField}`); finite(sample.torqueNm, `${path}.torqueNm`);
    text(sample.series, `${path}.series`, 80);
    if (/[\r\n\u0000]/.test(sample.series)) fail(`${path} 的分组名称不能包含换行或空字符。`);
    if (kind === 'kt' && currentBasis === 'phase_rms' && sample.currentA < 0) fail(`${path} 的相电流有效值不能为负数；方向请用力矩符号或分组标记。`);
  });
}

function checkDraft(value, { allowEmpty = false, record = false } = {}) {
  keys(value, [...DRAFT_KEYS, ...(record ? ['id', 'snapshot'] : [])], '测试记录');
  text(value.name, '测试名称', 300, true); text(value.assemblyId, '关节模组', 300, true);
  option(value.kind, PERFORMANCE_KINDS, '测试类型');
  option(value.measurementSide, ['output', 'motor'], '测量侧');
  option(value.currentBasis, ['iq', 'phase_rms'], '电流口径');
  text(value.measuredAt, '测量时间', 50, true);
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value.measuredAt) || !Number.isFinite(Date.parse(value.measuredAt))) fail('测量时间必须是有效的日期或 ISO 日期时间。');
  const calendarDate = value.measuredAt.slice(0, 10);
  if (new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) !== calendarDate) fail('测量时间中的日期不存在。');
  text(value.firmwareId, '实测固件标识', 300);
  keys(value.conditions, CONDITION_KEYS, '测试条件');
  for (const key of CONDITION_KEYS.filter(key => key !== 'notes')) if (value.conditions[key] !== null) finite(value.conditions[key], `测试条件.${key}`);
  if (value.conditions.busVoltageV !== null && value.conditions.busVoltageV <= 0) fail('测试母线电压必须大于零。');
  if (value.conditions.durationS !== null && value.conditions.durationS <= 0) fail('测试持续时间必须大于零。');
  for (const key of ['ambientTemperatureC', 'windingTemperatureC']) if (value.conditions[key] !== null && value.conditions[key] < -273.15) fail('测试温度不能低于绝对零度。');
  text(value.conditions.notes, '测试备注', 3000);
  checkSamples(value.samples, value.kind, value.currentBasis, allowEmpty);
}

function captureLayers(project) {
  return Object.fromEntries(LAYERS.map(layer => {
    const selectedId = project.layerVersions?.selected?.[layer] || '';
    const release = project.layerVersions?.releases?.find(item => item.id === selectedId && item.layer === layer);
    return [layer, {
      releaseId: release?.id || '', version: release?.version || '', interfaceVersion: release?.interfaceVersion || '',
      configuration: Object.fromEntries(MODULES.filter(module => module.layer === layer).map(module => [module.id, clone(project.instances[module.id])])),
    }];
  }));
}

function captureSnapshot(project, assemblyId) {
  const assembly = project.catalog?.assemblies?.find(item => item.id === assemblyId);
  if (!isAssemblyComplete(project.catalog, assembly)) fail('请先选择包含执行器和驱动器的关节模组。');
  return clone({
    assembly,
    actuator: project.catalog.actuators.find(item => item.id === assembly.actuatorId),
    driver: project.catalog.drivers.find(item => item.id === assembly.driverId),
    layers: captureLayers(project), build: project.build, target: project.target,
    projectId: project.id, projectRevision: project.revision,
  });
}

function checkSnapshot(snapshot, record) {
  keys(snapshot, ['assembly', 'actuator', 'driver', 'layers', 'build', 'target', 'projectId', 'projectRevision'], '测试配置快照');
  checkCatalogShape({ ...createCatalog(), assemblies: [snapshot.assembly], actuators: [snapshot.actuator], drivers: [snapshot.driver] });
  if (snapshot.assembly.id !== record.assemblyId || snapshot.assembly.actuatorId !== snapshot.actuator.id || snapshot.assembly.driverId !== snapshot.driver.id) fail('测试配置快照的关节模组与组件引用不一致。');
  text(snapshot.projectId, '快照项目 ID', 300, true);
  if (!Number.isSafeInteger(snapshot.projectRevision) || snapshot.projectRevision < 1) fail('快照项目修订号必须是正整数。');
  keys(snapshot.target, TARGET_FIELDS.map(field => field.key), '快照目标');
  for (const field of TARGET_FIELDS) checkParameter(snapshot.target[field.key], field, `快照目标.${field.key}`);
  keys(snapshot.layers, LAYERS, '快照层版本');
  for (const layer of LAYERS) {
    const entry = snapshot.layers[layer];
    keys(entry, ['releaseId', 'version', 'interfaceVersion', 'configuration'], `快照层版本.${layer}`);
    for (const key of ['releaseId', 'version', 'interfaceVersion']) text(entry[key], `快照层版本.${layer}.${key}`);
    const modules = MODULES.filter(module => module.layer === layer);
    const configuration = layer === 'foc' ? compatibleFocConfiguration(snapshot) : layer === 'app' ? compatibleAppConfiguration(snapshot) : entry.configuration;
    keys(configuration, modules.map(module => module.id), `快照模块.${layer}`);
    for (const module of modules) {
      const instance = configuration[module.id];
      keys(instance, ['enabled', 'runtimeEnabled', 'parameters'], `快照模块.${module.id}`);
      if (typeof instance.enabled !== 'boolean' || typeof instance.runtimeEnabled !== 'boolean') fail(`快照模块.${module.id} 的开关必须是布尔值。`);
      keys(instance.parameters, module.params.map(param => param.key), `快照模块.${module.id}.parameters`);
      for (const param of module.params) checkParameter(instance.parameters[param.key], param, `快照模块.${module.id}.${param.key}`);
    }
  }
  keys(snapshot.build, ['compiler', 'version', 'optimization', 'lto', 'encryptFirmware', 'moduleOptimizations'], '快照构建配置');
  option(snapshot.build.compiler, ['unselected', 'gcc', 'clang', 'armclang', 'vendor'], '快照编译器');
  option(snapshot.build.optimization, ['unselected', 'O0', 'Og', 'O1', 'O2', 'O3', 'Os', 'Oz'], '快照优化等级');
  text(snapshot.build.version, '快照编译器版本'); checkModuleOptimizations(snapshot.build.moduleOptimizations);
  if (typeof snapshot.build.lto !== 'boolean' || typeof snapshot.build.encryptFirmware !== 'boolean') fail('快照构建开关必须是布尔值。');
}

export function checkPerformanceRecordShape(record) {
  safeJson(record); checkDraft(record, { record: true }); text(record.id, '测试记录 ID', 300, true);
  checkSnapshot(record.snapshot, record);
  return true;
}

/** Shape validation keeps historical records even if their shelf assembly was removed. */
export function checkPerformanceShape(value) {
  safeJson(value); keys(value, ['records'], 'performance');
  if (!Array.isArray(value.records) || value.records.length > PERFORMANCE_LIMITS.records) fail(`测试记录最多保存 ${PERFORMANCE_LIMITS.records} 条。`);
  const ids = new Set(); let sampleCount = 0;
  for (const record of value.records) {
    checkPerformanceRecordShape(record);
    if (ids.has(record.id)) fail(`测试记录含重复 ID：${record.id}`);
    ids.add(record.id); sampleCount += record.samples.length;
  }
  if (sampleCount > PERFORMANCE_LIMITS.totalSamples) fail(`测试样本总数不能超过 ${PERFORMANCE_LIMITS.totalSamples}。`);
  return true;
}

export function createPerformanceRecord(project, draft) {
  safeJson(draft); checkDraft(draft);
  const source = project.performance || createPerformance(); checkPerformanceShape(source);
  if (source.records.length >= PERFORMANCE_LIMITS.records) fail(`测试记录最多保存 ${PERFORMANCE_LIMITS.records} 条。`);
  let sequence = 1;
  while (source.records.some(record => record.id === `performance-${sequence}`)) sequence++;
  const record = { ...clone(draft), id: `performance-${sequence}`, snapshot: captureSnapshot(project, draft.assemblyId) };
  record.name = record.name.trim(); checkPerformanceRecordShape(record);
  return record;
}

export function savePerformanceRecord(project, draft) {
  const record = createPerformanceRecord(project, draft), next = clone(project);
  next.performance = clone(project.performance || createPerformance());
  next.performance.records.push(record); checkPerformanceShape(next.performance);
  return next;
}

export function removePerformanceRecord(project, recordId) {
  const source = project.performance || createPerformance(); checkPerformanceShape(source);
  if (!source.records.some(record => record.id === recordId)) fail('测试记录不存在。');
  const next = clone(project);
  next.performance = { records: source.records.filter(record => record.id !== recordId).map(clone) };
  return next;
}

/** Summary bounds describe measured points only; no Kt fit or continuous rating. */
export function summarizePerformance(value) {
  option(value.kind, PERFORMANCE_KINDS, '测试类型');
  checkSamples(value.samples, value.kind, value.currentBasis, true);
  const xField = value.kind === 'kt' ? 'currentA' : 'speedRpm';
  const range = field => value.samples.length ? { min: Math.min(...value.samples.map(sample => sample[field])), max: Math.max(...value.samples.map(sample => sample[field])) } : null;
  const groups = new Map();
  for (const sample of value.samples) {
    if (!groups.has(sample.series)) groups.set(sample.series, []);
    groups.get(sample.series).push(clone(sample));
  }
  return {
    sampleCount: value.samples.length, seriesCount: groups.size, xField, xRange: range(xField), torqueRange: range('torqueNm'),
    peakTorqueNm: value.samples.length ? Math.max(...value.samples.map(sample => Math.abs(sample.torqueNm))) : null,
    series: [...groups].map(([name, samples]) => ({ name, samples })),
  };
}

export function getPerformanceHistory(project, record) {
  const assembly = project.catalog?.assemblies?.find(item => item.id === record.assemblyId);
  if (!isAssemblyComplete(project.catalog, assembly)) return { historical: true, historyReason: '关节模组或其组件已移除，保留测试时的配置。' };
  const current = captureSnapshot(project, record.assemblyId), saved = record.snapshot;
  if (assembly.actuatorId !== saved.assembly.actuatorId || assembly.driverId !== saved.assembly.driverId) return { historical: true, historyReason: '执行器与驱动器的组合已变更。' };
  // Renaming an assembly or a component does not alter its measured physical identity.
  const configuration = snapshot => ({
    actuator: { ...snapshot.actuator, name: '' }, driver: { ...snapshot.driver, name: '' },
    layers: { ...snapshot.layers, foc: { ...snapshot.layers.foc, configuration: compatibleFocConfiguration(snapshot) }, app: { ...snapshot.layers.app, configuration: compatibleAppConfiguration(snapshot) } }, build: snapshot.build, target: snapshot.target,
  });
  if (canonical(configuration(current)) !== canonical(configuration(saved))) return { historical: true, historyReason: '组件参数、层配置或构建配置已变更。' };
  return { historical: false, historyReason: '' };
}

/** Returned records and curve points are detached from saved history. */
export function getAssemblyTests(project, assemblyId) {
  return (project.performance?.records || []).filter(record => record.assemblyId === assemblyId).map(record => ({
    ...clone(record), summary: summarizePerformance(record), ...getPerformanceHistory(project, record),
  }));
}

function splitCsv(line, rowNumber) {
  const fields = []; let cell = '', quoted = false, closed = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === ',') { fields.push(cell.trim()); cell = ''; closed = false; }
    else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed && char.trim()) fail(`CSV 第 ${rowNumber} 行引号后存在多余内容。`);
    else if (char === '"') fail(`CSV 第 ${rowNumber} 行引号格式错误。`);
    else cell += char;
  }
  if (quoted) fail(`CSV 第 ${rowNumber} 行引号未闭合；分组名称不能换行。`);
  fields.push(cell.trim()); return fields;
}

const csvAliases = {
  currentA: ['currentA', 'current_a', '电流(A)', '电流'],
  speedRpm: ['speedRpm', 'speed_rpm', '转速(rpm)', '转速'],
  torqueNm: ['torqueNm', 'torque_nm', '力矩(Nm)', '力矩'],
  series: ['series', '分组'],
};

/** Header is required, so a bus-current column is never silently treated as Iq. */
export function parsePerformanceCsv(csvText, kind) {
  option(kind, PERFORMANCE_KINDS, '测试类型');
  text(csvText, 'CSV', PERFORMANCE_LIMITS.csvCharacters, true);
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).map((line, index) => ({ line, number: index + 1 })).filter(item => item.line.trim());
  if (lines.length < 2 || lines.length > PERFORMANCE_LIMITS.samplesPerRecord + 1) fail(`CSV 需要表头和 1 至 ${PERFORMANCE_LIMITS.samplesPerRecord} 行样本。`);
  const xField = kind === 'kt' ? 'currentA' : 'speedRpm';
  const headers = splitCsv(lines[0].line, lines[0].number).map(header => Object.keys(csvAliases).find(key => csvAliases[key].some(alias => alias.toLowerCase() === header.toLowerCase())));
  if (!headers.includes(xField) || !headers.includes('torqueNm') || headers.some(key => ![xField, 'torqueNm', 'series'].includes(key)) || new Set(headers).size !== headers.length) fail(`CSV 表头需要 ${xField},torqueNm，可选 series；请勿用母线电流代替电机电流。`);
  const samples = lines.slice(1).map(({ line, number }) => {
    const fields = splitCsv(line, number);
    if (fields.length !== headers.length) fail(`CSV 第 ${number} 行列数与表头不一致。`);
    const sample = { [xField]: 0, torqueNm: 0, series: '' };
    headers.forEach((key, index) => {
      if (key === 'series') sample.series = fields[index];
      else {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(fields[index])) fail(`CSV 第 ${number} 行 ${key} 必须填写十进制数字。`);
        sample[key] = Number(fields[index]);
      }
    });
    return sample;
  });
  checkSamples(samples, kind, 'iq'); return samples;
}

export function serializePerformanceCsv(value) {
  option(value.kind, PERFORMANCE_KINDS, '测试类型'); checkSamples(value.samples, value.kind, value.currentBasis, true);
  const fields = [value.kind === 'kt' ? 'currentA' : 'speedRpm', 'torqueNm', 'series'];
  const escape = cell => /[,"\r\n]/.test(String(cell)) ? `"${String(cell).replaceAll('"', '""')}"` : String(cell);
  return [fields.join(','), ...value.samples.map(sample => fields.map(key => escape(sample[key])).join(','))].join('\n');
}
