import { availableAlgorithmSignals, resolveAlgorithmSignal } from './signals.mjs';

/** Consumer domains are explicit; matching units alone do not make a source compatible. */
export const CONSUMER_SIGNALS = Object.freeze([
  { moduleId: 'app-motion', paramKey: 'positionFeedbackSignal', label: '位置反馈', quantities: ['motor-angle', 'output-angle'], requiredModes: ['position', 'impedance'], description: '电机侧机械角度按执行器减速比、方向及零位换算；出轴侧机械角度直接使用。电角度不能作为机械位置。' },
  { moduleId: 'app-motion', paramKey: 'speedFeedbackSignal', label: '速度反馈', quantities: ['motor-speed', 'output-speed'], requiredModes: ['speed', 'position', 'impedance'], description: '电机侧机械速度按执行器减速比与方向换算为出轴速度；出轴侧机械速度直接使用。' },
  { moduleId: 'app-motion', paramKey: 'torqueFeedbackSignal', label: '力矩反馈', quantities: ['sensor-torque'], requiredModes: ['torque_feedback'], description: '使用已换算为 N·m 的力矩传感器信号；电机侧扰动转矩不能代替传感器测量值。' },
].map(spec => Object.freeze({ ...spec, quantities: Object.freeze(spec.quantities), requiredModes: Object.freeze(spec.requiredModes) })));

export const isDefaultConsumerSignal = value => value === undefined || value === null || value === '' || value === 'default';
export const consumerSignalSpec = key => CONSUMER_SIGNALS.find(spec => spec.paramKey === key) || null;
const defaultPositionSources = [['motor_reduction', '电机轴编码器 · 减速换算'], ['output_encoder', '出轴编码器']];
const consumerActive = (project, spec) => {
  const instance = project?.instances?.[spec.moduleId], parameters = instance?.parameters;
  return Boolean(instance?.enabled && instance.runtimeEnabled && spec.requiredModes.some(mode => parameters?.supportedModes?.includes(mode) || parameters?.activeMode === mode));
};
const compatible = (signal, spec) => Boolean(signal && !signal.cycle && signal.type === 'f32' && signal.count === 1 && spec.quantities.includes(signal.quantity));

/** The default sentinel is selectable; unresolved saved references remain visible for repair. */
export function consumerSignalChoices(project, key) {
  const spec = consumerSignalSpec(key);
  if (!spec) return [];
  const choices = availableAlgorithmSignals(project).filter(signal => compatible(signal, spec)).map(signal => [signal.id, signal.label]);
  const selected = project?.instances?.[spec.moduleId]?.parameters?.[key];
  if (!isDefaultConsumerSignal(selected) && !choices.some(([reference]) => reference === selected)) {
    choices.push([selected, `${resolveAlgorithmSignal(project, selected)?.label || '原反馈信号'} · 待检查`]);
  }
  const defaults = key === 'positionFeedbackSignal'
    ? [...(defaultPositionSources.some(([value]) => value === project?.instances?.['app-motion']?.parameters?.positionFeedback) ? [] : [['default', '默认反馈 · 待选择']]), ...defaultPositionSources.map(([value, label]) => [`default:${value}`, label])]
    : [['default', '默认反馈']];
  return [...defaults, ...choices];
}

/** Present the existing default position source in the same control as custom signals. */
export function consumerSignalControlValue(project, key) {
  const spec = consumerSignalSpec(key);
  if (!spec) throw new Error('反馈使用位置不存在。');
  const parameters = project?.instances?.[spec.moduleId]?.parameters;
  const value = parameters?.[key];
  if (!isDefaultConsumerSignal(value)) return value;
  return key === 'positionFeedbackSignal' && defaultPositionSources.some(([source]) => source === parameters?.positionFeedback)
    ? `default:${parameters.positionFeedback}` : 'default';
}

/** A UI default-position choice updates the legacy source without inventing a new signal binding. */
export function applyConsumerSignalSelection(project, key, value) {
  const spec = consumerSignalSpec(key), parameters = project?.instances?.[spec?.moduleId]?.parameters;
  if (!spec || !parameters) throw new Error('反馈使用位置不存在。');
  if (typeof value !== 'string' || value !== 'default' && !consumerSignalChoices(project, key).some(([reference]) => reference === value)) throw new Error('请选择兼容且可用的反馈信号。');
  if (key === 'positionFeedbackSignal' && value.startsWith('default:')) {
    parameters.positionFeedback = value.slice('default:'.length);
    parameters[key] = 'default';
  } else parameters[key] = value;
  return parameters;
}

/** Design-time use locations only: this does not wire processing outputs into firmware. */
export function algorithmSignalUsages(project, reference) {
  if (isDefaultConsumerSignal(reference)) return [];
  const signal = resolveAlgorithmSignal(project, reference);
  return CONSUMER_SIGNALS.filter(spec => project?.instances?.[spec.moduleId]?.parameters?.[spec.paramKey] === reference).map(spec => ({
    moduleId: spec.moduleId, paramKey: spec.paramKey, label: spec.label, reference,
    active: consumerActive(project, spec), quantity: signal?.quantity || null,
    conversion: ['motor-angle', 'motor-speed'].includes(signal?.quantity) ? 'reducer' : 'direct',
    description: spec.description,
  }));
}

/** Saved generic connections are compatibility data, never executable fixed-function bindings. */
export function legacyConsumerBindings(project) {
  return CONSUMER_SIGNALS.flatMap(spec => {
    const reference = project?.instances?.[spec.moduleId]?.parameters?.[spec.paramKey];
    if (isDefaultConsumerSignal(reference)) return [];
    return [{ moduleId: spec.moduleId, paramKey: spec.paramKey, label: spec.label, reference,
      signalLabel: resolveAlgorithmSignal(project, reference)?.label || reference }];
  });
}

/** Called only by an explicit user action. Returns the count cleared; never changes sources or tuning. */
export function resetLegacyConsumerBindings(project, key) {
  if (key !== undefined && !consumerSignalSpec(key)) throw new Error('旧反馈连接不存在。');
  const bindings = legacyConsumerBindings(project).filter(binding => key === undefined || binding.paramKey === key);
  for (const binding of bindings) project.instances[binding.moduleId].parameters[binding.paramKey] = 'default';
  return bindings.length;
}

export function validateSignalConsumers(project) {
  return legacyConsumerBindings(project).map(binding => ({
    id: `signal-consumer-${binding.paramKey}`, code: 'legacy-consumer-binding', level: 'pending', title: '旧连接待替换',
    moduleId: binding.moduleId, paramKey: binding.paramKey,
    message: `${binding.label}仍保留旧信号连接“${binding.signalLabel}”。请在控制环中显式移除旧连接，再使用固定功能配置；旧连接不会自动执行。`,
    messageParts: [{ type: 'reference', kind: 'consumer', label: binding.label }, ' 仍保留旧信号连接 ', { type: 'reference', kind: 'signal', label: binding.signalLabel }, '。请在控制环中显式移除旧连接，再使用固定功能配置；旧连接不会自动执行。'],
  }));
}

/** Fill only newly introduced keys; explicit choices and older empty-default values survive. */
export function migrateSignalConsumerParameters(instances) {
  const parameters = instances?.['app-motion']?.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return false;
  let changed = false;
  for (const { paramKey } of CONSUMER_SIGNALS) if (!Object.hasOwn(parameters, paramKey)) {
    parameters[paramKey] = 'default';
    changed = true;
  }
  return changed;
}
