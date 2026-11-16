import { highlightC } from '../../shared/ui/code-highlight.mjs';
import { edit, esc } from './view.mjs';
import { taskFrequency, userScheduleTasks } from './schedule.mjs';
import { ENTRYPOINTS } from '../../modules/entrypoints.mjs';
import { icon } from '../../shared/ui/icons.mjs';
const display=value=>Number.isFinite(value)&&value>0?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}).format(value):'—';

export function renderSchedule(project) {
  const icons={control:'wave',communication:'link',calibration:'target',diagnostics:'shield'};
  return `<section class="schedule-editor" id="task-schedule">${userScheduleTasks(project).map(row=>{
    let periodField=edit('调度周期',row.periodUs,'schedule-task','periodUs',{id:row.roleId,type:'integer',min:1,max:2147483647,unit:'μs'});
    if(row.readonly||row.reason)periodField=periodField.replace('<input ','<input '+(row.readonly?'disabled aria-disabled="true" ':'')+'title="'+esc(row.reason||'此任务周期暂不可独立编辑。')+'" ');
    return `<section class="schedule-task hardware-resource" data-task-id="${esc(row.roleId)}"><header class="hardware-resource-heading">${icon(icons[row.roleId])}<strong>${esc(row.name)}</strong></header><div class="hardware-resource-body"><div class="profile-form">${periodField}</div></div></section>`;
  }).join('')}</section>`;
}

export function renderModuleSchedule(project,moduleId) {
  const entries=ENTRYPOINTS.filter(entry=>entry.moduleId===moduleId);
  return `<section class="module-call-contract"><div class="design-toolbar"><h3>调用入口</h3><a class="button small navigation-action" href="#/project/application?module=app-runtime&tab=config">配置任务与时序 →</a></div>${entries.map(entry=>{
    const task=project.design.schedule.tasks.find(task=>task.entries.includes(entry.id)),refs=project.design.moduleContracts[moduleId];
    const name=role=>project.design.structures.find(s=>s.id===refs[role])?.name||'未定义';
    const code=`/**
 * ${entry.description}
 * @param input 本次调用的只读输入快照。
 * @param output 本次调用更新的输出结果。
 * @param state 跨调用保留的模块状态，由所属执行任务管理。
 */
void ${entry.symbol}(const ${name('input')} *input, ${name('output')} *output, ${name('state')} *state);`;
    return `<details class="resource-disclosure hardware-resource module-call-entry" data-state-key="entry-${entry.id}"><summary><strong>${esc(entry.title)}</strong><span class="hardware-resource-meta">${task?`${esc(task.name)} · ${display(taskFrequency(project,task))} Hz · 第 ${task.entries.indexOf(entry.id)+1} 步`:esc(entry.trigger)}</span></summary><div class="hardware-resource-body"><p class="interface-comment">${esc(entry.description)}</p><dl class="interface-parameters"><div><dt>输入 <code>input</code></dt><dd>本次调用的只读输入快照。</dd></div><div><dt>输出 <code>output</code></dt><dd>本次调用更新的输出结果。</dd></div><div><dt>状态 <code>state</code></dt><dd>跨调用保留，由所属执行任务管理。</dd></div></dl><details class="interface-source" data-source-module="${moduleId}" data-state-key="source-${entry.id}"><summary>查看代码<span class="attribute-tag">C 接口声明</span></summary><h4>接口声明</h4><pre class="syntax-code"><code>${highlightC(code)}</code></pre><h4>实现源码 <span class="attribute-tag">生成模板</span></h4><div data-source-body><p class="muted">展开后读取实现源码。</p></div></details></div></details>`;

  }).join('')}</section>`;
}
