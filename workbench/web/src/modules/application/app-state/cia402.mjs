/** CiA 402 configuration, separate from the EtherCAT state machine.
 * Standard object/mode reference:
 * https://software-dl.ti.com/processor-industrial-sw/esd/ind_comms_sdk/am263px/10_02_00_22/docs/am263px/ethercat_subdevice/example2.html
 * Negative mode values below belong to neofsa/app/include/app_cia402.h, not CiA 402.
 */
export const CIA402_REFERENCE = 'https://software-dl.ti.com/processor-industrial-sw/esd/ind_comms_sdk/am263px/10_02_00_22/docs/am263px/ethercat_subdevice/example2.html';
export const CIA402_MODES = Object.freeze([
  ['pp', 1, 'PP · 轮廓位置', 'position'],
  ['pv', 3, 'PV · 轮廓速度', 'speed'],
  ['pt', 4, 'PT · 轮廓力矩', 'torque_feedback'],
  ['hm', 6, 'HM · 回零', null],
  ['csp', 8, 'CSP · 周期同步位置', 'position'],
  ['csv', 9, 'CSV · 周期同步速度', 'speed'],
  ['cst', 10, 'CST · 周期同步力矩', 'torque_feedback'],
  ['ppc', -1, 'PPC · 轮廓位置 / 电流内环', 'position'],
  ['pvc', -3, 'PVC · 轮廓速度 / 电流内环', 'speed'],
  ['cspc', -8, 'CSPC · 周期同步位置 / 电流内环', 'position'],
  ['csvc', -9, 'CSVC · 周期同步速度 / 电流内环', 'speed'],
  ['csc', -10, 'CSC · 周期同步电流', 'current'],
  ['pd', -128, 'PD · 力位混合', 'impedance'],
  ['if', -126, 'I/F · 电流开环', null],
  ['vf', -125, 'V/F · 电压开环', null],
  ['asc', -124, 'ASC · 主动短路制动', null],
].map(([value, code, label, controlMode]) => Object.freeze({ value, code, label, custom: code < 0, standard: code > 0, controlMode, controlModes: Object.freeze(controlMode === 'torque_feedback' ? ['current', 'torque_feedback'] : controlMode ? [controlMode] : []), firmwareEnum: `CIA402_MODE_${value.toUpperCase()}` })));

export const CIA402_STATES = Object.freeze([
  { id: 'not_ready', label: '未准备好', statusword: 0x0000 },
  { id: 'switch_on_disabled', label: '禁止接通', statusword: 0x0040 },
  { id: 'ready', label: '准备接通', statusword: 0x0021 },
  { id: 'switched_on', label: '已接通', statusword: 0x0023 },
  { id: 'operation_enabled', label: '运行使能', statusword: 0x0027 },
  { id: 'quick_stop', label: '快速停止', statusword: 0x0007 },
  { id: 'fault_reaction', label: '故障响应', statusword: 0x000F },
  { id: 'fault', label: '故障', statusword: 0x0008 },
].map(Object.freeze));

export const CIA402_OBJECTS = Object.freeze([
  { index: 0x6040, name: 'Controlword', direction: 'input', type: 'u16' },
  { index: 0x6041, name: 'Statusword', direction: 'output', type: 'u16' },
  { index: 0x6060, name: 'Modes of operation', direction: 'input', type: 'i8' },
  { index: 0x6061, name: 'Modes of operation display', direction: 'output', type: 'i8' },
].map(Object.freeze));

export function getCia402Design(project) {
  const parameters = project?.instances?.['app-state']?.parameters || {};
  const requested = Array.isArray(parameters.cia402Modes) ? parameters.cia402Modes : [];
  return {
    enabled: parameters.stateMachine === 'cia402',
    modes: structuredClone(CIA402_MODES.filter(mode => requested.includes(mode.value))),
    defaultMode: structuredClone(CIA402_MODES.find(mode => mode.value === parameters.cia402DefaultMode) || null),
    states: structuredClone(CIA402_STATES), objects: structuredClone(CIA402_OBJECTS),
    reference: CIA402_REFERENCE,
  };
}

export function validateCia402(project) {
  const runtime = project?.instances?.['app-state'];
  if (!runtime?.enabled || runtime.parameters?.stateMachine !== 'cia402') return [];
  const issues = [];
  const add = (id, level, title, message, moduleId = 'app-state', paramKey = 'cia402Modes') => issues.push({ id: `cia402-${id}`, level, title, message, moduleId, paramKey });
  const p = runtime.parameters;
  const modes = p.cia402Modes;
  if (!Array.isArray(modes) || modes.some(mode => !CIA402_MODES.some(item => item.value === mode)) || new Set(modes).size !== modes.length) {
    add('modes-invalid', 'error', 'CiA 402 模式列表不合法', '请选择已定义的模式，每个模式只保留一次。');
    return issues;
  }
  if (!modes.length) add('modes-empty', 'pending', 'CiA 402 模式待选择', '选择固件包含的操作模式；标记「自定义」的扩展模式具有独立的负数编号。');
  if (p.cia402DefaultMode && p.cia402DefaultMode !== 'none' && !modes.includes(p.cia402DefaultMode)) add('default-not-compiled', 'error', '默认模式未包含', '默认模式必须包含在编译模式列表中，或选择等待主站指定。', 'app-state', 'cia402DefaultMode');
  const comms = project.instances['app-comms'];
  const motion = project.instances['app-motion'];
  for (const [id, module] of [['app-comms', comms], ['app-motion', motion]]) {
    if (!module?.enabled || (runtime.runtimeEnabled && !module.runtimeEnabled)) add(`dependency-${id}`, 'error', 'CiA 402 依赖未启用', '状态机需要通信协议与运动控制共同处理命令、反馈和运行许可。', id);
  }
  const supported = motion?.parameters?.supportedModes || [];
  for (const mode of CIA402_MODES.filter(item => modes.includes(item.value) && item.controlModes.length && !item.controlModes.some(value => supported.includes(value)))) add(`motion-${mode.value}`, 'error', `${mode.label} 缺少控制模式`, '请在运动控制中包含对应的控制模式；力矩模式可使用电流估算或力矩反馈，具体换算取决于驱动实现。', 'app-motion', 'supportedModes');
  const profiles = [];
  if (modes.some(mode => ['pp', 'ppc'].includes(mode))) profiles.push('profileVelocityRadS', 'profileAccelerationRadS2', 'profileDecelerationRadS2', 'profilePositionWindowRad');
  if (modes.some(mode => ['pv', 'pvc'].includes(mode))) profiles.push('profileAccelerationRadS2', 'profileDecelerationRadS2', 'profileVelocityWindowRadS');
  if (modes.includes('pt')) profiles.push('profileTorqueSlopeNmS', 'profileTorqueWindowNm');
  if (profiles.length) profiles.push('profileTargetTimeMs');
  for (const key of new Set(profiles)) {
    const value = motion?.parameters?.[key];
    if (value === null || value === undefined) add(`profile-missing-${key}`, 'pending', '轮廓参数待填写', '当前选择的轮廓模式需要由协议配置提供速度、斜率或到达判据。', 'app-state', 'cia402Modes');
    else if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) add(`profile-range-${key}`, 'error', '轮廓参数必须大于零', '有限的正数才可作为轨迹斜率、窗口或稳定时间。', 'app-state', 'cia402Modes');
  }
  add('mapping-unverified', 'pending', 'CiA 402 联调待完成', '状态字、控制字、模式显示、对象单位与 PDO / ESI 映射需与主站核对；EtherCAT OP 状态本身不表示驱动已使能。');
  return issues;
}
