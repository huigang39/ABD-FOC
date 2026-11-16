import { childParameterVisible } from './foc-observer/chains.mjs';
import { renderObserverGuide, renderObserverStages, observerStages } from './foc-observer/view.mjs';
import { CHILD_DESIGNS, signalChoices } from './signals.mjs';
import { fieldHelp } from '../../shared/ui/field-help.mjs';
import {edit,esc} from '../../features/configuration/view.mjs';
import {CHILD_TYPES,fixedAlgorithmChildren} from './children.mjs';
export function renderAlgorithmChildren(project,module,primary) {
 const list=fixedAlgorithmChildren(project,module.id);
 const isObserver=module.id==='foc-observer';
 const primaryType=module.id==='foc-compensation'?'friction':null;
 return `${isObserver?renderObserverGuide():''}<div class="algorithm-children">${list.map((child,index)=>{
 const type=CHILD_TYPES[module.id].find(type=>type.id===child.type);
 const design=CHILD_DESIGNS[child.type];
 const routing=(key,label,choices)=>edit(label,child.routing[key],'algorithm-routing',key,{id:child.id,section:module.id,choices,phase:'runtime'});
 const sources=(design.quantity||design.quantities)?signalChoices(child.type,project):[];
 const connections=sources.length===1?`<div class="form-field"><span class="field-label">输入来源</span><output class="computed-field">${esc(sources[0][1])}</output></div>`:sources.length?routing('source',design.defaults.secondary?'主来源':'输入来源',sources):'';
 const fusion=design.defaults.secondary?routing('secondary','辅助来源',signalChoices(child.type,project))+routing('method','处理方式',[['weighted','加权融合'],['fallback','主来源优先，失效后切换']]):'';
 const fieldGroups=new Map();
 for(const field of type.fields.filter(field=>childParameterVisible(child,field))){
  const [key,label,unit,options]=field,group=options?.group||'参数';
  if(!fieldGroups.has(group))fieldGroups.set(group,[]);
  fieldGroups.get(group).push(edit(label,child.parameters[key],'algorithm-child',key,{id:child.id,section:module.id,type:'number',unit,phase:'runtime',...options}));
 }
 const parameterHtml=child.type===primaryType?`<div class="profile-form">${primary}</div>`:[...fieldGroups].map(([group,fields])=>`<section class="observer-parameter-group">${isObserver?`<h4>${esc(group)}</h4>`:''}<div class="profile-form">${fields.join('')}</div></section>`).join('');
 const control=(key,label)=>`<label class="switch-field parameter-phase-switch" data-phase="${key==='compiled'?'compile':'runtime'}"><input type="checkbox" data-edit="algorithm-child" data-module="${module.id}" data-id="${esc(child.id)}" data-key="${key}" aria-label="${esc(child.name)}${label}" ${child[key]?'checked':''}><span class="switch-ui" data-phase-label="${label}" aria-hidden="true"></span></label>`;
 return `<details class="resource-disclosure hardware-resource algorithm-path-card" data-state-key="child-${esc(child.id)}"><summary><span class="module-sequence">${String(index+1).padStart(2,'0')}</span><strong>${esc(child.name)}</strong><span class="attribute-tag">${esc(design.group)}</span><span class="algorithm-path-switches">${child.compiled?control('enabled','运行期'):'<span></span>'}${control('compiled','编译期')}</span></summary>${child.compiled?`<div class="hardware-resource-body">${isObserver?renderObserverStages(observerStages(child.type,child.parameters.extraction||child.routing.method,child)):''}${connections||fusion?`<div class="profile-form">${connections}${fusion}</div>`:''}${parameterHtml}<details class="observer-contract-notes" data-state-key="child-contract-${esc(child.id)}"><summary>链路说明</summary><div class="algorithm-contract"><div><span>输入</span><p>${esc(design.input)}</p></div><div><span>输出</span><p>${esc(design.output)}</p></div><div><span>状态</span><p>${esc(design.state)}</p></div><div><span>作用位置</span><p>${esc(design.use)}${fieldHelp('同一周期先读取有效输入快照，再计算输出；下游只在输出有效时使用。来源失效时不继续使用旧值。融合来源须对齐时间、方向与零位。','数据时序')}</p></div>${design.formula&&(!isObserver||child.parameters.extraction==='pll'||child.type==='load_torque')?`<div class="algorithm-equation">${esc(design.formula)}</div>`:''}</div></details></div>`:''}</details>`;
 }).join('')}</div>${isObserver?`<section class="observer-published-results"><div class="design-toolbar"><h3>发布结果</h3>${fieldHelp('先选择链路结果，再由电流环的电角度源或应用接口选择是否使用；此处不直接使能电机。只使用时间、方向、零位一致且有效的结果。','观测结果')}</div><div class="profile-form">${primary}</div></section>`:''}`;
}
