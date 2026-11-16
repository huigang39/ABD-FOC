import { highlightC } from '../../shared/ui/code-highlight.mjs';
import { edit, esc } from './view.mjs';
import { taskFrequency, taskCores, effectiveScheduleTasks } from './schedule.mjs';
import { ENTRYPOINTS, entryById } from '../../modules/entrypoints.mjs';
import { MODULES } from '../../core/catalog.mjs';
import { moduleCore } from '../deployment/execution.mjs';
import { fieldHelp } from '../../shared/ui/field-help.mjs';
import { issueNoticeButton } from '../../shared/ui/issue-notices.mjs';
const frequencies=[50,100,200,500,1000,2000,4000,5000,10000,20000];
const title=id=>MODULES.find(m=>m.id===id)?.title||id;
const display=value=>Number.isFinite(value)&&value>0?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}).format(value):'—';

export function renderSchedule(project) {
  const tasks=effectiveScheduleTasks(project);
  const frequencyChoices=value=>[...new Set([...frequencies,...(value>0?[value]:[])])].sort((a,b)=>a-b).map(hz=>[hz,`${display(hz)} Hz`]);
  return `<section class="schedule-editor" id="task-schedule"><div class="design-toolbar"><h3>任务与时序${fieldHelp('任务定义什么时候执行；任务内顺序决定先执行谁。优先级用于同核就绪任务派发，不能替代调用顺序或 NVIC 中断优先级。','任务与时序')}</h3><button class="button small" data-action="schedule-add">新增任务</button></div>
    ${tasks.map(task=>{
      const frequency=taskFrequency(project,task),cores=taskCores(project,task),active=task.entries.some(id=>project.instances[entryById(id)?.moduleId]?.enabled);
      const selectFrequency=task.trigger==='current'?`<div class="form-field"><span class="field-label">控制频率${fieldHelp('使用 PWM 频率 ÷ 电流环分频。观测器与反馈在同一电流环周期内更新。','控制频率')}</span><a class="computed-field" href="#/project/hardware?module=hw-board&tab=config">${display(frequency)} Hz · 跟随 ADC / PWM →</a></div>`:edit('任务频率',frequency,'schedule-task','frequencyHz',{id:task.id,type:'number',choices:frequencyChoices(frequency),description:task.trigger==='control'?'与运动控制的应用控制频率共用同一配置。':'任务每秒执行次数；同一任务内的调用入口使用同一周期。'});
      return `<details class="schedule-task resource-disclosure hardware-resource" data-state-key="schedule-${esc(task.id)}"><summary><strong class="schedule-task-title">${esc(task.name)}</strong><span class="schedule-task-meta hardware-resource-meta">${task.trigger==='current'?'硬件同步':`${display(frequency)} Hz`} · ${display(1e6/frequency)} μs${cores.map(core=>` <span class="attribute-tag core-id-tag">${esc(core.toUpperCase())}</span>`).join('')||' 内核待选择'}${active?'':' · 未参与编译'}</span></summary><div class="schedule-task-body hardware-resource-body"><div class="design-meta">${edit('任务名称',task.name,'schedule-task','name',{id:task.id})}${selectFrequency}${task.trigger==='current'?'<div class="form-field"><span class="field-label">执行方式</span><output class="computed-field">采样完成中断</output></div>':project.instances['app-runtime'].parameters.schedulingAlgorithm==='rate_monotonic'?`<div class="form-field"><span class="field-label">派发优先级</span><output class="computed-field">${task.priority}（按周期）</output></div>`:edit('派发优先级',task.priority,'schedule-task','priority',{id:task.id,type:'integer',choices:Array.from({length:15},(_,i)=>[i+1,`${i+1}${i===0?' · 最高应用优先级':''}`]),description:'数字越小越先执行。协作式任务不会被其他应用任务抢占；电流环中断独立抢占。'})}${edit('执行预算',task.budgetUs,'schedule-task','budgetUs',{id:task.id,type:'number',unit:'μs',description:'填写测量得到的最坏执行时间，需小于周期。Flash 擦写等阻塞操作不能放进电流环。'})}</div>
      <ol class="schedule-sequence" aria-label="${esc(task.name)}执行顺序">${task.entries.map((id,index)=>{
        const entry=entryById(id);if(!entry)return '';
        const enabled=project.instances[entry.moduleId].enabled;
        const eligible=tasks.filter(item=>(entry.moduleId.startsWith('foc-')||entry.moduleId==='hw-board')?item.trigger==='current':entry.moduleId==='app-motion'?item.trigger==='control':item.trigger!=='current');
        return `<li class="schedule-entry ${enabled?'':'excluded'}" data-entry="${id}"><span class="schedule-index">${String(index+1).padStart(2,'0')}</span><div class="schedule-entry-name"><strong>${esc(entry.title)}</strong><code>${entry.symbol}()</code></div><span class="schedule-module">${esc(title(entry.moduleId))}${enabled?'':' · 未编译'}</span><div class="schedule-entry-controls">${eligible.length>1?edit('所属任务',task.id,'schedule-entry','task',{id,choices:eligible.map(item=>[item.id,item.name])}):''}<button class="button small quiet" data-action="schedule-up" data-id="${id}" data-task="${esc(task.id)}" aria-label="上移${esc(entry.title)}" ${index===0?'disabled':''}>↑</button><button class="button small quiet" data-action="schedule-down" data-id="${id}" data-task="${esc(task.id)}" aria-label="下移${esc(entry.title)}" ${index===task.entries.length-1?'disabled':''}>↓</button></div></li>`;
      }).join('')||'<li class="design-note">从其他任务的“所属任务”下拉框移入调用入口。</li>'}</ol>${task.trigger==='periodic'&&!task.entries.length?`<button class="button small quiet" data-action="schedule-remove" data-id="${esc(task.id)}">移除空任务</button>`:''}</div></details>`;
    }).join('')}
    <details class="schedule-task resource-disclosure hardware-resource" data-state-key="schedule-events"><summary><strong class="schedule-task-title">事件入口</strong><span class="schedule-task-meta">由平台事件触发</span></summary><div class="schedule-task-body hardware-resource-body"><div class="contract-table-wrap"><table class="contract-table"><thead><tr><th>模块</th><th>调用入口</th><th>触发时机</th><th>内核</th></tr></thead><tbody>${ENTRYPOINTS.filter(entry=>entry.trigger!=='task').map(entry=>`<tr><td>${esc(title(entry.moduleId))}</td><td><code>${entry.symbol}()</code></td><td>${esc(entry.trigger)}</td><td>${esc(moduleCore(project,entry.moduleId).toUpperCase()||'待选择')}</td></tr>`).join('')}</tbody></table></div></div></details>
    <p class="design-note">配置会写入生成清单；平台中断、跨核派发和输入适配仍需接入，实际周期以设备测量为准。</p></section>`;
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
