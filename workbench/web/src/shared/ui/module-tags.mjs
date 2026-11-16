import { esc } from '../esc.mjs';

const compileHint = '编译期：开启后生成并编译此模块；关闭后不生成模块代码。';
const runtimeHint = '运行期：已编译模块的默认启用状态，可在运行时切换；不代表设备正在运行。';

/** Compact, non-interactive configuration status for module cards. */
export function renderModuleTags(instance, module) {
  if (module?.required) return '<span class="module-tag module-tag-required">必需</span>';
  if (instance?.enabled !== true) return '';
  return `<span class="module-tags" role="group" aria-label="模块配置状态"><span class="module-tag module-tag-compile" title="${compileHint}">编译期</span>${instance.runtimeEnabled === true ? `<span class="module-tag module-tag-runtime" title="${runtimeHint}">运行期</span>` : ''}</span>`;
}

/** Native checkboxes styled as tags; the shell owns the existing change actions. */
export function renderModuleToggles(module, instance, {switchStyle=true}={}) {
  if (!module?.id) return '';
  if (module.required) return '<span class="module-tag module-tag-required">必需</span>';
  const compiled = instance?.enabled === true;
  const running = compiled && instance?.runtimeEnabled === true;
  const compileLocked = module.required === true;
  const runtimeLocked = module.runtimeSwitchable !== true || !compiled;
  const compileTitle = compileLocked ? '必需模块固定编译，不能关闭。' : compileHint;
  const runtimeTitle = !compiled ? '先包含编译，才能启用运行配置；此开关不代表设备状态。' : module.runtimeSwitchable !== true ? '必需模块运行配置固定启用；此标记不代表设备正在运行。' : runtimeHint;
  const toggle = (role, label, action, checked, disabled, title) => `<label class="module-toggle module-toggle-${role}${switchStyle?' switch-field module-tag-switch':''}" title="${title}"><input type="checkbox" data-action="${action}" data-module="${esc(module.id)}" aria-label="${esc(module.title || module.id)} · ${label}配置" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${switchStyle?`<span class="switch-ui" data-phase-label="${label}" aria-hidden="true"></span>`:`<span class="module-toggle-pill">${label}</span>`}</label>`;
  return `<div class="module-toggles" role="group" aria-label="${esc(module.title || module.id)}的模块配置">${compiled ? toggle('runtime', '运行期', 'toggle-runtime', running, runtimeLocked, runtimeTitle) : ''}${toggle('compile', '编译期', 'toggle-module', compiled, compileLocked, compileTitle)}</div>`;
}
