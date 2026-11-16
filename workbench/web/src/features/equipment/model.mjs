import { validateHardware } from '../../modules/hardware/hw-board/validation.mjs';
import { syncMcuArchitecture } from '../deployment/mcu.mjs';
import { sensorFieldVisible, sensorIssues } from '../../modules/hardware/hw-drivers/sensors.mjs';
import { createMemoryLayout, createMemoryPlan, checkMemoryLayoutShape, validateMemory } from '../deployment/flash.mjs';
/** Catalog v2 keeps legacy keys: actuators = motor + reducer, assemblies = actuator + driver.
 * Reusable design assets. No device access or verified hardware capabilities. */
import { MODULES, checkParameter } from '../../core/catalog.mjs';
const hardwareModules = MODULES.filter(module => module.layer === 'hardware');
const sharedHardware = {
  'hw-board': ['busVoltageV', 'pwmHz', 'adcBits', 'adcClockHz', 'deadtimeNs'],
  'hw-platform': ['flashKiB', 'eraseKiB', 'firmwareReserveKiB'],
};
const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
const MOTOR_FIELDS = ['polePairs', 'statorSlots', 'resistanceOhm', 'inductanceDH', 'inductanceQH', 'fluxWb', 'torqueConstantNmA', 'ratedCurrentA', 'maxCurrentA', 'maxSpeedRpm'];
const REDUCER_FIELDS = ['ratio', 'efficiency', 'backlashArcmin', 'ratedOutputTorqueNm', 'maxOutputTorqueNm'];
const DRIVER_FIELDS = ['busVoltageV', 'maxCurrentA', 'pwmHz', 'adcBits', 'adcClockHz', 'deadtimeNs', 'flashKiB', 'eraseKiB', 'firmwareReserveKiB'];
const emptyNumbers = fields => Object.fromEntries(fields.map(key => [key, null]));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => Array.isArray(value) ? value.map(stable) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

/** A component boundary can only tighten an explicit configured limit. Unknown
 * ratings neither erase that value nor establish a new safe operating limit. */
export function constrainCurrentLimit(value, ...boundaries) {
  return positive(value) ? Math.min(value, ...boundaries.filter(positive)) : value;
}

export function createCatalog() { return { actuators: [], drivers: [], assemblies: [], activeAssemblyId: '', activeActuatorId: '', activeDriverId: '', appliedFingerprint: '' }; }
export function createActuator(name = '新执行器') { return { id: id('actuator'), name, motor: emptyNumbers(MOTOR_FIELDS), reducer: emptyNumbers(REDUCER_FIELDS) }; }
export function createDriver(name = '新驱动器') { return { id: id('driver'), name, vendor: 'unselected', mcu: '', board: '', ...emptyNumbers(DRIVER_FIELDS), bindings: [], hardware: emptyHardware(), memoryLayout: createMemoryLayout() }; }
export function createAssembly(name = '新关节模组') { return { id: id('assembly'), name, actuatorId: '', driverId: '' }; }
export function isAssemblyComplete(catalog, assembly) {
  return typeof assembly?.actuatorId === 'string' && Boolean(assembly.actuatorId.trim())
    && typeof assembly?.driverId === 'string' && Boolean(assembly.driverId.trim())
    && Array.isArray(catalog?.actuators) && catalog.actuators.some(item => item?.id === assembly.actuatorId)
    && Array.isArray(catalog?.drivers) && catalog.drivers.some(item => item?.id === assembly.driverId);
}
export function createJointModule(project, { name = '', actuatorId, driverId } = {}) {
  const catalog = project?.catalog;
  const actuator = typeof actuatorId === 'string' && actuatorId.trim() && Array.isArray(catalog?.actuators)
    ? catalog.actuators.find(item => item?.id === actuatorId) : null;
  const driver = typeof driverId === 'string' && driverId.trim() && Array.isArray(catalog?.drivers)
    ? catalog.drivers.find(item => item?.id === driverId) : null;
  if (!actuator && !driver) throw new Error('请先从货架选择执行器和驱动器，再创建关节模组。');
  if (!actuator) throw new Error('执行器不存在，请先从货架选择执行器，再创建关节模组。');
  if (!driver) throw new Error('驱动器不存在，请先从货架选择驱动器，再创建关节模组。');
  text(name, '关节模组.name');
  return { ...createAssembly(name.trim() || `${actuator.name} + ${driver.name}`), actuatorId: actuator.id, driverId: driver.id };
}
export function createBinding() { return { id: id('binding'), signal: '', peripheral: '', pin: '', mode: 'alternate', notes: '' }; }

function keys(value, allowed, location, optional = []) {
  if (!plain(value)) throw new Error(`${location} 必须是对象。`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${location} 含未知字段：${key}`);
  for (const key of allowed) if (!optional.includes(key) && !Object.hasOwn(value, key)) throw new Error(`${location} 缺少字段：${key}`);
}
function text(value, location, nonempty = false) { if (typeof value !== 'string' || (nonempty && !value.trim())) throw new Error(`${location} 必须是${nonempty ? '非空' : ''}文本。`); }
function numbers(value, fields, location) { for (const key of fields) if (value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) throw new Error(`${location}.${key} 必须是有限数字或 null。`); }
function collection(value, location) {
  if (!Array.isArray(value)) throw new Error(`${location} 必须是数组。`);
  const ids = new Set();
  for (const item of value) { if (!plain(item)) throw new Error(`${location} 的条目必须是对象。`); text(item.id, `${location}.id`, true); if (ids.has(item.id)) throw new Error(`${location} 含重复 id：${item.id}`); ids.add(item.id); }
}

export function checkCatalogShape(catalog) {
  keys(catalog, ['actuators', 'drivers', 'assemblies', 'activeAssemblyId', 'activeActuatorId', 'activeDriverId', 'appliedFingerprint'], 'catalog', ['activeActuatorId', 'activeDriverId']);
  if (Object.hasOwn(catalog, 'activeActuatorId')) text(catalog.activeActuatorId, 'catalog.activeActuatorId');
  if (Object.hasOwn(catalog, 'activeDriverId')) text(catalog.activeDriverId, 'catalog.activeDriverId');
  text(catalog.activeAssemblyId, 'catalog.activeAssemblyId'); text(catalog.appliedFingerprint, 'catalog.appliedFingerprint');
  for (const key of ['actuators', 'drivers', 'assemblies']) collection(catalog[key], `catalog.${key}`);
  for (const actuator of catalog.actuators) {
    keys(actuator, ['id', 'name', 'motor', 'reducer'], '执行器'); text(actuator.name, '执行器.name');
    keys(actuator.motor, MOTOR_FIELDS, '执行器.motor', ['statorSlots']); numbers(actuator.motor, MOTOR_FIELDS.filter(key=>Object.hasOwn(actuator.motor,key)), '执行器.motor');
    keys(actuator.reducer, REDUCER_FIELDS, '执行器.reducer', ['ratedOutputTorqueNm']); numbers(actuator.reducer, REDUCER_FIELDS.filter(key=>Object.hasOwn(actuator.reducer,key)), '执行器.reducer');
  }
  for (const driver of catalog.drivers) {
    keys(driver, ['id', 'name', 'vendor', 'mcu', 'board', ...DRIVER_FIELDS, 'bindings', 'hardware', 'memoryLayout'], '驱动器', ['hardware', 'memoryLayout']);
    if(Object.hasOwn(driver,'memoryLayout'))checkMemoryLayoutShape(driver.memoryLayout);
    for (const key of ['name', 'vendor', 'mcu', 'board']) text(driver[key], `驱动器.${key}`);
    if (!['unselected', 'st', 'hpmicro', 'other'].includes(driver.vendor)) throw new Error('驱动器.vendor 不是允许的选项。');
    numbers(driver, DRIVER_FIELDS, '驱动器'); collection(driver.bindings, '驱动器.bindings');
    if (Object.hasOwn(driver, 'hardware')) {
      keys(driver.hardware, hardwareModules.map(module => module.id), '驱动器.hardware');
      for (const module of hardwareModules) {
        keys(driver.hardware[module.id], module.params.map(param => param.key), `驱动器.hardware.${module.id}`, module.params.map(param=>param.key));
        for (const param of module.params) if(Object.hasOwn(driver.hardware[module.id],param.key)) checkParameter(driver.hardware[module.id][param.key], param, `驱动器.hardware.${module.id}.${param.key}`);
      }
    }
    for (const binding of driver.bindings) {
      keys(binding, ['id', 'signal', 'peripheral', 'pin', 'mode', 'notes'], '绑定');
      for (const key of ['signal', 'peripheral', 'pin', 'mode', 'notes']) text(binding[key], `绑定.${key}`);
      if (!['analog', 'alternate', 'input', 'output'].includes(binding.mode)) throw new Error('绑定.mode 不是允许的模式。');
    }
  }
  for (const assembly of catalog.assemblies) {
    keys(assembly, ['id', 'name', 'actuatorId', 'driverId', 'firmwareId'], '组合', ['firmwareId']);
    if(assembly.firmwareId!==undefined)text(assembly.firmwareId,'组合.firmwareId');
    for (const key of ['name', 'actuatorId', 'driverId']) text(assembly[key], `组合.${key}`);
  }
  return true;
}

function emptyHardware() { return Object.fromEntries(hardwareModules.map(module => [module.id, Object.fromEntries(module.params.map(param => [param.key, structuredClone(param.defaultValue)]))])); }
export function getDriverHardware(driver) {
  const hardware = emptyHardware();
  for(const [moduleId,parameters] of Object.entries(driver.hardware||{}))Object.assign(hardware[moduleId],structuredClone(parameters));
  for (const [moduleId, fields] of Object.entries(sharedHardware)) for (const key of fields) hardware[moduleId][key] = driver[key];
  syncMcuArchitecture({...driver},hardware);
  return hardware;
}
export function setDriverHardwareParameter(driver, moduleId, key, value) {
  const param = hardwareModules.find(module => module.id === moduleId)?.params.find(param => param.key === key);
  if (!param) throw new Error('驱动器硬件参数不存在。');
  checkParameter(value, param, `${moduleId}.${key}`);
  driver.hardware ??= getDriverHardware(driver);
  driver.hardware[moduleId][key] = value;
  if (sharedHardware[moduleId]?.includes(key)) driver[key] = value;
  syncMcuArchitecture(driver, driver.hardware);
}
export function normalizeCatalog(catalog) {
  for(const actuator of catalog.actuators){actuator.motor.statorSlots??=null;actuator.reducer.ratedOutputTorqueNm??=null;}
  catalog.activeActuatorId ||= catalog.assemblies.find(item => item.id === catalog.activeAssemblyId)?.actuatorId || '';
  catalog.activeDriverId ??= catalog.assemblies.find(item => item.id === catalog.activeAssemblyId)?.driverId || '';
  for (const driver of catalog.drivers) { driver.hardware = getDriverHardware(driver); syncMcuArchitecture(driver, driver.hardware); driver.memoryLayout ??= createMemoryLayout(); }
}
export function getActiveActuator(project) {
  const catalog = project?.catalog;
  const id = catalog?.activeActuatorId || catalog?.assemblies?.find(item => item.id === catalog.activeAssemblyId)?.actuatorId;
  return catalog?.actuators?.find(actuator => actuator.id === id) || null;
}
export function getActiveDriver(project) {
  const catalog = project?.catalog;
  const id = catalog?.activeDriverId || catalog?.assemblies?.find(item => item.id === catalog.activeAssemblyId)?.driverId;
  return catalog?.drivers?.find(driver => driver.id === id) || null;
}
export function hardwareMatchesDriver(project, driver = getActiveDriver(project)) {
  if (!driver) return false;
  const target = { vendor: driver.vendor, mcu: driver.mcu, board: driver.board }, hardware = getDriverHardware(driver);
  syncMcuArchitecture(target, hardware);
  const memoryLayout=project.memory?.layout||createMemoryLayout();
  const driverLayout=driver.memoryLayout||createMemoryLayout();
  return ['vendor', 'mcu', 'board'].every(key => project.target[key] === target[key]) && hardwareModules.every(module => JSON.stringify(stable(project.instances[module.id].parameters)) === JSON.stringify(stable(hardware[module.id]))) && JSON.stringify(stable(memoryLayout))===JSON.stringify(stable(driverLayout));
}
export function captureDriverHardware(project, driverId) {
  const next = structuredClone(project), driver = next.catalog.drivers.find(item => item.id === driverId);
  if (!driver) throw new Error('驱动器不存在。');
  Object.assign(driver, next.target);
  driver.hardware = Object.fromEntries(hardwareModules.map(module => [module.id, structuredClone(next.instances[module.id].parameters)]));
  driver.memoryLayout=structuredClone(next.memory?.layout||createMemoryLayout());
  syncMcuArchitecture(driver, driver.hardware);
  for (const [moduleId, fields] of Object.entries(sharedHardware)) for (const key of fields) driver[key] = driver.hardware[moduleId][key];
  checkCatalogShape(next.catalog);
  return next;
}
export function applyDriver(project, driverId) {
  checkCatalogShape(project.catalog);
  const driver = project.catalog.drivers.find(item => item.id === driverId);
  if (!driver) throw new Error('驱动器不存在。');
  const errors = validateEquipment(project).filter(issue => issue.level === 'error' && issue.itemId === driver.id && issue.id !== 'equipment-active-current');
  if (errors.length) throw new Error(errors[0].message);
  const next = structuredClone(project);
  next.target = { vendor: driver.vendor, mcu: driver.mcu, board: driver.board };
  next.memory ??= createMemoryPlan();
  next.memory.layout=structuredClone(driver.memoryLayout||createMemoryLayout());
  const hardware = getDriverHardware(driver);
  syncMcuArchitecture(next.target, hardware);
  const savedDriver = next.catalog.drivers.find(item => item.id === driverId);
  savedDriver.hardware = structuredClone(hardware);
  syncMcuArchitecture(savedDriver, savedDriver.hardware);
  for (const module of hardwareModules) {
    next.instances[module.id].parameters = hardware[module.id];
    for (const key of Object.keys(hardware[module.id])) next.provenance[`${module.id}.${key}`] = 'user';
  }
  next.catalog.activeDriverId = driverId;
  next.catalog.activeActuatorId = getActiveActuator(project)?.id || '';
  next.catalog.activeAssemblyId = ''; next.catalog.appliedFingerprint = '';
  const limit = next.instances['app-motion'].parameters.currentLimitA;
  next.instances['app-motion'].parameters.currentLimitA = constrainCurrentLimit(limit, driver.maxCurrentA);
  return next;
}

function selected(catalog, assemblyId) {
  const assembly = catalog?.assemblies?.find(item => item.id === assemblyId) || null;
  return { assembly, actuator: catalog?.actuators?.find(item => item.id === assembly?.actuatorId) || null, driver: catalog?.drivers?.find(item => item.id === assembly?.driverId) || null };
}
export function assetFingerprint(catalog, assemblyId) { return `assembly-v1:${JSON.stringify(stable(selected(catalog, assemblyId)))}`; }

export function getAssemblySummary(project, assemblyId) {
  const catalog = project.catalog;
  const saved = selected(catalog, assemblyId === undefined ? catalog?.activeAssemblyId : assemblyId);
  const { assembly } = saved;
  const actuator = assemblyId === undefined ? getActiveActuator(project) : saved.actuator;
  const driver = assemblyId === undefined ? getActiveDriver(project) : saved.driver;
  const ratio = positive(actuator?.reducer?.ratio) ? actuator.reducer.ratio : null;
  const efficiency = ratio === 1 ? 1 : actuator?.reducer?.efficiency;
  const outputMaxSpeedRpm = positive(actuator?.motor?.maxSpeedRpm) && positive(ratio) ? actuator.motor.maxSpeedRpm / ratio : null;
  const torque = positive(actuator?.motor?.torqueConstantNmA) && positive(actuator?.motor?.ratedCurrentA) && positive(ratio) && positive(efficiency) ? actuator.motor.torqueConstantNmA * actuator.motor.ratedCurrentA * ratio * efficiency : null;
  return { actuator, driver, ratio, outputMaxSpeedRpm: Number.isFinite(outputMaxSpeedRpm) ? outputMaxSpeedRpm : null, outputRatedTorqueNm: Number.isFinite(torque) ? torque : null,
    stale: Boolean(assembly && catalog.activeAssemblyId === assembly.id && catalog.appliedFingerprint !== assetFingerprint(catalog, assembly.id)) };
}

export function validateEquipment(project) {
  const issues = [];
  const add = (id, level, title, message, itemId) => issues.push({ id: `equipment-${id}`, level, title, message, designPage: 'equipment', ...(itemId ? { itemId } : {}) });
  const catalog = project.catalog;
  try { checkCatalogShape(catalog); } catch (error) { add('format', 'error', '组件库结构不合法', error.message); return issues; }
  const range = (object, key, owner, min, max = Infinity, integer = false) => {
    const value = object[key];
    if (value != null && (value < min || value > max || (integer && !Number.isSafeInteger(value)))) add(`range-${owner}-${key}`, 'error', '组件参数超出范围', `${key} 必须${integer ? '为整数且' : ''}在 ${min} 至 ${max === Infinity ? '不限上界' : max} 范围内。`, owner);
  };
  for (const actuator of catalog.actuators) {
    if (!actuator.name.trim()) add(`name-${actuator.id}`, 'pending', '执行器名称待填写', '填写可区分的名称。', actuator.id);
    for (const key of MOTOR_FIELDS) range(actuator.motor, key, actuator.id, Number.MIN_VALUE, Infinity, ['polePairs','statorSlots'].includes(key));
    range(actuator.reducer, 'ratio', actuator.id, 1); range(actuator.reducer, 'efficiency', actuator.id, Number.MIN_VALUE, 1); range(actuator.reducer, 'backlashArcmin', actuator.id, 0); range(actuator.reducer, 'maxOutputTorqueNm', actuator.id, Number.MIN_VALUE);
    range(actuator.reducer,'ratedOutputTorqueNm',actuator.id,Number.MIN_VALUE);
    if(positive(actuator.reducer.ratedOutputTorqueNm)&&positive(actuator.reducer.maxOutputTorqueNm)&&actuator.reducer.ratedOutputTorqueNm>actuator.reducer.maxOutputTorqueNm)add(`torque-rating-${actuator.id}`,'error','执行器力矩额定值冲突','额定力矩不能大于峰值力矩。',actuator.id);
    if (positive(actuator.motor.ratedCurrentA) && positive(actuator.motor.maxCurrentA) && actuator.motor.ratedCurrentA > actuator.motor.maxCurrentA) add(`current-${actuator.id}`, 'error', '执行器电流额定值冲突', '额定电流不能大于所填写的峰值电流。', actuator.id);
  }
  for (const driver of catalog.drivers) {
    const hardware = getDriverHardware(driver);
    const detailedFlash=Boolean(driver.memoryLayout?.banks.length);
    if(detailedFlash) {
      const memory={layout:driver.memoryLayout,placements:createMemoryPlan().placements};
      for(const issue of validateMemory({...project,target:driver,memory}))if(issue.level==='error'&&!issue.id.startsWith('memory-region-'))add(`flash-${driver.id}-${issue.id}`,issue.id==='memory-target-mismatch'?'warning':'error',issue.title,issue.message,driver.id);
    }
    for(const issue of validateHardware({target:{mcu:driver.mcu},instances:Object.fromEntries(hardwareModules.map(module=>[module.id,{parameters:hardware[module.id]}]))}))if(issue.level==='error'||driver.id===catalog.activeDriverId)add(`hardware-${driver.id}-${issue.id}`,issue.level,issue.title,issue.message,driver.id);
    for(const issue of sensorIssues(hardware['hw-drivers']))if(issue.level==='error'||driver.id===catalog.activeDriverId)add(`sensor-${driver.id}-${issue.id}`,issue.level,issue.title,issue.message,driver.id);
    if (!driver.name.trim()) add(`name-${driver.id}`, 'pending', '驱动器名称待填写', '填写可区分的名称。', driver.id);
    for (const key of DRIVER_FIELDS) if(!(detailedFlash&&sharedHardware['hw-platform'].includes(key)))range(driver, key, driver.id, ['deadtimeNs', 'firmwareReserveKiB'].includes(key) ? 0 : Number.MIN_VALUE, Infinity, key === 'adcBits');
    for (const module of hardwareModules) for (const param of module.params) {
      if(detailedFlash&&module.id==='hw-platform'&&param.group==='memory')continue;
      if (param.hidden || param.architectureOnly && param.architectureOnly !== hardware['hw-platform'].architecture) continue;
      if (module.id === 'hw-drivers' && !sensorFieldVisible(param, hardware[module.id])) continue;
      if (['number','integer'].includes(param.type)) range(hardware[module.id], param.key, driver.id, param.min ?? -Infinity, param.max ?? Infinity, param.type === 'integer');
    }
    if (getDriverHardware(driver)['hw-safety'].resetOutputDisabled !== true) add(`reset-${driver.id}`, 'error', '驱动器复位必须保持输出关闭', '硬件配置需要保留复位门控约束。', driver.id);
    if (!detailedFlash && positive(driver.flashKiB) && driver.firmwareReserveKiB > driver.flashKiB) add(`flash-${driver.id}`, 'error', '驱动器 Flash 预留超过容量', '代码与升级预留不得超过可规划总容量。', driver.id);
    if (!detailedFlash && positive(driver.eraseKiB) && driver.firmwareReserveKiB !== null && Math.abs(driver.firmwareReserveKiB / driver.eraseKiB - Math.round(driver.firmwareReserveKiB / driver.eraseKiB)) > 1e-8) add(`erase-${driver.id}`, 'error', '驱动器存储预留未对齐', '代码与升级预留需要按规划擦除粒度对齐。', driver.id);
    for (const key of ['pin', 'signal']) {
      const seen = new Set();
      for (const binding of driver.bindings) {
        const value = binding[key].trim().toLowerCase();
        if (!value) continue;
        if (seen.has(value)) add(`duplicate-${driver.id}-${key}-${binding.id}`, 'error', key === 'pin' ? '引脚重复分配' : '信号重复分配', `${key === 'pin' ? '引脚' : '信号'} ${binding[key]} 被同一驱动器重复使用。`, driver.id);
        seen.add(value);
      }
    }
    for (const binding of driver.bindings) if (!binding.signal.trim() || !binding.peripheral.trim() || !binding.pin.trim()) add(`binding-${binding.id}`, 'pending', '外设绑定待补齐', '每条绑定需要信号名、外设和引脚；可使用自定义信号。', driver.id);
  }
  if (catalog.activeActuatorId && !catalog.actuators.some(actuator => actuator.id === catalog.activeActuatorId)) add('actuator-reference', 'error', '当前执行器不存在', '请重新选型，或恢复已移除的执行器。');
  if (!getActiveActuator(project)) add('actuator-selection', 'pending', '执行器待选择', '在工程中先选择执行器，再配置硬件、算法与应用。');
  if (catalog.activeDriverId && !catalog.drivers.some(driver => driver.id === catalog.activeDriverId)) add('driver-reference', 'error', '当前驱动器不存在', '请重新选型，或恢复已移除的驱动器。');
  for (const assembly of catalog.assemblies) {
    for (const [key, entries, label] of [['actuatorId', catalog.actuators, '执行器'], ['driverId', catalog.drivers, '驱动器']]) {
      if (!assembly[key]) add(`selection-${assembly.id}-${key}`, 'pending', `组合尚未选择${label}`, '组合可以先保存为草案，应用前需要完成选择。', assembly.id);
      else if (!entries.some(item => item.id === assembly[key])) add(`reference-${assembly.id}-${key}`, 'error', `组合引用的${label}不存在`, '组件可能已删除；请重新选择，原引用不会被自动替换。', assembly.id);
    }
    const { actuator, driver, outputRatedTorqueNm } = getAssemblySummary(project, assembly.id);
    if (!actuator || !driver) continue;
    range(actuator.reducer,'ratedOutputTorqueNm',actuator.id,Number.MIN_VALUE);
    if(positive(actuator.reducer.ratedOutputTorqueNm)&&positive(actuator.reducer.maxOutputTorqueNm)&&actuator.reducer.ratedOutputTorqueNm>actuator.reducer.maxOutputTorqueNm)add(`torque-rating-${actuator.id}`,'error','执行器力矩额定值冲突','额定力矩不能大于峰值力矩。',actuator.id);
    if (positive(actuator.motor.ratedCurrentA) && positive(driver.maxCurrentA) && actuator.motor.ratedCurrentA > driver.maxCurrentA) add(`rating-${assembly.id}`, 'warning', '驱动器不能覆盖执行器额定电流', '该组合需要降额，并按两者允许的电流边界限制输出。', assembly.id);
    if (positive(outputRatedTorqueNm) && positive(actuator.reducer.maxOutputTorqueNm) && outputRatedTorqueNm > actuator.reducer.maxOutputTorqueNm) add(`torque-${assembly.id}`, 'warning', '估算输出力矩超过减速器上限', '额定电流下的换算值超过所填机械上限，需要额外限制电流或调整选型；换算值不是实测能力。', assembly.id);
  }
  if (catalog.activeAssemblyId) {
    const { assembly, actuator, driver } = selected(catalog, catalog.activeAssemblyId);
    if (!assembly) add('active-reference', 'error', '当前组合不存在', '请选择现有组合并重新应用。');
    else if (actuator && driver) {
      if ((catalog.activeActuatorId && catalog.activeActuatorId !== assembly.actuatorId) || (catalog.activeDriverId && catalog.activeDriverId !== assembly.driverId)) add('active-selection', 'error', '当前组合与独立选型不一致', '请重新选择执行器或驱动器，或应用该货架组合。', assembly.id);
      if (!catalog.appliedFingerprint || getAssemblySummary(project, assembly.id).stale) add('active-stale', 'warning', '当前组合需要重新应用', '组件或组合内容变化后，项目参数不会自动覆盖；请核对并重新应用。', assembly.id);
      if (!positive(actuator.motor.maxCurrentA) || !positive(driver.maxCurrentA)) add('current-unknown', 'pending', '组合电流边界待确定', '请核对执行器和驱动器的最大允许电流。已有控制限值会保留，但不代表未知的组件边界已验证。', assembly.id);
      const limit = project.instances?.['app-motion']?.parameters?.currentLimitA;
      if (positive(limit) && ((positive(actuator.motor.maxCurrentA) && limit > actuator.motor.maxCurrentA) || (positive(driver.maxCurrentA) && limit > driver.maxCurrentA))) add('active-current', 'error', '项目电流限值超过当前组件边界', '请降低项目限值或重新应用组合，并核对峰值、连续电流的定义。', assembly.id);
      add('pin-capability', 'pending', 'MCU 外设与引脚能力待验证', '引脚无重复仅代表规划一致；复用功能、封装引脚、采样时序与保护路径仍需按实际芯片和板卡确认。', driver.id);
    }
  }
  if (!catalog.activeAssemblyId) {
    const actuator = getActiveActuator(project), driver = getActiveDriver(project), limit = project.instances?.['app-motion']?.parameters?.currentLimitA;
    if (actuator && (!positive(actuator.motor.maxCurrentA) || !driver || !positive(driver.maxCurrentA))) add('current-unknown', 'pending', '组件电流边界待确定', '请核对执行器和硬件的最大允许电流。已有控制限值会保留，但不代表未知的组件边界已验证。', actuator.id);
    if (actuator && positive(limit) && ((positive(actuator.motor.maxCurrentA) && limit > actuator.motor.maxCurrentA) || (driver && positive(driver.maxCurrentA) && limit > driver.maxCurrentA))) add('active-current', 'error', '电流限值超过当前组件边界', '请降低电流限值，或重新核对执行器与驱动器选型。', actuator.id);
  }
  return issues;
}

export function applyAssembly(project, assemblyId) {
  checkCatalogShape(project.catalog);
  const { assembly, actuator, driver } = selected(project.catalog, assemblyId);
  if (!assembly || !actuator || !driver) throw new Error('应用前必须选择存在的执行器和驱动器。');
  const errors = validateEquipment(project).filter(issue => issue.level === 'error' && issue.id !== 'equipment-active-current' && [assembly.id, actuator.id, driver.id].includes(issue.itemId));
  if (errors.length) throw new Error(`组合存在冲突：${errors[0].message}`);
  const next = applyDriver(project, driver.id);
  next.provenance ||= {};
  const set = (moduleId, key, value) => {
    if (!next.instances?.[moduleId]?.parameters) throw new Error(`项目缺少模块：${moduleId}`);
    next.instances[moduleId].parameters[key] = value;
    next.provenance[`${moduleId}.${key}`] = 'user';
  };
  for (const key of ['pwmHz', 'adcBits', 'adcClockHz', 'deadtimeNs']) set('hw-board', key, driver[key]);
  for (const key of ['flashKiB', 'eraseKiB', 'firmwareReserveKiB']) set('hw-platform', key, driver[key]);
  set('hw-board', 'busVoltageV', driver.busVoltageV);
  const existingLimit = next.instances?.['app-motion']?.parameters?.currentLimitA;
  const limit = constrainCurrentLimit(existingLimit, actuator.motor.maxCurrentA, driver.maxCurrentA);
  set('app-motion', 'currentLimitA', limit);
  next.catalog.activeAssemblyId = assembly.id;
  next.catalog.activeActuatorId = actuator.id;
  next.catalog.appliedFingerprint = assetFingerprint(next.catalog, assembly.id);
  return next;
}

/** Shelf drafts remain editable without blocking the selected control configuration. */
export function validateSelectedEquipment(project) {
  const catalog = project.catalog;
  const selectedIds = new Set([catalog?.activeAssemblyId, getActiveActuator(project)?.id, getActiveDriver(project)?.id]);
  return validateEquipment(project).filter(issue => !issue.itemId || selectedIds.has(issue.itemId));
}
