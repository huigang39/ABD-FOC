import { childParameterVisible } from './foc-observer/chains.mjs';
import { edit, esc } from '../../features/configuration/view.mjs';
import { CHILD_TYPES, configuredAlgorithmChildren } from './children.mjs';
import { FIXED_ALGORITHM_FUNCTIONS, fixedFunctionPresentation } from './fixed-functions.mjs';
import { icon } from '../../shared/ui/icons.mjs';

const moduleLabels={'foc-observer':'观测器','foc-filter':'滤波器','foc-compensation':'补偿器'};
const moduleIcons={'foc-observer':'eye','foc-filter':'wave','foc-compensation':'settings'};
const relocatedCompensators=new Set(['current_calibration','angle_delay']);
const typeTag=type=>type==='load_torque_motor_speed_notch'?'动态陷波':type==='load_torque_notch'?'旧静态陷波':/pll/.test(type)?'PLL':/low_pass/.test(type)?'低通':/notch/.test(type)?'陷波':null;

function parameterFields(module,child,fields) {
  return `<div class="profile-form">${fields.filter(field=>childParameterVisible(child,field)).map(([key,label,unit,options])=>edit(label,child.parameters[key],'algorithm-child',key,{id:child.id,section:module.id,type:'number',unit,...options,description:''})).join('')}</div>`;
}

/** Fixed functions own their connections; opening the editor never rewrites old data. */
export function renderAlgorithmChildren(project,module,primary='') {
  const list=configuredAlgorithmChildren(project,module.id).filter(child=>module.id!=='foc-compensation'||!relocatedCompensators.has(child.type));
  const label=moduleLabels[module.id]||module.title,types=CHILD_TYPES[module.id]||[];
  const added=new Set(list.map(child=>fixedFunctionPresentation(child).definition?.id).filter(Boolean));
  const offered=module.id==='foc-compensation'?types.filter(type=>!relocatedCompensators.has(type.id)):FIXED_ALGORITHM_FUNCTIONS.filter(type=>type.moduleId===module.id&&!type.retired);
  const remaining=offered.filter(type=>!added.has(type.id)&&!list.some(child=>child.type===type.id));
  const addMenu=remaining.length?`<details class="configuration-more algorithm-add-menu" data-native-menu data-state-key="algorithm-add-${esc(module.id)}"><summary class="button small hardware-add-toggle" title="添加${esc(label)}" aria-label="添加${esc(label)}">${icon('plus')}</summary><div class="configuration-more-body">${remaining.map(type=>`<button class="button ghost" type="button" data-action="add-algorithm-child" data-module="${esc(module.id)}" data-type="${esc(type.id)}">${esc(type.title)}</button>`).join('')}</div></details>`:`<button class="button small hardware-add-toggle" type="button" disabled title="已添加全部${esc(label)}" aria-label="添加${esc(label)}">${icon('plus')}</button>`;
  const cards=list.map(child=>{
    const type=types.find(type=>type.id===child.type);
    if(!type)return '';
    const presentation=fixedFunctionPresentation(child),friction=child.type==='friction';
    const legacy=!presentation.equivalent&&!friction;
    const title=presentation.equivalent?presentation.definition.title:child.name||type.title;
    const fields=friction&&primary?`<div class="profile-form">${primary}</div>`:parameterFields(module,child,presentation.equivalent?presentation.fields:type.fields);
    const tags=`<span class="algorithm-child-tags">${legacy?'<span class="attribute-tag">待替换</span>':''}<span class="attribute-tag">${esc(typeTag(presentation.definition?.id||child.type)||type.title)}</span></span>`;
    const notice=legacy?'<p class="design-note algorithm-legacy-note">旧通用配置待替换，原参数和连接已保留。</p>':'';
    return `<section class="hardware-resource algorithm-child-card" data-algorithm-child="${esc(child.type)}" data-child-id="${esc(child.id)}"><header class="hardware-resource-heading">${icon(moduleIcons[module.id]||'algorithm')}<strong>${esc(title)}</strong><button class="button small ghost algorithm-child-delete" type="button" data-action="remove-algorithm-child" data-module="${esc(module.id)}" data-type="${esc(child.type)}" data-id="${esc(child.id)}" title="移除${esc(title)}" aria-label="移除${esc(title)}">${icon('trash')}</button>${tags}</header><div class="hardware-resource-body">${notice}${fields}</div></section>`;
  }).join('');
  return `<div class="algorithm-children"><div class="design-toolbar algorithm-children-toolbar"><h3>${esc(label)}</h3>${addMenu}</div>${cards||`<p class="design-note algorithm-children-empty">尚未添加${esc(label)}。</p>`}</div>`;
}
