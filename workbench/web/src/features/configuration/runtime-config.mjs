import { CHILD_TYPES, fixedAlgorithmChildren } from '../../modules/algorithm/children.mjs';
import { childParameterVisible } from '../../modules/algorithm/foc-observer/chains.mjs';
import { signalChoices, observerOutputOptions } from '../../modules/algorithm/signals.mjs';
import { edit } from './view.mjs';
import { parameterVisible } from '../../modules/shared/visibility.mjs';
import { SENSOR_ROLES } from '../../modules/hardware/hw-drivers/sensors.mjs';
import { MODULES } from '../../core/catalog.mjs';
import { esc } from '../../shared/esc.mjs';

const supported = new Set(['number','integer','boolean','select','multiselect','text','string']);
/** Stable symbolic keys; configuration defaults, never a claim about live device state. */
export function runtimeConfiguration(project) {
  const entries = [];
  for (const module of MODULES) {
    const instance = project.instances[module.id];
    if (!instance?.enabled) continue;
    if (!module.required && module.runtimeSwitchable) entries.push({
      id: module.id + '.runtimeEnabled', moduleId: module.id, moduleTitle: module.title,
      kind: 'switch', key: 'runtimeEnabled', label: '启用', type: 'boolean',
      value: instance.runtimeEnabled === true, apply: 'module-boundary',
      description: '在模块调度边界切换，仍需满足依赖与状态条件。'
    });
    if(CHILD_TYPES[module.id])for(const child of fixedAlgorithmChildren(project,module.id).filter(c=>c.compiled)){
      const base={moduleId:module.id,moduleTitle:module.title,childId:child.type,childTitle:child.name,apply:'control-boundary'};
      entries.push({...base,id:module.id+'.children.'+child.type+'.enabled',kind:'switch',key:'enabled',label:'启用',type:'boolean',value:child.enabled,slot:'parameter'});
      const type=CHILD_TYPES[module.id].find(t=>t.id===child.type);
      if(child.type!=='friction')for(const field of type.fields.filter(f=>childParameterVisible(child,f))){
        const [key,label,unit,options]=field;
        entries.push({...base,id:module.id+'.children.'+child.type+'.parameters.'+key,kind:'parameter',key,label,unit,type:options?.type||'number',value:child.parameters[key],min:options?.min,max:options?.max,options:options?.choices?.map(([value,label])=>({value,label})),description:options?.description||'',slot:'parameter'});
      }
      for(const [key,value] of Object.entries(child.routing))entries.push({...base,id:module.id+'.children.'+child.type+'.routing.'+key,kind:'parameter',slot:'routing',key,value,type:'select',label:({source:'输入来源',secondary:'辅助来源',method:'处理方式'})[key],options:(key==='method'?[['weighted','加权融合'],['fallback','主来源优先，失效后切换']]:signalChoices(child.type,project)).map(([value,label])=>({value,label}))});
    }
    for (const field of module.params) {
      if (!parameterVisible(project, module.id, field) || field.computed || !supported.has(field.type) || !['runtime','init'].includes(field.phase)) continue;
      if (field.architectureOnly && field.architectureOnly !== project.instances['hw-platform'].parameters.architecture) continue;
      entries.push({
        id: module.id + '.' + field.key, moduleId: module.id, moduleTitle: module.title,
        kind: 'parameter', key: field.key, label: field.label, type: field.type,
        unit: field.unit || '', value: structuredClone(instance.parameters[field.key] ?? field.defaultValue ?? null),
        min: field.min, max: field.max, step: field.step,
        options: module.id==='foc-observer'&&observerOutputOptions(field.key,project)|| (field.options ? structuredClone(field.options) : undefined),
        apply: field.phase === 'init' ? 'reinitialize' : 'control-boundary',
        description: field.description || ''
      });
    }
  }
  return { schemaVersion: 1, kind: 'runtime-configuration', deviceBinding: 'pending', entries };
}
const LAYER_NAMES = { app: '应用层', foc: '算法层', hardware: '硬件层' };
export function renderRuntimeConfiguration(project, renderField) {
  const { entries } = runtimeConfiguration(project);
  const rendered = new Map();
  for (const module of MODULES) {
      const rows = entries.filter(entry => entry.moduleId === module.id);
      if (!rows.length) continue;
      const toggle = rows.find(entry => entry.kind === 'switch'&&!entry.childId);
      const parameters = rows.filter(entry => entry.kind === 'parameter'||entry.childId);
      const switchHtml = toggle ? `<label class="switch-field runtime-config-switch phase-runtime-switch" title="${esc(toggle.description)}"><input type="checkbox" data-action="toggle-runtime" data-module="${esc(module.id)}" aria-label="${esc(module.title)}运行开关" ${toggle.value ? 'checked' : ''}><span class="switch-ui" data-phase-label="运行期" aria-hidden="true"></span></label>` : '';
      const renderParameter = entry => {
        if(entry.childId)return edit(entry.label,entry.value,entry.slot==='routing'?'algorithm-routing':'algorithm-child',entry.key,{id:entry.childId,section:module.id,type:entry.type,unit:entry.unit,choices:entry.options?.map(o=>[o.value,o.label]),phase:'runtime',min:entry.min,max:entry.max,description:entry.description});
        const field = module.params.find(field => field.key === entry.key);
        return renderField({...field, description: [field.description, entry.apply === 'reinitialize' ? '重新初始化后生效。' : '在控制周期边界提交，需通过设备端校验。'].filter(Boolean).join('\n')}, entry.value, 'module', module.id).replace(/(id|for)="module-/g, '$1="runtime-list-module-');
      };
      const groups = new Map();
      const groupNames = {clock:'时钟', memory:'FLASH', timing:'采样与发波时序'};
      for (const entry of parameters) {
        if(entry.childId){const key='chain-'+entry.childId;if(!groups.has(key))groups.set(key,{title:entry.childTitle,childId:entry.childId,entries:[]});groups.get(key).entries.push(entry);continue;}
        const field = module.params.find(field => field.key === entry.key);
        const role = SENSOR_ROLES.find(role => role.id === field.sensorRole);
        const key = role ? 'sensor-' + role.id : field.group || '';
        if (!groups.has(key)) groups.set(key, {title:role?.title || groupNames[key] || field.label, capability:role?.capability, entries:[]});
        groups.get(key).entries.push(entry);
      }
      const content = [...groups].map(([key, group]) => {
        const toggleEntry = group.childId?group.entries.find(entry=>entry.kind==='switch'):group.capability ? group.entries.find(entry => entry.key === group.capability) : null;
        const fields = group.entries.filter(entry => entry !== toggleEntry).map(renderParameter).join('');
        const childSwitch = toggleEntry ? `<label class="switch-field runtime-config-switch phase-runtime-switch" title="${esc(group.title)}"><input type="checkbox" ${group.childId?`data-edit="algorithm-child" data-id="${esc(group.childId)}" data-module="${esc(module.id)}" data-key="enabled"`:`data-scope="module" data-module="${esc(module.id)}" data-key="${esc(toggleEntry.key)}" data-presence="1"`} aria-label="${esc(group.title)}启用" ${(group.childId?toggleEntry.value===true:toggleEntry.value === 'present') ? 'checked' : ''}><span class="switch-ui" data-phase-label="运行期" aria-hidden="true"></span></label>` : '';
        if (!key) return `<div class="profile-form">${fields}</div>`;
        return `<details class="resource-disclosure hardware-resource runtime-config-subgroup" data-state-key="runtime-config-${esc(module.id)}-${esc(key)}"><summary><strong>${esc(group.title)}</strong><span class="attribute-tag">${group.entries.length - (toggleEntry ? 1 : 0)} 项</span>${childSwitch}</summary><div class="hardware-resource-body"><div class="profile-form">${fields}</div></div></details>`;
      }).join('');
      rendered.set(module.id, `<details class="resource-disclosure hardware-resource" data-state-key="runtime-config-${esc(module.id)}"><summary><strong>${esc(module.title)}</strong><span class="attribute-tag">${parameters.length} 项</span>${switchHtml}</summary><div class="hardware-resource-body">${content}</div></details>`);
  }
  // 按层级分组展示：应用层 → 算法层 → 硬件层，各层内按模块排列。
  return '<section class="runtime-configuration"><div class="design-toolbar"><h3>运行时配置</h3><button class="button small" data-action="export-runtime-config">导出配置</button></div>' +
    ['app', 'foc', 'hardware'].map(layer => {
      const blocks = MODULES.filter(module => module.layer === layer).map(module => rendered.get(module.id)).filter(Boolean).join('');
      return blocks ? `<h4 class="runtime-config-layer">${LAYER_NAMES[layer]}</h4>${blocks}` : '';
    }).join('') + '</section>';
}
