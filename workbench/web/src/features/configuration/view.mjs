import { renderObserverData } from '../../modules/algorithm/foc-observer/view.mjs';
import { fixedAlgorithmChildren } from '../../modules/algorithm/children.mjs';
import { phaseTag } from '../../shared/ui/phase-tag.mjs';
import { numericInputAttributes } from '../../shared/forms/numeric-input.mjs';
import { fieldHelp } from '../../shared/ui/field-help.mjs';
import { renderConfigurationTree, configurationStatus, moduleNumber } from './tree-view.mjs';
import { renderModuleToggles } from '../../shared/ui/module-tags.mjs';
import { getModuleContractRole, validateModuleContracts } from '../../core/module-contracts.mjs';
import { issueNoticeButton } from '../../shared/ui/issue-notices.mjs';
import { MODULES, TARGET_FIELDS } from '../../core/model.mjs';
import { hardwareMatchesDriver } from '../equipment/model.mjs';
import { getConfigurationSelection } from './workspace.mjs';
import { neo75hModelName } from '../equipment/product-model.mjs';
import { getGuide } from './guide.mjs';
import { getStructureSize } from '../../core/contracts.mjs';
import { modelSelect, optionGroupFor } from '../../shared/forms/model-options.mjs';
import { selectOptions, isEmptyChoice, isBinaryChoice, binaryChoice } from '../../shared/forms/select-control.mjs';

import { esc } from '../../shared/esc.mjs';
import { breadcrumbs, pageHeading } from '../../shared/ui/page-heading.mjs';
export { esc } from '../../shared/esc.mjs';
export const rid = value => encodeURIComponent(String(value ?? ''));
const moduleName = id => MODULES.find(m => m.id === id)?.title || id;
export function edit(label, value, scope, key, config = {}) {
  let {id='', child='', section='', type='text', choices, area=false, description='', unit=''} = config;
  const suffix=/（(Hz|kHz|MHz|bit\/s|bit|V|A|ms|μs|us|ns|KiB|MiB|rad|rad\/s|N·m|Ohm|H)）$/.exec(label);
  if(suffix&&!unit){unit=suffix[1];label=label.slice(0,suffix.index);}
  const attrs = `data-edit="${scope}" data-key="${key}" data-id="${esc(id)}" data-child="${esc(child)}" data-section="${section}" data-value-type="${type}" ${config.scale?`data-value-scale="${config.scale}"`:''} ${config.min!==undefined?`min="${config.min}"`:''} ${config.max!==undefined?`max="${config.max}"`:''} aria-label="${esc(label)}"`;
  const choiceGroup=optionGroupFor(scope,key);
  const control = choiceGroup ? modelSelect(choiceGroup,value,attrs) : choices ? (isBinaryChoice(choices)?binaryChoice(choices,value,attrs,{name:[scope,id,child,key].join('-'),label}):`<select class="field-select compact-input" ${attrs} data-empty="${isEmptyChoice(value)}">${selectOptions(choices,value)}</select>`)
    : type==='boolean' ? `<label class="checkbox-field switch-field parameter-phase-switch" data-phase="${config.phase === 'runtime' || config.phase === 'init' ? 'runtime' : 'compile'}" title="${config.phase === 'runtime' || config.phase === 'init' ? '运行期参数' : '编译期：构建固件时生效'}"><input type="checkbox" ${attrs} ${value ? 'checked' : ''}><span class="switch-label">${esc(label)}</span><span class="switch-ui" data-phase-label="${config.phase === 'runtime' || config.phase === 'init' ? '运行期' : '编译期'}" aria-hidden="true"></span></label>`
    : area ? `<textarea class="field-input" rows="3" maxlength="1200" ${attrs}>${esc(value)}</textarea>`
    : `<div class="field-input-wrap"><input class="field-input compact-input" ${type==='number'||type==='integer' ? numericInputAttributes(value,{radix:config.radix}) : `type="text" value="${esc(value)}"`} ${attrs} ${type==='integer' ? 'step="1"' : type==='number' ? 'step="any"' : 'maxlength="160"'} placeholder="—">${unit ? `<span class="field-unit">${esc(unit)}</span>` : ''}</div>`;
  return `<div class="form-field design-field">${type!=='boolean' ? `<span class="field-label">${esc(label)}${fieldHelp(description,label)}${phaseTag(config.phase)}</span>` : ''}${control}${type==='boolean'?fieldHelp(description,label):''}</div>`;
}
const moduleOptions = () => [['', '待选择'], ...MODULES.map(m => [m.id, m.title])];
const btn = (label, action, attrs='', kind='') => `<button class="button ${kind}" data-action="${action}" ${attrs}>${label}</button>`;
const title = (name, description) => pageHeading({ title: name, description });
const states = {todo:'待配置',blocked:'存在冲突',configured:'配置完整'};
const layerNames={app:'应用层',foc:'算法层',hardware:'硬件层'};
const layerStep={app:'application',foc:'algorithm',hardware:'hardware'};
function moduleBreadcrumb(module) { return breadcrumbs([{ href: `#/project/${layerStep[module.layer]}`, label: layerNames[module.layer] }, { label: module.title }]); }
function renderConfigurationToolbar(project, ctx) {
  const variant = ['KW', 'LD', 'SMH', 'XH'].includes(ctx.profileVariant) ? ctx.profileVariant : 'KW';
  return `<section class="configuration-toolbar" aria-label="配置文件"><label class="form-field configuration-name"><span class="field-label">配置名称</span><input class="field-input" data-scope="project" data-key="name" value="${esc(project.name)}" maxlength="80"><span class="configuration-save-status" data-live="configuration-save-status">${esc(ctx.saveStatus || '')}</span></label><div class="configuration-file-actions">${btn('导入配置', 'import', '', 'primary')}${btn('保存配置', 'save')}<details class="configuration-more" data-native-menu data-state-key="configuration-more"><summary class="button">更多</summary><div class="configuration-more-body"><div class="configuration-secondary-actions">${btn('导出配置', 'export')}${btn('新建空白配置', 'new-configuration')}</div><div class="configuration-preset"><strong>预置配置</strong><label class="form-field"><span class="field-label">NEO 75 · 力矩传感器</span><select class="field-select" id="neo75h-variant" data-native-field="profileVariant">${selectOptions(['KW','LD','SMH','XH'].map(value => [value, `${neo75hModelName(value)}${value === 'XH' ? ' · 待适配' : ''}`]), variant)}</select></label>${btn('使用预置配置', 'new-neo75h', ctx.configurationLocked ? 'disabled' : '')}</div></div></details></div></section>`;
}
const metricValue = (value, unit = '') => typeof value === 'number' && Number.isFinite(value) ? `${esc(value)}${unit ? ` ${unit}` : ''}` : '—';
function selectionControl(label, scope, items, selectedId) {
  return `<label class="form-field"><span class="field-label">${esc(label)}</span><select class="field-select" data-edit="${scope}" aria-label="${esc(label)}" data-empty="${isEmptyChoice(selectedId)}">${selectOptions(items.map(item => [item.id, item.name]), selectedId)}</select></label>`;
}
function renderActuatorSelection(project, selection) {
  const actuator = selection.actuator;
  return `<section class="configuration-selection"><div class="design-toolbar"><h3>从货架选择执行器</h3><a class="button small navigation-action" href="#/equipment/actuators">管理执行器 →</a></div>${selectionControl('执行器', 'configuration-actuator', project.catalog.actuators, actuator?.id || '')}<p class="design-note">执行器包含电机与减速机，驱动器在下一步选择。</p>${actuator ? `<div class="configuration-selected-asset asset-actuator"><div class="design-toolbar"><strong>${esc(actuator.name)}</strong><a class="button small navigation-action" href="#/equipment/actuators/${rid(actuator.id)}">查看与编辑参数 →</a></div><dl class="configuration-metrics">${[['转子极对数', actuator.motor.polePairs, ''], ['减速比', actuator.reducer.ratio, ''], ['额定电流', actuator.motor.ratedCurrentA, 'A'], ['峰值电流', actuator.motor.maxCurrentA, 'A'], ['额定力矩', actuator.reducer.ratedOutputTorqueNm, 'N·m'], ['峰值力矩', actuator.reducer.maxOutputTorqueNm, 'N·m']].map(([label, value, unit]) => `<div><dt>${label}</dt><dd>${metricValue(value, unit)}</dd></div>`).join('')}</dl></div>` : `<div class="configuration-empty"><p>${project.catalog.actuators.length ? '选择执行器后，可继续配置驱动硬件。' : '货架中还没有执行器。先添加电机与减速机参数，再返回选型。'}</p><a class="button small" href="#/equipment/actuators">前往执行器货架 →</a></div>`}</section>`;
}
function renderHardwareSelection(project, selection) {
  const driver = selection.driver, matches = driver && hardwareMatchesDriver(project, driver);
  return `<section class="configuration-selection"><div class="design-toolbar"><h3>选择硬件来源</h3><a class="button small navigation-action" href="#/equipment/drivers">管理驱动器 →</a></div><div class="configuration-hardware-source">${selectionControl('复用货架驱动器', 'configuration-driver', project.catalog.drivers, driver?.id || '')}${btn('自行配置硬件', 'configure-custom-hardware', `aria-pressed="${selection.hardwareMode === 'custom'}"`, selection.hardwareMode === 'custom' ? 'selected' : '')}</div><div class="configuration-selected-asset asset-driver"><div class="design-toolbar"><strong>${driver ? `${esc(driver.name)} · ${matches ? '硬件配置已复用' : '当前配置已调整'}` : '自行配置硬件'}</strong>${driver ? `<a class="button small navigation-action" href="#/equipment/drivers/${rid(driver.id)}">查看驱动器 →</a>` : ''}</div><p class="design-note">${esc(project.target.mcu || 'MCU 待选择')} · ${esc(project.target.board || '板卡待选择')}${driver ? ` · ${project.instances['hw-board'].parameters.resources?.length||0} 项外设资源` : ''}</p><p class="design-note">${driver ? '下方已带入驱动器的硬件配置，可核对或调整。' : '在下方选择 MCU，并配置板卡、外设、引脚与内存。已有硬件参数保留作为起点。'}</p>${driver && !matches ? btn('保存到货架驱动器', 'capture-driver', `data-id="${esc(driver.id)}"`, 'small') : !driver ? btn('保存为货架驱动器', 'new-driver-from-project', '', 'small') : ''}</div></section>`;
}
export function renderModuleData(project,module) {
  const contracts=project.design.moduleContracts?.[module.id]||{};
  const contractIssues=validateModuleContracts(project).filter(issue=>issue.moduleId===module.id);
  const shared=project.design.structures.filter(s=>!structureBinding(project,s.id));
  const owned=shared.filter(s=>s.owner===module.id);
  const used=shared.filter(s=>s.owner!==module.id&&s.consumers.includes(module.id));
  const candidates=shared.filter(s=>s.owner!==module.id&&!s.consumers.includes(module.id));
  const links=(list,empty)=>list.length?list.map(s=>`<a class="module-data-item" href="#/project/structures/${rid(s.id)}?module=${rid(module.id)}"><div class="shared-structure-heading"><strong>${esc(s.name||'未命名结构')}</strong><span class="shared-structure-arrow" aria-hidden="true">→</span></div><div class="shared-structure-meta"><span class="attribute-tag">${s.fields.length} 个字段</span><span>${esc(moduleName(s.owner))}</span></div>${s.description ? `<small>${esc(s.description)}</small>` : ''}</a>`).join(''):`<p class="design-note">${empty}</p>`;
  const hasEmpty=Object.values(contracts).some(id=>!project.design.structures.find(s=>s.id===id)?.fields.length);
  return `${module.id==='foc-observer'?renderObserverData(fixedAlgorithmChildren(project,module.id)):''}${hasEmpty?`<div class="design-toolbar">${btn('载入模块字段','load-module-contracts',`data-module="${esc(module.id)}"`,'small')}</div>`:''}<div class="module-contracts">${Object.entries(contractRoles).map(([role,meta])=>{
    const structure=project.design.structures.find(s=>s.id===contracts[role]);
    const interfaces=(project.design.layerInterfaces||[]).filter(item=>role==='input'?item.toModule===module.id:role==='output'?item.fromModule===module.id:false);
    return `<section class="module-data-section module-contract-card" data-contract-role="${role}"><div class="design-toolbar"><h3>${meta.label}</h3>${structure?`<a class="button small" href="#/project/structures/${rid(structure.id)}?module=${rid(module.id)}">编辑字段 →</a>`:''}</div><p class="design-note">${meta.description}</p>${structure?`<div class="module-contract-heading"><strong>${esc(structure.name||'未命名结构')}</strong><span class="muted">${structure.fields.length} 个字段</span></div>${structure.description?`<p class="design-note">${esc(structure.description)}</p>`:''}${structure.fields.length?`<ul class="contract-field-preview">${structure.fields.slice(0,4).map(field=>`<li><code>${esc(field.name||'未命名字段')}</code><span class="contract-field-meta">${field.unit?`<span class="contract-data-unit" aria-label="单位">${esc(field.unit)}</span>`:'<span class="contract-unit-empty" aria-hidden="true"></span>'}<span class="contract-data-type" aria-label="数据类型">${esc(field.type)}${field.count!==1?`[${esc(field.count)}]`:''}</span></span></li>`).join('')}</ul>${structure.fields.length>4?`<p class="design-note">另有 ${structure.fields.length-4} 个字段</p>`:''}`:'<p class="design-note">尚未添加字段。</p>'}`:issueNoticeButton(contractIssues.filter(issue=>issue.id.startsWith(`contract-${module.id}-${role}-`)),{label:'查看结构检查'})}${interfaces.length?`<div class="dependency-links">${interfaces.map(item=>`<a class="button small navigation-action" href="#/project/${layerStep[module.layer]}?module=${rid(module.id)}&tab=interfaces&interface=${rid(item.id)}">${esc(item.name||'未命名接口')} →</a>`).join('')}</div>`:''}</section>`;
  }).join('')}</div><details class="panel module-shared-structures" data-state-key="shared-structures-${esc(module.id)}"><summary>其他共享结构与引用</summary><div class="shared-structures-body"><section class="shared-structure-group"><div class="design-toolbar"><h3>本模块定义</h3>${btn('新建共享结构','add-structure',`data-module="${esc(module.id)}"`,'small')}</div><div class="shared-structure-list">${links(owned,'没有其他共享结构。')}</div></section><section class="shared-structure-group"><h3>引用其他模块</h3><div class="shared-structure-list">${links(used,'尚未引用其他共享结构。')}</div><div class="shared-structure-add">${edit('引用已有共享结构','','structure-input','structureId',{id:module.id,choices:[['','选择共享结构'],...candidates.map(s=>[s.id,`${s.name} · ${moduleName(s.owner)}`])]})}</div></section></div></details>`;
}
const contractRoles={input:{label:'输入',description:'本模块接收的数据，由接口映射写入。'},output:{label:'输出',description:'本模块发布的数据，可作为其他模块的输入来源。'},state:{label:'状态',description:'本模块内部状态，不用于跨层接口。'}};
function structureBinding(project,id) { return getModuleContractRole(project,id); }

const health = (issues,page,id='') => `<div class="design-health" data-live="design-health">${issueNoticeButton(issues.filter(i=>i.designPage===page&&(!id||!i.itemId||i.itemId===id)))}</div>`;

export function guideStrip(project, issues) {
  const guide = getGuide(project, issues);
  const next = guide.steps.find(step => step.id === guide.nextStepId) || guide.steps.at(-1);
  return `<div class="start-strip"><div><strong>${guide.configuredCount ? '继续配置' : '从这里开始'}</strong><span>${esc(next.title)}</span></div><a class="button primary" href="#/project/${next.id}">${guide.configuredCount ? '继续' : '开始配置'} →</a></div>`;
}
export function renderGuide(project, issues, stepId, ctx = {}) {
  const selection = ctx.selection || getConfigurationSelection(project);
  const guide = getGuide(project, issues, { ...ctx, selection });
  const step = guide.steps.find(item => item.id === stepId) || guide.steps.find(item => item.id === guide.nextStepId) || guide.steps.at(-1);
  const index = guide.steps.indexOf(step);
  const stateLabel = item => item.statusLabel || states[item.state];
  const selectedModule = step.modules.includes(ctx.selectedModuleId) ? ctx.selectedModuleId : '';
  const shownModules = selectedModule ? [selectedModule] : step.modules;
  let content = '';
  if (step.id === 'actuator') content = `${renderActuatorSelection(project, selection)}${issueNoticeButton(step.issues.filter(issue => issue.level === 'error'), { label: '查看选型检查' })}`;
  else if (step.id === 'build') content = ctx.buildHtml ?? '<section class="panel"><p class="design-note">完成依赖检查后，可在此设置编译选项并构建固件。</p></section>';
  else if (step.id === 'flash') content = ctx.flashHtml ?? '<section class="panel"><p class="design-note">完成构建后，可在此选择探针并烧录当前固件。</p></section>';
  else {
    content = `${step.id === 'hardware' && !selectedModule ? renderHardwareSelection(project, selection) : ''}${shownModules.map((id, i) => {
      const module = MODULES.find(item => item.id === id);
      if (!module) return '';
      const moduleRoute = (tab = 'config') => ctx.moduleRoute ? ctx.moduleRoute(id, tab) : `#/project/${layerStep[module.layer]}?module=${rid(id)}&tab=${tab}`;
      if (!module.required && !project.instances[id].enabled) {
        return `<details class="guide-module panel module-excluded" data-guide-module="${id}" data-state-key="configuration-module-${id}"><summary><strong><span class="module-sequence">${moduleNumber(step,id)}</span><span data-live="module-status-${id}">${configurationStatus(step.children.find(child=>child.id===id))}</span>${esc(module.title)}${fieldHelp(module.role,module.title)}</strong>${renderModuleToggles(module,project.instances[id]).replace(/^<div/,'<span').replace(/<\/div>$/,'</span>')}<span class="guide-module-count" aria-hidden="true"></span></summary></details>`;
      }
      const selected = ctx.selectedModuleId === id;
      const showData = selected && ctx.tab === 'data';
      const showInterfaces = selected && ctx.tab === 'interfaces';
      const opened = ctx.selectedModuleId ? selected : i === 0 && step.id !== 'hardware';
      const body = showData ? renderModuleData(project, module) : showInterfaces ? (ctx.interfaces?.(module) || '') : `<div class="profile-form">${ctx.parameters?.(module) || ''}</div>${ctx.moduleExtras?.(module) || ''}`;
      // Phrasing content keeps the native label/checkbox activation separate from
      // summary activation. Mouse and Space toggle the input without collapsing it.
      const toggles = renderModuleToggles(module, project.instances[id]).replace(/^<div/, '<span').replace(/<\/div>$/, '</span>');
      return `<details class="guide-module panel" data-guide-module="${id}" data-state-key="configuration-module-${id}" ${opened ? 'open' : ''}><summary><strong><span class="module-sequence">${moduleNumber(step,id)}</span><span data-live="module-status-${id}">${configurationStatus(step.children.find(child=>child.id===id))}</span>${esc(module.title)}${fieldHelp(module.role,module.title)}</strong><span class="guide-module-count">${module.params.filter(field => !field.hidden && !field.computed).length + (id === 'hw-platform' ? TARGET_FIELDS.length : 0)} 项参数</span>${toggles}</summary><nav class="configuration-module-tabs" aria-label="${esc(module.title)}配置"><a href="${moduleRoute('config')}" ${!showData&&!showInterfaces ? 'aria-current="page"' : ''}>配置</a><a href="${moduleRoute('data')}" ${showData ? 'aria-current="page"' : ''}>数据</a><a href="${moduleRoute('interfaces')}" ${showInterfaces ? 'aria-current="page"' : ''}>接口</a></nav>${body}</details>`;
    }).join('')}`;
  }
  const guideActions = ['hardware','algorithm','application'].includes(step.id) ? `<div class="guide-summary-actions" data-live="guide-issues">${issueNoticeButton(selectedModule ? step.children.find(child=>child.id===selectedModule).issues : step.issues, { label: '查看检查结果', showEmpty: true })}</div>` : '';
  const moduleIndex = step.modules.indexOf(selectedModule);
  const moduleLink = id => `#/project/${step.id}?module=${rid(id)}&tab=config`;
  const previous = selectedModule ? { href: moduleIndex > 0 ? moduleLink(step.modules[moduleIndex-1]) : `#/project/${step.id}`, label: moduleIndex > 0 ? '上一个模块' : '返回概览' } : index ? { href: `#/project/${guide.steps[index-1].id}`, label: '上一步' } : null;
  const next = selectedModule && moduleIndex < step.modules.length-1 ? { href: moduleLink(step.modules[moduleIndex+1]), label: '下一个模块' } : index < guide.steps.length-1 ? { href: `#/project/${guide.steps[index+1].id}`, label: '下一步' } : null;
  return `<div class="configuration-workflow">${title('工程', '从执行器选型开始，逐步配置硬件、算法与应用，检查后构建固件。')}${renderConfigurationToolbar(project, ctx)}<div class="guide-layout">${renderConfigurationTree(guide,step.id,ctx.selectedModuleId,ctx.tab)}<section class="guide-content"><div class="guide-summary" data-live="guide-summary"><div class="guide-summary-copy"><span class="eyebrow">步骤 ${index + 1} / ${guide.steps.length}</span><h2>${esc(step.title)}</h2><p>${esc(step.summary)}</p></div>${guideActions}</div>${content}<div class="guide-next">${previous ? `<a class="button" href="${previous.href}">← ${previous.label}</a>` : '<span></span>'}${next ? `<a class="button primary" href="${next.href}">${next.label} →</a>` : '<span></span>'}</div></section></div></div>`;
}
export function renderStructures(project,issues,id,moduleId='') {
  moduleId ||= structureBinding(project,id)?.moduleId || project.design.structures.find(s=>s.id===id)?.owner || '';
  const module=MODULES.find(m=>m.id===moduleId);
  const query=module?`?module=${rid(module.id)}`:'';
  const list=project.design.structures.filter(s=>!module||structureBinding(project,s.id)?.moduleId===module.id||s.owner===module.id||s.consumers.includes(module.id)), selected=list.find(s=>s.id===id)||list[0];
  return `${module?moduleBreadcrumb(module):''}${title(module?`${module.title} · 数据结构`:'数据结构','分别定义模块输入、输出与状态。')}<div class="design-layout"><aside class="design-list"><div class="design-toolbar">${btn('新建共享结构','add-structure',`data-module="${esc(module?.id||'')}"`)}</div><div data-live="structure-list">${list.map(s=>{const binding=structureBinding(project,s.id);return `<a class="design-item ${s===selected?'active':''}" href="#/project/structures/${rid(s.id)}${query}"><strong>${esc(s.name||'未命名结构')}</strong><small>${binding?`${contractRoles[binding.role].label} · `:''}${esc(moduleName(binding?.moduleId||s.owner))} · ${s.fields.length} 个字段</small></a>`;}).join('')}</div></aside><section class="design-editor">${selected?structureEditor(selected,project,issues):'<div class="empty-state">还没有数据结构。</div>'}</section></div>`;
}
function structureEditor(s,project,issues) {
  const meta={id:s.id};
  const binding=structureBinding(project,s.id);
  const interfaces=(project.design.layerInterfaces||[]).filter(item=>item.sourceStructure===s.id||item.targetStructure===s.id);
  return `<div class="design-toolbar"><h2 data-live="structure-title">${esc(s.name||'未命名结构')}</h2>${binding?`<span class="status-pill neutral">${contractRoles[binding.role].label}</span>`:btn('移除结构','remove-structure',`data-id="${esc(s.id)}"`)}${btn('撤销','undo')}</div><div class="design-meta">${edit('结构名称',s.name,'structure','name',meta)}${binding?`<div class="form-field"><span class="field-label">所属模块</span><output class="computed-field"><strong>${esc(moduleName(binding.moduleId))}</strong><span>${contractRoles[binding.role].label} · 固定归属</span></output></div>`:edit('数据所有者',s.owner,'structure','owner',{...meta,choices:moduleOptions()})}${edit('更新时序',s.rate,'structure','rate',{...meta,choices:[['fast','电流环控制周期'],['control','应用控制任务'],['event','事件触发']]})}${edit('用途',s.description,'structure','description',{...meta,area:true})}</div>
    ${binding?`<div class="module-contract-links"><p class="design-note">${binding.role==='state'?'状态结构仅由所属模块使用。':'模块输入与输出的连接在本模块的接口页定义。'}</p>${interfaces.length?`<div class="dependency-links">${interfaces.map(item=>`<a class="button small navigation-action" href="#/project/${layerStep[MODULES.find(m=>m.id===binding.moduleId)?.layer]}?module=${rid(binding.moduleId)}&tab=interfaces&interface=${rid(item.id)}">${esc(item.name||'未命名接口')} →</a>`).join('')}</div>`:''}</div>`:`<details class="panel" data-state-key="structure-consumers-${esc(s.id)}"><summary>使用此结构的模块</summary><div class="module-chips">${MODULES.map(m=>`<label class="choice"><input type="checkbox" data-edit="consumer" data-id="${esc(s.id)}" data-key="${m.id}" ${s.consumers.includes(m.id)?'checked':''}>${esc(m.title)}</label>`).join('')}</div></details>`}
    ${health(issues,'structures',s.id)}<div class="design-toolbar"><h3>字段定义</h3>${btn('添加字段','add-field',`data-id="${esc(s.id)}"`)}</div><div class="contract-table-wrap"><table class="contract-table fields-table"><thead><tr><th>字段名</th><th>类型</th><th>数量</th><th>单位</th><th>含义 / 来源</th><th></th></tr></thead><tbody>${s.fields.map(f=>`<tr>${[['name','字段名'],['type','类型'],['count','数量'],['unit','单位'],['meaning','含义 / 来源']].map(([key,label])=>`<td>${edit(label,f[key],'field',key,{id:s.id,child:f.id,type:key==='count'?'integer':'text',...(key==='type'?{choices:['u8','i8','u16','u32','i16','i32','f32','bool']}: {})})}</td>`).join('')}<td>${btn('移除','remove-field',`data-id="${esc(s.id)}" data-child="${esc(f.id)}"`,'small quiet')}</td></tr>`).join('')}</tbody></table></div><p class="design-note" data-live="structure-size">紧凑编码载荷：${getStructureSize(s)??'待确认'} 字节。字段顺序用于载荷设计；C 结构体对齐与通信编码分别定义。</p><div class="design-note" data-live="structure-refs">${project.design.protocol.messages.filter(m=>m.payload===s.id).length} 条通信消息引用此结构。</div>`;
}

export function renderFaults(project,issues,id) {
  const list=project.design.faults, f=list.find(x=>x.id===id)||list[0];
  return `${moduleBreadcrumb(MODULES.find(m=>m.id==='app-safety'))}${title('错误码','在应用层统一故障来源、严重程度、动作和恢复条件。')}<div class="design-layout"><aside class="design-list"><div class="design-toolbar">${btn('新增错误码','add-fault')}</div><div data-live="fault-list">${list.map(x=>`<a class="design-item ${x===f?'active':''}" href="#/project/faults/${rid(x.id)}"><strong>${esc(x.name||'未命名错误')}</strong><small>0x${Number(x.code).toString(16).toUpperCase().padStart(4,'0')} · ${esc(moduleName(x.source))}</small></a>`).join('')}</div></aside><section class="design-editor">${f?`<div class="design-toolbar"><h2 data-live="fault-title">${esc(f.name)}</h2>${btn('移除','remove-fault',`data-id="${esc(f.id)}"`)}${btn('撤销','undo')}</div><div class="design-meta">${edit('名称',f.name,'fault','name',{id:f.id})}${edit('错误码',f.code,'fault','code',{id:f.id,type:'integer',radix:16,min:0,description:'默认以十六进制显示；支持 0x 十六进制、0b 二进制、0o 八进制，无前缀按十进制解析。'})}${edit('来源模块',f.source,'fault','source',{id:f.id,choices:moduleOptions()})}${edit('严重程度',f.severity,'fault','severity',{id:f.id,choices:[['info','信息'],['warning','警告'],['error','故障'],['critical','紧急故障']]})}${edit('处理动作',f.action,'fault','action',{id:f.id,choices:[['report','记录 / 上报'],['derate','降额'],['stop','停止输出'],['trip','立即关断']]})}${edit('恢复方式',f.recovery,'fault','recovery',{id:f.id,choices:[['automatic','条件恢复后自动解除'],['command','条件恢复后命令复位'],['power_cycle','重新上电']]})}${edit('锁存故障',f.latched,'fault','latched',{id:f.id,type:'boolean'})}${edit('触发条件与处理说明',f.description,'fault','description',{id:f.id,area:true})}</div>${health(issues,'faults',f.id)}<p class="design-note">错误码用于诊断记录与通信上报。硬件关断路径独立生效，不能由通信应答代替。</p>`:'<div class="empty-state">还没有错误码。</div>'}</section></div>`;
}

export function renderProtocol(project,issues,id) {
  const p=project.design.protocol, m=p.messages.find(x=>x.id===id)||p.messages[0];
  const stateIds=new Set(project.design.structures.filter(s=>getModuleContractRole(project,s.id)?.role==='state').map(s=>s.id));
  const payloadChoices=[['','待选择'],...project.design.structures.filter(s=>!stateIds.has(s.id)).map(s=>[s.id,s.name])];
  if(m&&stateIds.has(m.payload))payloadChoices.push([m.payload,`${project.design.structures.find(s=>s.id===m.payload)?.name||m.payload} · 无效：状态不能作为通信载荷`,true]);
  return `${moduleBreadcrumb(MODULES.find(m=>m.id==='app-comms'))}${title('通信协议与解析','在应用通信模块定义传输约定、消息编号与载荷解析结构。')}<div class="protocol-flow"><span>接收字节 / 总线帧</span><b>→</b><span>校验与消息识别</span><b>→</b><span>按载荷结构解析</span><b>→</b><span>应用命令仲裁</span></div><section class="panel"><h2>连接与编码</h2><div class="design-meta">${edit('传输方式',p.transport,'protocol','transport',{choices:[['unselected','待选择'],['can','CAN'],['canfd','CAN FD'],['uart','RS485'],['ethercat','EtherCAT'],['ethernet','Ethernet']]})}${edit('协议版本',p.version,'protocol','version',{type:'integer'})}${edit('节点 ID',p.nodeId,'protocol','nodeId',{type:'integer'})}${edit('总线速率 / 波特率',p.bitrate,'protocol','bitrate',{type:'integer',unit:'bit/s'})}${edit('字节序',p.byteOrder,'protocol','byteOrder',{choices:[['little','小端'],['big','大端']]})}${edit('完整性校验',p.integrity,'protocol','integrity',{choices:[['unselected','待选择'],['transport_crc','使用传输层校验'],['crc16_ccitt','CRC-16/CCITT']]})}${edit('命令超时',p.timeoutMs,'protocol','timeoutMs',{type:'number',unit:'ms'})}</div><p class="design-note">应用消息编号与总线帧 ID 分别定义。分片、帧头、CRC 参数和驱动适配在协议实现时落实。</p></section>
    ${health(issues,'protocol')}<div class="design-layout"><aside class="design-list"><div class="design-toolbar">${btn('新增消息','add-message')}</div><div data-live="message-list">${p.messages.map(x=>`<a class="design-item ${x===m?'active':''}" href="#/project/protocol/${rid(x.id)}"><strong>${esc(x.name||'未命名消息')}</strong><small>0x${Number(x.opcode).toString(16).toUpperCase()} · ${{command:'命令',telemetry:'遥测',response:'响应'}[x.direction]}</small></a>`).join('')}</div></aside><section class="design-editor">${m?`<div class="design-toolbar"><h2 data-live="message-title">${esc(m.name)}</h2>${btn('移除','remove-message',`data-id="${esc(m.id)}"`)}${btn('撤销','undo')}</div><div class="design-meta">${edit('消息名称',m.name,'message','name',{id:m.id})}${edit('消息编号（十进制）',m.opcode,'message','opcode',{id:m.id,type:'integer'})}${edit('方向',m.direction,'message','direction',{id:m.id,choices:[['command','主机 → 设备 · 命令'],['telemetry','设备 → 主机 · 遥测'],['response','设备 → 主机 · 响应']]})}${edit('载荷结构',m.payload,'message','payload',{id:m.id,choices:payloadChoices})}${edit('发送周期',m.periodMs,'message','periodMs',{id:m.id,type:'number',unit:'ms',description:'留空为事件触发。'})}${edit('需要应答',m.ack,'message','ack',{id:m.id,type:'boolean'})}${edit('消息说明',m.description,'message','description',{id:m.id,area:true})}</div><div data-live="message-payload">${m.payload?`<a class="button small navigation-action" href="#/project/structures/${rid(m.payload)}">查看载荷字段 →</a>`:''}</div>`:'<div class="empty-state">还没有通信消息。</div>'}</section></div>`;
}
