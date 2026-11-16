import calibration from './definition.mjs';
const definitions = calibration.params.find(param => param.key === 'procedures').options;
const names = new Map(definitions.map(option => [option.value, option.label]));
const instanceFor = project => project.instances?.['app-calibration'];
const running = instance => instance?.enabled === true && instance.runtimeEnabled === true;
const compiledProjects = instance => Array.isArray(instance?.parameters?.procedures) ? instance.parameters.procedures : [];
function runtimeProjects(instance) {
  const params = instance?.parameters;
  if (!params) return [];
  // Older files had one list. Only an absent field inherits it; an explicit [] stays off.
  if (!Object.hasOwn(params, 'enabledProcedures')) return compiledProjects(instance);
  return Array.isArray(params.enabledProcedures) ? params.enabledProcedures : [];
}

/** A configuration permission, not an actual calibration request or hardware status. */
export function calibrationEnabled(project, procedure) {
  const instance = instanceFor(project);
  return names.has(procedure) && running(instance) && compiledProjects(instance).includes(procedure) && runtimeProjects(instance).includes(procedure);
}

export function validateCalibration(project) {
  const issues = [];
  const add = (id, level, title, message, paramKey = 'enabledProcedures') => issues.push({ id: `calibration-${id}`, level, title, message, moduleId: 'app-calibration', ...(paramKey ? { paramKey } : {}) });
  const instance = instanceFor(project), params = instance?.parameters || {};
  const compiled = compiledProjects(instance), allowed = runtimeProjects(instance);
  for (const key of ['procedures', 'enabledProcedures']) {
    const value = params[key];
    if (value !== undefined && value !== null && (!Array.isArray(value) || value.some(item => !names.has(item)) || new Set(value).size !== value.length)) {
      add(`invalid-${key}`, 'error', '校准项目列表无效', '校准列表只能包含已定义、互不重复的项目。', key);
    }
  }
  const unavailable = allowed.filter(procedure => names.has(procedure) && !compiled.includes(procedure));
  if (unavailable.length) add('runtime-not-compiled', 'error', '运行允许的校准项目未编译', `${unavailable.map(procedure => names.get(procedure)).join('、')}尚未编译包含。请先包含这些功能，或关闭其运行许可。`);
  const activeMode = project.instances?.['app-motion']?.parameters?.activeMode;
  if (activeMode === 'calibration') {
    if (!running(instance)) add('runtime-disabled', 'error', '校准管理当前不能运行', '当前选择了校准模式，需要编译包含并运行启用校准管理。', null);
    else if (!allowed.some(procedure => calibrationEnabled(project, procedure))) add('no-runtime-procedures', 'error', '校准模式没有可运行项目', '至少选择一个已编译且运行允许的校准项目，或切换到其他控制模式。');
  }
  return issues;
}
