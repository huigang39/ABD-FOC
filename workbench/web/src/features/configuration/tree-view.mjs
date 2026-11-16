import { esc } from '../../shared/esc.mjs';
import { fieldHelp } from '../../shared/ui/field-help.mjs';

const labels = { configured: '配置检查通过', blocked: '需要处理', todo: '待配置', disabled: '未启用' };
export function configurationStatus(item) {
  const glyph = item.state === 'configured' ? '<path d="m4 8 2.5 2.5L12 5"/>' : item.state === 'blocked' ? '<path d="M8 4.5v4M8 11.5h.01"/>' : item.state === 'disabled' ? '<path d="M5 8h6"/>' : '<path d="M5.5 5.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 1.5-2.5 3M8 11.5h.01"/>';
  return `<span class="configuration-status ${item.state}" title="${esc(item.statusLabel || labels[item.state])}" aria-label="${esc(item.statusLabel || labels[item.state])}"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg></span>`;
}
const ordinal = index => String(index + 1).padStart(2,'0');
export function moduleNumber(step, moduleId) {
  return ordinal(step.modules.indexOf(moduleId));
}
const chevron = '<span class="tree-chevron" aria-hidden="true"></span>';
// 无子项的行也保留同宽的行尾占位，让状态徽标在所有行落在同一竖列。
const chevronBlank = '<span class="tree-chevron tree-chevron-blank" aria-hidden="true"></span>';

export function renderConfigurationTree(guide, activeStep, activeModule = '') {
  const moduleBranch = (item, step) => {
    const active = activeModule === item.id;
    const number = moduleNumber(step,item.id);
    const route = `#/project/${step.id}?module=${encodeURIComponent(item.id)}&tab=config`;
    return `<li class="configuration-tree-item configuration-module-leaf"><a class="configuration-tree-module ${active?'active':''}" href="${route}" data-tree-module="${item.id}" data-state="${item.state}" ${active?'aria-current="page"':''}><span class="tree-module-number">${number}</span><span class="tree-module-title">${esc(item.title)}</span>${configurationStatus(item)}</a>${chevronBlank}</li>`;
  };
  return `<nav class="configuration-tree guide-steps" aria-label="配置步骤" data-live="guide-steps"><div class="configuration-tree-heading"><strong>配置目录</strong>${fieldHelp('参数与依赖检查通过后自动打勾。修改配置会重新检查；对勾仅表示配置完整，设备时序与性能仍需实测。','完成状态')}</div><ul>${guide.steps.map((step,index) => {
    const active = step.id === activeStep, children = step.children || [], included = children.filter(child => child.state !== 'disabled');
    const progress = children.length ? `${included.filter(child=>child.state==='configured').length}/${included.length}` : '';
    const link = `<a class="guide-step ${active ? 'active' : ''} ${step.state}" href="#/project/${step.id}" data-tree-step="${step.id}" ${active ? 'aria-current="step"' : ''}><span class="step-index">${String(index+1).padStart(2,'0')}</span><span class="step-copy"><strong>${esc(step.title)}</strong></span>${progress ? `<span class="tree-progress" aria-label="${included.filter(child=>child.state==='configured').length} 个模块配置检查通过，共 ${included.length} 个">${progress}</span>` : ''}${configurationStatus(step)}</a>`;
    if (!children.length) return `<li class="configuration-tree-item">${link}${chevronBlank}</li>`;
    const branch = children.map(child=>moduleBranch(child,step)).join('');
    return `<li class="configuration-tree-item"><details data-tree-branch data-state-key="tree-${step.id}" ${active?'open':''}><summary>${link}${chevron}</summary><ul class="configuration-tree-children">${branch}</ul></details></li>`;
  }).join('')}</ul></nav>`;
}
