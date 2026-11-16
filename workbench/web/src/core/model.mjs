import { migrateMotionLoopParameters } from '../modules/application/app-motion/migration.mjs';
import { createAlgorithmChild, observerUsesModelAngle } from '../modules/algorithm/children.mjs';
import { migrateAngleDelayParameters } from '../modules/algorithm/foc-compensation/migration.mjs';
import { migrateSignalConsumerParameters } from '../modules/algorithm/consumers.mjs';
export { migrateAngleDelayParameters } from '../modules/algorithm/foc-compensation/migration.mjs';
import { parameterVisible } from '../modules/shared/visibility.mjs';
import { coreCapabilities } from '../modules/hardware/hw-platform/cores.mjs';
import { fillMissingAutomaticSettings } from '../modules/hardware/hw-platform/defaults.mjs';
import { ensureCommonResources } from '../modules/hardware/hw-board/resource-defaults.mjs';
import { normalizeProjectName } from './project-name.mjs';
import { validateSchedule } from '../features/configuration/schedule.mjs';
import { validateModuleConfiguration } from '../modules/validation.mjs';
import { createPerformance, checkPerformanceShape } from '../features/performance/model.mjs';
import { SENSOR_ROLES, LEGACY_PROTOCOL_SUFFIXES, sensorFieldVisible, migrateSensorParameters } from '../modules/hardware/hw-drivers/sensors.mjs';
import { identifyMcu } from '../features/deployment/mcu.mjs';
import { createLayerVersions, checkLayerVersionsShape, validateLayerVersions, checkCompatibilityShape, migrateLegacySafetyState } from '../features/configuration/versions.mjs';
import { createOperation, checkOperationShape } from '../features/operation/model.mjs';
import { checkModuleOptimizations } from '../features/build/options.mjs';
import { ensureModuleContracts, validateModuleContracts } from './module-contracts.mjs';
import { createMemoryPlan, checkMemoryPlanShape, validateMemory, migrateMemoryLayoutValues } from '../features/deployment/flash.mjs';
import { createExecutionPlan, checkExecutionShape, validateExecution } from '../features/deployment/execution.mjs';
import { calibrationEnabled } from '../modules/application/app-calibration/validation.mjs';
/** Design-time configuration only. No firmware generation or hardware verification. */
import { createDesign, checkDesignShape, checkCommissioningShape, validateDesign } from './contracts.mjs';
import { createCatalog, checkCatalogShape, validateSelectedEquipment, normalizeCatalog, syncSelectedDriverTarget } from '../features/equipment/model.mjs';

import { LAYERS, MODULES, MODULE_IDS, TARGET_FIELDS, checkParameter } from './catalog.mjs';
export { LAYERS, MODULES, TARGET_FIELDS } from './catalog.mjs';

const MODULE_MAP = new Map(MODULES.map(module => [module.id, module]));
const known = (value) => value !== null && value !== undefined && value !== '' && value !== 'unselected' && value !== 'unconfirmed';
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function createProject() {
  const now = new Date();
  const project = {
    schemaVersion: 2,
    id: globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name: normalizeProjectName('', { date: now }), revision: 1, updatedAt: now.toISOString(),
    target: { vendor: 'unselected', mcu: '', board: '' },
    instances: Object.fromEntries(MODULES.map(module => [module.id, { enabled: module.required, runtimeEnabled: module.required, parameters: Object.fromEntries(module.params.map(param => [param.key, structuredClone(param.defaultValue)])) }])),
    provenance: {}, performance: createPerformance(),
    build: createBuild(), design: createDesign(), commissioning: { checks: {} }, catalog: createCatalog(), layerVersions: createLayerVersions(), operation: createOperation(), memory: createMemoryPlan(), execution: createExecutionPlan(), compatibility: {},
  };
  ensureCommonResources(project.instances['hw-board'].parameters);
  return project;
}

export function createExampleProject(kind = 'encoder') {
  if (kind === 'observer') kind = 'sensorless';
  if (!['encoder', 'sensorless', 'hall'].includes(kind)) throw new Error(`未知预置方案：${kind}`);
  const project = createProject();
  project.name = `${{ encoder: '编码器', sensorless: '观测器', hall: '霍尔' }[kind]}控制方案`;
  const sample = {
    'app-runtime': { scheduler: 'cooperative' },
    'app-state': { stateMachine: 'local' },
    'app-params': { motionCalibrationKiB: 16, parametersKiB: 8, runtimeRecordsKiB: 16, commitStrategy: 'dual_copy' },
    'app-comms': { bus: 'can', timeoutMs: 100 },
    'app-motion': { positionFeedback: 'motor_reduction', supportedModes: ['current', 'speed', 'position'], activeMode: 'speed', commandSource: 'communication', outerHz: 1000, currentLimitA: 5 },
    'app-calibration': { procedures: kind === 'hall' ? ['hall'] : ['electrical_zero'], enabledProcedures: kind === 'hall' ? ['hall'] : ['electrical_zero'], maxCurrentA: 1 },
    'foc-feedback': { angleSource: kind === 'sensorless' ? 'observer' : 'encoder' },
    'foc-observer': { children: [{...createAlgorithmChild('foc-observer','smo'),enabled:true,parameters:{gain:5,boundary:0.5,emfFilterHz:2000,extraction:'pll',pllBandwidthHz:200,speedFilterHz:null,validTimeMs:10,signalFloor:0.5}}], angleOutput:'smo.angle',speedOutput:'smo.speed',startupStrategy: 'open_loop' },
    'foc-current': { bandwidthHz: 1000 },
    'foc-lifecycle': { referenceTimeoutMs: 5, maxCurrentA: 8 },
    'foc-modulation': { method: 'svpwm', dutyMin: 0.02, dutyMax: 0.98 },
    'hw-platform': { architecture:'unselected', flashKiB:512, eraseKiB:4, firmwareReserveKiB:256 },
    'hw-board': { currentTopology:'three_shunt', busVoltageV:24, pwmHz:20000, currentLoopDivider:1, adcBits:12, adcClockHz:20000000, deadtimeNs:300 },
    'hw-drivers': { encoderCapability: kind === 'sensorless' ? 'absent' : 'present', encoderBits: kind === 'encoder' ? 16 : null, motorEncoderType: kind === 'hall' ? 'hall' : kind === 'encoder' ? 'absolute' : 'unselected', motorEncoderAngleDomain: kind === 'hall' ? 'electrical' : 'mechanical', outputEncoderCapability: 'absent', torqueCapability: 'absent', gateDriverCapability: 'absent' },
    'hw-safety': { hardwareTripCapability: 'unconfirmed', resetOutputDisabled: true },
  };
  for (const [moduleId, values] of Object.entries(sample)) {
    Object.assign(project.instances[moduleId].parameters, values);
    for (const key of Object.keys(values)) project.provenance[`${moduleId}.${key}`] = 'example';
  }
  project.instances['app-comms'].enabled = true;
  project.instances['app-calibration'].enabled = kind !== 'sensorless';
  project.instances['foc-observer'].enabled = kind === 'sensorless';
  for (const instance of Object.values(project.instances)) instance.runtimeEnabled = instance.enabled;
  if (kind === 'sensorless') project.instances['app-motion'].parameters.supportedModes = ['current', 'speed'];
  return project;
}

export function getDerived(project) {
  const timing = project?.instances?.['hw-board'];
  const pwm = timing?.parameters?.pwmHz;
  const divisor = timing?.parameters?.currentLoopDivider;
  const candidate = positive(pwm) && Number.isSafeInteger(divisor) && divisor >= 1 ? pwm / divisor : null;
  const current = project?.instances?.['foc-current'];
  const running = instance => instance?.enabled && (project?.schemaVersion === 1 ? instance.enabled : instance.runtimeEnabled);
  const coreReady = ['hw-safety','foc-lifecycle','foc-feedback','foc-modulation'].every(id => running(project?.instances?.[id]));
  const fastHz = coreReady && running(timing) && running(current) && positive(candidate) && Number.isFinite(1e6 / candidate) ? candidate : null;
  return { fastHz, fastPeriodUs: positive(fastHz) && Number.isFinite(1e6 / fastHz) ? 1e6 / fastHz : null, observerHz: running(project?.instances?.['foc-observer']) ? fastHz : null };
}

const createBuild = () => ({ compiler: 'unselected', version: '', optimization: 'unselected', lto: false, encryptFirmware: false, moduleOptimizations: {} });
function checkBuildShape(build) {
  exactKeys(build, ['compiler', 'version', 'optimization', 'lto', 'encryptFirmware', 'moduleOptimizations'], 'build');
  if (!['unselected', 'gcc', 'clang', 'armclang', 'vendor'].includes(build.compiler)) fail('build.compiler 不是允许的选项。');
  if (typeof build.version !== 'string') fail('build.version 必须是文本。');
  if (!['unselected', 'O0', 'Og', 'O1', 'O2', 'O3', 'Os', 'Oz'].includes(build.optimization)) fail('build.optimization 不是允许的选项。');
  if (Object.hasOwn(build,'moduleOptimizations')) checkModuleOptimizations(build.moduleOptimizations);
  if (typeof build.lto !== 'boolean') fail('build.lto 必须是布尔值。');
  if (Object.hasOwn(build, 'encryptFirmware') && typeof build.encryptFirmware !== 'boolean') fail('build.encryptFirmware 必须是布尔值。');
}

function fail(message) { throw new Error(message); }
function exactKeys(object, allowed, location) {
  if (!plain(object)) fail(`${location} 必须是对象。`);
  for (const key of Object.keys(object)) if (!allowed.includes(key)) fail(`${location} 含未知字段：${key}`);
}
function checkShape(project, lockRequired = false, allowLegacy = false) {
  if (!plain(project)) fail('项目必须是对象。');
  const legacy = project.schemaVersion === 1 && allowLegacy;
  if (project.schemaVersion !== 2 && !legacy) fail(`不支持的配置格式版本 schemaVersion：${String(project.schemaVersion)}；当前支持 2，导入可迁移 1。`);
  exactKeys(project, ['schemaVersion', 'id', 'name', 'revision', 'updatedAt', 'target', 'instances', 'provenance', 'compatibility', 'performance', ...(legacy ? [] : ['build', 'design', 'commissioning', 'catalog', 'layerVersions', 'operation', 'memory', 'execution'])], '项目');
  if (typeof project.id !== 'string' || !project.id.trim()) fail('项目 id 必须是非空文本。');
  if (typeof project.name !== 'string' || project.name.length > 300) fail('项目名称必须是 300 字以内的文本。');
  if (!Number.isSafeInteger(project.revision) || project.revision < 0) fail('项目 revision 必须是非负安全整数。');
  if (typeof project.updatedAt !== 'string' || !Number.isFinite(Date.parse(project.updatedAt))) fail('项目 updatedAt 必须是有效日期文本。');
  exactKeys(project.target, TARGET_FIELDS.map(field => field.key), 'target');
  for (const field of TARGET_FIELDS) {
    if (!Object.hasOwn(project.target, field.key)) fail(`target 缺少字段：${field.key}`);
    checkParameter(project.target[field.key], field, `target.${field.key}`);
  }
  exactKeys(project.instances, MODULE_IDS, 'instances（模块列表）');
  for (const module of MODULES) {
    if (!Object.hasOwn(project.instances, module.id)) fail(`模块列表缺少必需结构：${module.id}`);
    const instance = project.instances[module.id];
    exactKeys(instance, ['enabled', 'parameters', ...(legacy ? [] : ['runtimeEnabled'])], `模块 ${module.id}`);
    if (typeof instance.enabled !== 'boolean') fail(`模块 ${module.id} 的 enabled 必须是布尔值。`);
    if (!legacy && typeof instance.runtimeEnabled !== 'boolean') fail(`模块 ${module.id} 的 runtimeEnabled 必须是布尔值。`);
    if (lockRequired && module.required && !instance.enabled) fail(`必需模块“${module.title}”不能关闭。`);
    if (lockRequired && !legacy && !module.runtimeSwitchable && !instance.runtimeEnabled) fail(`必需模块“${module.title}”的运行开关不能关闭。`);
    exactKeys(instance.parameters, module.params.map(param => param.key), `${module.id}.parameters`);
    for (const param of module.params) if (Object.hasOwn(instance.parameters, param.key)) checkParameter(instance.parameters[param.key], param, `${module.id}.${param.key}`);
  }
  if (Object.hasOwn(project, 'compatibility')) checkCompatibilityShape(project.compatibility);
  if (Object.hasOwn(project, 'performance')) checkPerformanceShape(project.performance);
  if (!plain(project.provenance)) fail('provenance 必须是对象。');
  for (const [path, source] of Object.entries(project.provenance)) {
    const [moduleId, key, extra] = path.split('.');
    if (extra || !MODULE_MAP.get(moduleId)?.params.some(param => param.key === key)) fail(`provenance 含未知参数路径：${path}`);
    if (!['user', 'example'].includes(source)) fail(`provenance 的来源无效：${path}`);
  }
  if (!legacy && Object.hasOwn(project,'layerVersions'))checkLayerVersionsShape(project.layerVersions);
  if (!legacy && Object.hasOwn(project,'operation'))checkOperationShape(project.operation);
  if (!legacy && Object.hasOwn(project,'memory'))checkMemoryPlanShape(project.memory);
  if (!legacy && Object.hasOwn(project,'execution'))checkExecutionShape(project.execution);
  if (!legacy) { checkBuildShape(project.build); checkDesignShape(project.design); checkCommissioningShape(project.commissioning); checkCatalogShape(project.catalog); }
}

/** 旧的单条 encoder_tracking 链路拆分为固定的电机侧 / 出轴侧链路，且跟踪固定为单圈角度。 */
const TRACK_SIGNAL_MAP = {
  'encoder_tracking.motor_angle':'encoder_tracking_motor.angle',
  'encoder_tracking.motor_speed':'encoder_tracking_motor.speed',
  'encoder_tracking.output_angle':'encoder_tracking_output.angle',
  'encoder_tracking.output_speed':'encoder_tracking_output.speed',
};
const TRACK_REMOVED_SIGNALS = new Set(['encoder_tracking.electrical_angle','encoder_tracking.electrical_speed']);
/** 电角度跟踪链路已移除：路由引用回落到同角度域的有效信号，发布项回落到“不发布”。 */
const TRACK_ROUTING_FALLBACK = {
  'encoder_tracking.electrical_angle':{source:'feedback.angle',secondary:'smo.angle'},
  'encoder_tracking.electrical_speed':{source:'feedback.speed',secondary:'feedback.speed'},
};
const ELECTRICAL_SPEED_FIELDS = new Set(['electrical_velocity','electrical_speed_valid','electrical_speed_time_us','electrical_speed_source_id']);
/** Extend only the former default observer output; user-defined layouts stay intact. */
function migrateObserverOutputContract(design) {
  const output = design?.structures?.find(structure => structure.id === design.moduleContracts?.['foc-observer']?.output);
  const defaults = MODULE_MAP.get('foc-observer').contracts.output.fields;
  const previous = defaults.filter(field => !ELECTRICAL_SPEED_FIELDS.has(field.name));
  if (!Array.isArray(output?.fields) || output.fields.length !== previous.length) return;
  if (!previous.every((expected, index) => Object.entries(expected).every(([key, value]) => output.fields[index]?.[key] === value))) return;
  output.fields.push(...structuredClone(defaults.filter(field => ELECTRICAL_SPEED_FIELDS.has(field.name))));
}
function addDisabledFilter(instances, legacy = false) {
  if (!plain(instances) || Object.hasOwn(instances, 'foc-filter')) return;
  instances['foc-filter'] = { enabled: false, ...(legacy ? {} : { runtimeEnabled: false }), parameters: { children: [] } };
}
function migrateObserverChildren(instances) {
  const children=instances?.['foc-observer']?.parameters?.children;
  if(Array.isArray(children))for(const child of children) {
    if(child?.type!=='encoder_tracking')continue;
    const output=child.routing?.source==='sensor.output_angle';
    child.type=output?'encoder_tracking_output':'encoder_tracking_motor';
    child.name=output?'出轴侧编码器跟踪':'电机侧编码器跟踪';
    if(child.routing?.source==='feedback.angle')child.routing.source='sensor.motor_angle';
    if(plain(child.parameters))delete child.parameters.angleForm;
  }
  for(const moduleId of ['foc-observer','foc-compensation'])for(const child of instances?.[moduleId]?.parameters?.children||[]) {
    if(!plain(child?.routing))continue;
    for(const key of ['source','secondary']) {
      const value=child.routing[key];
      if(typeof value!=='string')continue;
      child.routing[key]=TRACK_SIGNAL_MAP[value]??TRACK_ROUTING_FALLBACK[value]?.[key]??value;
    }
  }
  const outputs=instances?.['foc-observer']?.parameters;
  if(plain(outputs))for(const key of ['angleOutput','speedOutput','motorAngleOutput','outputAngleOutput','outputSpeedOutput','torqueOutput']) {
    const value=outputs[key];
    if(typeof value!=='string')continue;
    outputs[key]=TRACK_SIGNAL_MAP[value]??(TRACK_REMOVED_SIGNALS.has(value)?'none':value);
  }
}

/** 17 模块目录定型前的旧字段：状态机与 CiA 402 移入状态机模块，标零样本移入备份，移除已并入或废弃的参数，IRQ 优先级数字改命名等级。 */
const IRQ_LEVEL_VALUES = ['emergency','realtime','high','normal','background'];
const IRQ_LEVEL_CENTERS = [0, 3, 7, 11, 15];
function migrateLegacyPriority(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  let best = 0;
  for (let i = 1; i < IRQ_LEVEL_CENTERS.length; i++) if (Math.abs(value - IRQ_LEVEL_CENTERS[i]) < Math.abs(value - IRQ_LEVEL_CENTERS[best])) best = i;
  return IRQ_LEVEL_VALUES[best];
}
/** 把各模块实例的旧字段迁移为当前结构（同样适用于货架驱动器的硬件快照与层版本快照）。 */
function migrateLegacyInstances(instances) {
  const runtimeInstance = instances?.['app-runtime'];
  const runtime = runtimeInstance?.parameters;
  if (plain(runtime)) {
    if (!plain(instances?.['app-state'])) {
      const enabled = runtimeInstance.enabled === true;
      const runtimeEnabled = runtimeInstance.runtimeEnabled;
      instances['app-state'] = { enabled, ...(runtimeEnabled === undefined ? {} : { runtimeEnabled: runtimeEnabled === true }), parameters: Object.fromEntries(MODULE_MAP.get('app-state').params.map(param => [param.key, structuredClone(param.defaultValue)])) };
    }
    const state = instances['app-state'].parameters;
    for (const key of ['stateMachine','cia402Modes','cia402DefaultMode']) {
      if (Object.hasOwn(runtime,key) && !Object.hasOwn(state,key)) state[key] = structuredClone(runtime[key]);
      delete runtime[key];
    }
  }
  const calibration = instances?.['app-calibration']?.parameters, backup = instances?.['app-params']?.parameters;
  if (plain(calibration) && Object.hasOwn(calibration,'zeroSamples')) {
    if (plain(backup) && !Object.hasOwn(backup,'zeroSamples')) backup.zeroSamples = calibration.zeroSamples;
    delete calibration.zeroSamples;
  }
  const current = instances?.['foc-current']?.parameters;
  if (plain(current)) for (const key of ['referenceTimeoutMs','maxCurrentA']) delete current[key];
  const observer = instances?.['foc-observer']?.parameters;
  if (plain(observer)) for (const key of ['kind','pllBandwidthHz']) delete observer[key];
  const coreConfigs = instances?.['hw-platform']?.parameters?.coreConfigs;
  if (plain(coreConfigs)) for (const core of Object.values(coreConfigs)) {
    if (!plain(core)) continue;
    for (const key of ['controlIrqPriority','communicationIrqPriority']) core[key] = migrateLegacyPriority(core[key]);
  }
}

function migrateLegacyModuleParameters(project) {
  const provenance = project.provenance;
  if (plain(provenance)) {
    for (const key of ['stateMachine','cia402Modes','cia402DefaultMode']) {
      if (Object.hasOwn(provenance,`app-runtime.${key}`)) provenance[`app-state.${key}`] ??= provenance[`app-runtime.${key}`];
      delete provenance[`app-runtime.${key}`];
    }
    for (const path of ['app-calibration.zeroSamples','foc-current.referenceTimeoutMs','foc-current.maxCurrentA','foc-observer.kind','foc-observer.pllBandwidthHz']) delete provenance[path];
  }
  migrateLegacyInstances(project.instances);
  const assignments = project.execution?.assignments;
  if (plain(assignments)) for (const id of MODULE_IDS) if (!Object.hasOwn(assignments,id)) assignments[id] = '';
}

/** 命令折叠退役的旧协议平铺参数名（各角色前缀 × 旧后缀）：对应 provenance 条目必须一并清理，否则 checkShape 与层快照 checkProvenance 拒绝载入。 */
const LEGACY_PROTOCOL_PARAM_NAMES = new Set(SENSOR_ROLES.flatMap(role => LEGACY_PROTOCOL_SUFFIXES.map(suffix => role.prefix + suffix)));

/** hw-sensors 模块更名为 hw-drivers：折叠七个数据面的旧键；结构 id、字段 id 等不透明引用保持原值。 */
function migrateDriverModule(project) {
  if(!plain(project))return;
  const rename=(object,from,to)=>{if(plain(object)&&Object.hasOwn(object,from)){if(!Object.hasOwn(object,to))object[to]=object[from];delete object[from];}};
  const renameProvenance=provenance=>{if(!plain(provenance))return;for(const key of Object.keys(provenance))if(key.startsWith('hw-sensors.')){const next=`hw-drivers.${key.slice('hw-sensors.'.length)}`;if(!Object.hasOwn(provenance,next))provenance[next]=provenance[key];delete provenance[key];}};
  const dropRetiredProtocolProvenance=provenance=>{if(!plain(provenance))return;for(const path of Object.keys(provenance)){const dot=path.indexOf('.');if(dot>0&&LEGACY_PROTOCOL_PARAM_NAMES.has(path.slice(dot+1))&&(path.startsWith('hw-sensors.')||path.startsWith('hw-drivers.')))delete provenance[path];}};
  rename(project.instances,'hw-sensors','hw-drivers');
  rename(project.execution?.assignments,'hw-sensors','hw-drivers');
  rename(project.build?.moduleOptimizations,'hw-sensors','hw-drivers');
  renameProvenance(project.provenance);
  dropRetiredProtocolProvenance(project.provenance);
  if(Array.isArray(project.catalog?.drivers))for(const driver of project.catalog.drivers)rename(driver?.hardware,'hw-sensors','hw-drivers');
  const design=project.design;
  if(plain(design)) {
    rename(design.moduleContracts,'hw-sensors','hw-drivers');
    for(const structure of design.structures||[])if(plain(structure)) {
      if(structure.owner==='hw-sensors')structure.owner='hw-drivers';
      if(Array.isArray(structure.consumers))structure.consumers=[...new Set(structure.consumers.map(id=>id==='hw-sensors'?'hw-drivers':id))];
    }
    for(const item of design.layerInterfaces||[])if(plain(item)) {
      if(item.fromModule==='hw-sensors')item.fromModule='hw-drivers';
      if(item.toModule==='hw-sensors')item.toModule='hw-drivers';
    }
    for(const fault of design.faults||[])if(plain(fault)&&fault.source==='hw-sensors')fault.source='hw-drivers';
  }
  for(const release of project.layerVersions?.releases||[]) {
    const snapshot=release?.snapshot;
    if(!plain(snapshot))continue;
    rename(snapshot.instances,'hw-sensors','hw-drivers');
    renameProvenance(snapshot.provenance);
    dropRetiredProtocolProvenance(snapshot.provenance);
  }
  for(const record of project.performance?.records||[]) {
    const snapshot=record?.snapshot;
    rename(snapshot?.driver?.hardware,'hw-sensors','hw-drivers');
    rename(snapshot?.build?.moduleOptimizations,'hw-sensors','hw-drivers');
    for(const layer of Object.values(snapshot?.layers||{}))rename(layer?.configuration,'hw-sensors','hw-drivers');
    // 测试快照按当前参数键做 exactKeys 校验：命令折叠与货架、工程实例同一配方。
    if(plain(snapshot?.driver?.hardware?.['hw-drivers']))migrateSensorParameters(snapshot.driver.hardware['hw-drivers']);
    if(plain(snapshot?.layers?.hardware?.configuration?.['hw-drivers']?.parameters))migrateSensorParameters(snapshot.layers.hardware.configuration['hw-drivers'].parameters);
  }
}

function migrateInputs(project) {
  if(!plain(project)||![1,2].includes(project.schemaVersion))return;
  migrateDriverModule(project);
  Object.assign(project, migrateLegacySafetyState(project));
  const compensation=MODULE_MAP.get('foc-compensation');
  if(plain(project.instances)&&compensation&&!Object.hasOwn(project.instances,compensation.id))project.instances[compensation.id]={enabled:false,...(project.schemaVersion===2?{runtimeEnabled:false}:{}),parameters:Object.fromEntries(compensation.params.map(param=>[param.key,structuredClone(param.defaultValue)]))};
  addDisabledFilter(project.instances, project.schemaVersion === 1);
  const migrateCalibration=instances=>{const params=instances?.['app-calibration']?.parameters;if(plain(params)&&!Object.hasOwn(params,'enabledProcedures'))params.enabledProcedures=Array.isArray(params.procedures)?[...params.procedures]:[];};
  migrateCalibration(project.instances);
  migrateSignalConsumerParameters(project.instances);
  migrateMotionLoopParameters(project.instances);
  migrateObserverChildren(project.instances);
  migrateAngleDelayParameters(project.instances);
  migrateLegacyModuleParameters(project);
  if(project.schemaVersion===2) {
    if(!Object.hasOwn(project,'memory'))project.memory=createMemoryPlan();
    migrateMemoryLayoutValues(project.memory?.layout);
    if(!Object.hasOwn(project,'execution'))project.execution=createExecutionPlan();
    else if(plain(project.execution?.assignments)&&!Object.hasOwn(project.execution.assignments,'foc-compensation'))project.execution.assignments['foc-compensation']='';
  }
  if (plain(project.design)) { project.design = ensureModuleContracts(project.design); migrateObserverOutputContract(project.design); }
  const sensors=project.instances?.['hw-drivers']?.parameters, feedback=project.instances?.['foc-feedback']?.parameters;
  const hallAngle=feedback?.angleSource==='hall';
  migrateSensorParameters(sensors,{hallAngle});
  if(hallAngle)feedback.angleSource='encoder';
  if(Array.isArray(project.catalog?.drivers))for(const driver of project.catalog.drivers){
    if(driver?.hardware?.['hw-drivers'])migrateSensorParameters(driver.hardware['hw-drivers']);
    migrateMemoryLayoutValues(driver?.memoryLayout);
    const coreConfigs=driver?.hardware?.['hw-platform']?.coreConfigs;
    if(plain(coreConfigs))for(const core of Object.values(coreConfigs)) {
      if (!plain(core)) continue;
      for (const key of ['controlIrqPriority','communicationIrqPriority']) core[key] = migrateLegacyPriority(core[key]);
    }
  }
  if(Array.isArray(project.layerVersions?.releases))for(const release of project.layerVersions.releases) {
    if (release?.layer === 'foc') release.snapshot = migrateLegacySafetyState(release.snapshot);
    const instances=release?.snapshot?.instances;
    if (release?.layer === 'foc') addDisabledFilter(instances);
    migrateCalibration(instances);
    migrateSignalConsumerParameters(instances);
    migrateMotionLoopParameters(instances);
    migrateObserverChildren(instances);
    migrateAngleDelayParameters(instances);
    if(plain(instances))migrateLegacyModuleParameters({instances,execution:{}});
    if(instances?.['hw-drivers'])migrateSensorParameters(instances['hw-drivers'].parameters);
    if(instances?.['foc-feedback']?.parameters?.angleSource==='hall')instances['foc-feedback'].parameters.angleSource='encoder';
    migrateMemoryLayoutValues(release?.snapshot?.memoryLayout);
  }
  if(Array.isArray(project.performance?.records))for(const record of project.performance.records) {
    migrateMemoryLayoutValues(record?.snapshot?.driver?.memoryLayout);
    addDisabledFilter(record?.snapshot?.layers?.foc?.configuration);
    migrateSignalConsumerParameters(record?.snapshot?.layers?.app?.configuration);
    migrateMotionLoopParameters(record?.snapshot?.layers?.app?.configuration);
    migrateAngleDelayParameters({ ...record?.snapshot?.layers?.foc?.configuration, 'hw-board': record?.snapshot?.layers?.hardware?.configuration?.['hw-board'] });
  }
}

export function parseProject(jsonText, { existingNames = [] } = {}) {
  if (typeof jsonText !== 'string') fail('请提供 JSON 文本。');
  let project;
  try { project = JSON.parse(jsonText); } catch { fail('JSON 解析失败，请检查文件是否为完整的项目 JSON。'); }
  migrateInputs(project);
  checkShape(project, true, true);
  const normalized = structuredClone(project);
  normalized.name = normalizeProjectName(normalized.name, { existingNames });
  const oldPreset = /^(编码器|观测器|霍尔)示例（教学参数）$/.exec(normalized.name);
  if (oldPreset) normalized.name = `${oldPreset[1]}控制方案`;
  if (normalized.schemaVersion === 1) {
    normalized.schemaVersion = 2;
    normalized.build = createBuild(); normalized.design = createDesign(); normalized.commissioning = { checks: {} }; normalized.catalog = createCatalog();
    for (const instance of Object.values(normalized.instances)) instance.runtimeEnabled = instance.enabled;
  }
  for (const module of MODULES) for (const parameter of module.params) {
    if (!Object.hasOwn(normalized.instances[module.id].parameters, parameter.key)) normalized.instances[module.id].parameters[parameter.key] = structuredClone(parameter.defaultValue);
  }
  if (normalized.instances['app-runtime'].parameters.scheduler === 'unselected') normalized.instances['app-runtime'].parameters.scheduler = 'cooperative';
  normalizeCatalog(normalized.catalog);
  syncSelectedDriverTarget(normalized);
  ensureCommonResources(normalized.instances['hw-board'].parameters);
  normalized.layerVersions ??= createLayerVersions(); normalized.operation ??= createOperation();
  normalized.memory ??= createMemoryPlan(); normalized.execution ??= createExecutionPlan(); normalized.compatibility ??= {};
  normalized.build.moduleOptimizations ??= {};
  normalized.build.encryptFirmware ??= false;
  normalized.performance ??= createPerformance();
  const syncTarget = (target, instances) => {
    const info = identifyMcu(target.mcu);
    instances['hw-platform'].parameters.architecture = info?.architecture || 'unselected';
    if (info) target.vendor = info.vendor;
    for(const core of info?.cores||[]){const settings=instances['hw-platform'].parameters.coreConfigs?.[core.id];if(settings)settings.irqPriorityBits=coreCapabilities(target.mcu,core.id)?.irqPriorityBits??null;}
    fillMissingAutomaticSettings(target.mcu,instances['hw-platform'].parameters);
  };
  syncTarget(normalized.target, normalized.instances);
  for (const release of normalized.layerVersions.releases) if (release.layer === 'hardware') syncTarget(release.snapshot.target, release.snapshot.instances);
  return normalized;
}

export function serializeProject(project) {
  const candidate = structuredClone(project);
  migrateInputs(candidate);
  checkShape(candidate, true, true);
  return JSON.stringify(candidate.schemaVersion === 1 ? parseProject(JSON.stringify(candidate)) : candidate, null, 2);
}

export function validateProject(project) {
  const issues = [];
  const add = (id, level, title, message, moduleId, paramKey) => issues.push({ id, level, title, message, ...(moduleId ? { moduleId } : {}), ...(paramKey ? { paramKey } : {}) });
  add('hardware-verification', 'pending', '硬件能力待确认', '尚未连接设备；ADC/PWM 时序、保护路径、传感器和 Flash 布局需结合硬件确认。', 'hw-platform');
  add('realtime-budget', 'pending', '实时预算尚未验证', '尚无算法实现的执行时间或板上测量；派生频率成立不代表能满足截止时间，也不代表固件可运行。', 'app-runtime');
  add('build-verification', 'pending', '构建能力尚未验证', '编译器、版本、优化与 LTO 仅记录设计意图；尚未调用工具链或确认所选目标支持这些选项。', 'hw-platform');
  try { checkShape(project); } catch (error) {
    add('project-format', 'error', '配置结构不合法', error.message);
    return issues;
  }
  const safetyConflicts = project.compatibility?.focSafety?.some(record => record.conflicts.length);
  if (safetyConflicts) add('safety-merge-review', 'warning', '旧保护配置合并后待核对', '旧电流环保护与电流环已有配置不一致，已保留电流环设置；原保护配置随项目保留，可核对后调整。', 'foc-current');
  const enabled = id => project.instances[id].enabled;
  const running = id => enabled(id) && project.instances[id].runtimeEnabled;
  const value = (id, key) => project.instances[id].parameters[key];
  for (const field of TARGET_FIELDS) if (!known(project.target[field.key])) add(`target-${field.key}`, 'pending', `${field.label}待确定`, field.description, field.key === 'board' ? 'hw-board' : 'hw-platform');
  const mcu = identifyMcu(project.target.mcu);
  if (!mcu) add('mcu-architecture-unknown', 'pending', 'MCU 架构待识别', '当前型号尚未命中已维护的 MCU 元数据；填写受支持的完整型号后识别架构，外设与时序能力仍需另行确认。', 'hw-platform', 'architecture');
  else if (value('hw-platform', 'architecture') !== mcu.architecture || project.target.vendor !== mcu.vendor) add('mcu-metadata-mismatch', 'error', 'MCU 型号与架构信息不一致', '重新选择或确认 MCU 型号，以同步已维护的厂商和架构信息。', 'hw-platform', 'architecture');
  for (const module of MODULES) {
    const instance = project.instances[module.id];
    if (module.required && !instance.enabled) add(`required-${module.id}`, 'error', '必需模块不能关闭', `“${module.title}”是该架构的必需模块。`, module.id);
    if (!instance.enabled && instance.runtimeEnabled) add(`runtime-without-build-${module.id}`, 'error', '未编译模块不能运行', `“${module.title}”未被编译包含，但运行开关为开启。`, module.id);
    if (!module.runtimeSwitchable && !instance.runtimeEnabled) add(`required-runtime-${module.id}`, 'error', '必需模块不能关闭运行', `“${module.title}”是必需模块，运行开关不能关闭。`, module.id);
    if (!instance.enabled) continue;
    for (const dependency of module.dependencies) if (!enabled(dependency)) add(`dependency-${module.id}-${dependency}`, 'error', '模块依赖未满足', `“${module.title}”依赖“${MODULE_MAP.get(dependency).title}”。`, module.id);
    if (instance.runtimeEnabled) for (const dependency of module.dependencies) if (enabled(dependency) && !running(dependency)) add(`runtime-dependency-${module.id}-${dependency}`, 'error', '运行依赖未满足', `“${module.title}”运行时依赖“${MODULE_MAP.get(dependency).title}”。`, module.id);
    for (const param of module.params) {
      if (!parameterVisible(project, module.id, param)) continue;
      const v = instance.parameters[param.key];
      if (param.hidden || param.architectureOnly && param.architectureOnly !== value('hw-platform','architecture')) continue;
      // Sensor detail requirements belong to sensorIssues; capability selectors stay here.
      if (module.id === 'hw-drivers' && !sensorFieldVisible(param, instance.parameters)) continue;
      if (module.id === 'foc-compensation') continue;
      if (module.id === 'hw-platform' && param.group==='memory' && project.memory?.layout.banks.length > 0) continue;
      const required = param.required && !(module.id === 'hw-platform' && param.key === 'architecture');
      if (required && (!known(v) || (Array.isArray(v) && v.length === 0))) add(`missing-${module.id}-${param.key}`, 'pending', `${param.label}待确定`, param.description || `请填写${param.label}。`, module.id, param.key);
      if (typeof v === 'number' && ((param.min !== undefined && v < param.min) || (param.max !== undefined && v > param.max))) add(`range-${module.id}-${param.key}`, 'error', `${param.label}超出范围`, `允许范围：${param.min ?? '不限下界'} 至 ${param.max ?? '不限上界'}。`, module.id, param.key);
    }
  }
  const mustBePositive = [['app-motion', 'outerHz'], ['app-motion', 'currentLimitA'], ['app-comms', 'timeoutMs'], ['foc-lifecycle', 'referenceTimeoutMs'], ['foc-lifecycle', 'maxCurrentA'], ['hw-board', 'pwmHz'], ['hw-board', 'adcClockHz'], ['hw-platform', 'flashKiB'], ['hw-platform', 'eraseKiB'], ['app-params', 'motionCalibrationKiB'], ['app-params', 'parametersKiB'], ['app-params', 'runtimeRecordsKiB']];
  for (const [id, key] of mustBePositive) if (!(project.memory?.layout.banks.length&&['hw-platform','app-params'].includes(id)) && enabled(id) && typeof value(id, key) === 'number' && value(id, key) <= 0) add(`positive-${id}-${key}`, 'error', '参数必须大于零', `${MODULE_MAP.get(id).params.find(p => p.key === key).label}不能为零或负数。`, id==='app-motion'&&key==='outerHz'?'app-runtime':id, id==='app-motion'&&key==='outerHz'?undefined:key);

  const supported = value('app-motion', 'supportedModes') || [];
  const active = value('app-motion', 'activeMode');
  if (known(active) && !supported.includes(active)) add('active-mode-support', 'error', '当前模式未被支持', '先将该模式加入支持列表，或选择已经支持的模式。', 'app-motion', 'activeMode');
  if (supported.includes('calibration') && active !== 'calibration' && !enabled('app-calibration')) add('calibration-module-required', 'error', '校准模式依赖校准模块', '支持受限校准模式时，必须编译包含校准管理。', 'app-calibration');
  if (value('app-motion', 'commandSource') === 'communication' && !enabled('app-comms')) add('communication-module-required', 'error', '通信命令依赖通信模块', '当前命令来源为通信，但通信协议模块已关闭。', 'app-comms');
  else if (value('app-motion', 'commandSource') === 'communication' && !running('app-comms')) add('communication-runtime-required', 'error', '通信命令需要运行通信模块', '通信模块虽已编译包含，但其运行开关关闭。', 'app-comms');
  const requireCapability = (key, label, owner, paramKey) => {
    const cap = value('hw-drivers', key);
    const issueOwner=owner==='app-motion'?'hw-drivers':owner,issueKey=owner==='app-motion'?key:paramKey;
    if (cap === 'absent') add(`capability-${key}-${owner}`, 'error', `${label}依赖未满足`, `当前配置声明不具备${label}，请更改相关功能或硬件能力。`, issueOwner, issueKey);
    else if (cap !== 'present') add(`capability-${key}-${owner}`, 'pending', `${label}能力待确认`, `相关功能需要${label}；目前没有确认其存在。`, issueOwner, issueKey);
  };
  const angle = value('foc-feedback', 'angleSource');
  if (angle === 'encoder') requireCapability('encoderCapability', '电机侧编码器', 'foc-feedback', 'angleSource');

  if (angle === 'observer') {
    if (!enabled('foc-observer')) add('observer-module-required', 'error', '估算角度依赖观测器', '当前角度源为观测器，但状态观测模块已关闭。', 'foc-observer');
    else if (!running('foc-observer')) add('observer-runtime-required', 'error', '估算角度需要运行观测器', '观测器虽已编译包含，但其运行开关关闭。', 'foc-observer');
    if (observerUsesModelAngle(project) && !known(value('foc-observer', 'startupStrategy'))) add('observer-startup', 'pending', '观测器启动策略待确定', '估算角度需要明确初始位置、低速启动和失锁退出条件。', 'foc-observer', 'startupStrategy');
  }
  if (running('foc-observer') && observerUsesModelAngle(project) && value('foc-observer', 'startupStrategy') === 'encoder_assist') requireCapability('encoderCapability', '电机侧编码器', 'foc-observer', 'startupStrategy');
  if (supported.includes('torque_feedback') || active === 'torque_feedback') requireCapability('torqueCapability', '力矩传感器', 'app-motion', 'supportedModes');
  if (running('app-calibration')) {
    const procedures = (value('app-calibration', 'procedures') || []).filter(procedure=>calibrationEnabled(project,procedure));
    if (procedures.includes('hall')) {requireCapability('encoderCapability', '电机侧编码器', 'app-calibration', 'procedures');if(value('hw-drivers','motorEncoderType')!=='hall')add('hall-calibration-type','error','霍尔校准需要霍尔编码器','在电机侧编码器中选择霍尔方案。','app-calibration','procedures');}
    if (procedures.some(p => ['electrical_zero', 'hall', 'friction'].includes(p)) && !positive(value('app-calibration', 'maxCurrentA'))) add('calibration-current', 'pending', '校准激励限值待确定', '运动校准需要独立、受限的激励边界。', 'app-calibration', 'maxCurrentA');
    if(procedures.length)add('calibration-results', 'pending', '校准结果尚未获得', '这里只配置校准流程，没有设备实测结果；首次校准按独立进入条件执行。', 'app-calibration');
  }
  const derived = getDerived(project);
  const outer = value('app-motion', 'outerHz');
  if (positive(outer) && positive(derived.fastHz)) {
    if (outer >= derived.fastHz) add('outer-rate', 'error', '应用控制频率必须低于电流环', `应用控制为 ${outer} Hz，电流环为 ${derived.fastHz} Hz。`, 'app-runtime');
    else if (Math.abs(derived.fastHz / outer - Math.round(derived.fastHz / outer)) > 1e-8) add('outer-noninteger-ratio', 'warning', '外环不是电流环的整数分频', '需要明确独立时基、相位和抖动处理。', 'app-runtime');
    const timeout = value('foc-lifecycle', 'referenceTimeoutMs');
    if (positive(timeout) && timeout < 1000 / outer) add('reference-timeout', 'error', '给定有效期短于更新周期', '电流环可能在正常的下一次外环更新前把给定判为过期。', 'foc-lifecycle', 'referenceTimeoutMs');
  }
  const currentLimit = value('app-motion', 'currentLimitA');
  const protection = value('foc-lifecycle', 'maxCurrentA');
  if (positive(currentLimit) && positive(protection) && currentLimit > protection) add('current-limit', 'error', '控制限值超过保护阈值', '动态电流限值不得大于快速电流保护阈值。', 'app-motion', 'currentLimitA');
  const calLimit = value('app-calibration', 'maxCurrentA');
  if (['electrical_zero','hall','friction'].some(procedure=>calibrationEnabled(project,procedure)) && positive(calLimit) && positive(currentLimit) && calLimit > currentLimit) add('calibration-limit', 'error', '校准激励超过电流限值', '校准路径同样受统一输出边界约束。', 'app-calibration', 'maxCurrentA');
  const minDuty = value('foc-modulation', 'dutyMin');
  const maxDuty = value('foc-modulation', 'dutyMax');
  if (typeof minDuty === 'number' && typeof maxDuty === 'number' && minDuty >= maxDuty) add('duty-range', 'error', '占空比上下界冲突', '最小占空比必须小于最大占空比。', 'foc-modulation', 'dutyMin');
  if (value('hw-safety', 'resetOutputDisabled') !== true) add('reset-output', 'error', '必须保持复位默认关断', '在配置、必要校准与状态许可完成前，不允许自动输出。', 'hw-safety', 'resetOutputDisabled');
  if (value('hw-board', 'currentTopology') === 'single_shunt') add('single-shunt-window', 'pending', '单电阻采样窗口待验证', '需要验证电流重构、调制窗口、ADC 转换时间与 PWM 更新关系。', 'hw-board');

  const regionKeys = ['motionCalibrationKiB', 'parametersKiB', 'runtimeRecordsKiB'];
  const regions = regionKeys.map(key => value('app-params', key));
  const flash = value('hw-platform', 'flashKiB');
  const erase = value('hw-platform', 'eraseKiB');
  const reserve = value('hw-platform', 'firmwareReserveKiB');
  if (!project.memory?.layout.banks.length && positive(erase)) {
    for (const [id, key, size] of [...regionKeys.map((key, i) => ['app-params', key, regions[i]]), ['hw-platform', 'firmwareReserveKiB', reserve]]) {
      if (typeof size === 'number' && size >= 0 && Math.abs(size / erase - Math.round(size / erase)) > 1e-8) add(`alignment-${key}`, 'error', '存储区未按擦除粒度对齐', `${key} 为 ${size} KiB，规划擦除粒度为 ${erase} KiB。`, id, key);
    }
  }
  if (project.memory?.layout.banks.length) {
    // Explicit physical erase units supersede the legacy uniform-capacity estimate.
  } else if (regions.every(v => typeof v === 'number' && v >= 0) && typeof reserve === 'number' && reserve >= 0 && positive(flash)) {
    const total = regions.reduce((sum, v) => sum + v, reserve);
    if (!Number.isFinite(total) || total > flash) add('storage-capacity', 'error', 'Flash 规划超过总容量', `数据与代码预留合计 ${total} KiB，可规划容量为 ${flash} KiB。`, 'hw-platform', 'flashKiB');
  } else add('storage-layout-incomplete', 'pending', '存储布局待补齐', '只有三个数据区、代码升级预留及 Flash 总量都已知，才能检查容量关系。', 'hw-platform');
  if (Object.values(project.provenance).includes('example')) add('example-values', 'info', '包含预置参数', '预置参数需按实际电机与硬件确认，并完成整定。');
  const position=value('app-motion','positionFeedback');
  if(position==='output_encoder')requireCapability('outputEncoderCapability','出轴侧编码器','app-motion','positionFeedback');
  issues.push(...validateModuleConfiguration(project), ...validateDesign(project), ...validateModuleContracts(project), ...validateSelectedEquipment(project), ...validateLayerVersions(project), ...validateMemory(project), ...validateExecution(project), ...validateSchedule(project));
  return issues;
}
