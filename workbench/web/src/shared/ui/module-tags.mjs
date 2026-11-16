import { esc } from '../esc.mjs';

/** Membership is selected through adding/removing features, without phase controls. */
export function renderModuleTags(instance, module) {
  if (module?.required) return '';
  return instance?.enabled === true ? '<span class="module-tag">已添加</span>' : '';
}

/** Optional modules are included by adding them; required modules cannot be removed. */
export function renderModuleToggles(module, instance) {
  if (!module?.id) return '';
  if (module.required) return '';
  const added = instance?.enabled === true;
  return `<div class="module-toggles" role="group" aria-label="${esc(module.title || module.id)}的模块配置"><button class="button small" type="button" data-action="${added ? 'remove-module' : 'add-module'}" data-module="${esc(module.id)}" aria-label="${added ? '移除' : '添加'}${esc(module.title || module.id)}">${added ? '移除' : '添加'}</button></div>`;
}
