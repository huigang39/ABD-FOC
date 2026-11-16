import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { renderSchedule, renderModuleSchedule } from '../web/src/features/configuration/schedule-view.mjs';

const visible=[['control','控制环'],['communication','通信任务'],['calibration','校准任务'],['diagnostics','故障诊断任务']];
const card=(html,id)=>html.match(new RegExp(`<section class="schedule-task hardware-resource" data-task-id="${id}">([\\s\\S]*?)<\\/section>`))[1];
const periodInput=html=>html.match(/<input\b[^>]*data-key="periodUs"[^>]*>/)[0];

test('the scheduler displays exactly four flat fixed tasks with period-only controls',()=>{
  const project=createProject(),before=structuredClone(project),html=renderSchedule(project);
  assert.deepEqual([...html.matchAll(/data-task-id="([^"]+)"/g)].map(match=>match[1]),visible.map(([id])=>id));
  assert.deepEqual([...html.matchAll(/<input\b[^>]*data-key="([^"]+)"/g)].map(match=>match[1]),['periodUs','periodUs','periodUs','periodUs']);
  for(const [id,title] of visible){
    const body=card(html,id);
    assert.match(body,new RegExp(`<strong>${title}<\\/strong>`));
    assert.match(body,/icons\.svg#/);
    assert.match(periodInput(body),/step="1"/);
    assert.match(body,/<span class="field-unit">μs<\/span>/);
  }
  assert.doesNotMatch(html,/<details|<summary|<button|<select|<ol|data-action=|data-entry=|data-edit="schedule-entry"|data-key="(?:name|priority|budgetUs)"|data-task-id="(?:current|maintenance)"|高级|执行顺序|所属任务/);
  assert.deepEqual(project,before);
});

test('stored task names, step orders, priorities and budgets remain unchanged and hidden',()=>{
  const project=createProject();
  for(const task of project.design.schedule.tasks){task.name='自定义旧任务 '+task.id;task.budgetUs=27;}
  const before=structuredClone(project),html=renderSchedule(project);
  assert.doesNotMatch(html,/自定义旧任务|peripherals\.sample|commands\.step|zeroing\.step|records\.step|diagnostics\.step|任务名称|执行预算|优先级/);
  assert.deepEqual(project,before);
});

test('legacy diagnostics sharing the control task bind edits to the diagnostic role, never the control task',()=>{
  const project=createProject();
  const tasks=project.design.schedule.tasks;
  project.design.schedule.tasks=tasks.filter(task=>task.id!=='diagnostics');
  const control=project.design.schedule.tasks.find(task=>task.trigger==='control');
  control.entries=control.entries.filter(entry=>entry!=='diagnostics.step');
  control.entries.unshift('diagnostics.step');
  project.instances['app-motion'].parameters.outerHz=2000;
  const before=structuredClone(project),html=renderSchedule(project),diagnostic=periodInput(card(html,'diagnostics'));
  assert.match(diagnostic,/data-id="diagnostics"/);
  assert.doesNotMatch(diagnostic,/data-id="control"/);
  assert.match(diagnostic,/aria-valuenow="500"/);
  assert.match(diagnostic,/title="[^"]+"/);
  assert.doesNotMatch(diagnostic,/\bdisabled\b/);
  assert.deepEqual(project,before);
});

test('module call contracts keep their independent architecture and source detail view',()=>{
  const project=createProject(),before=structuredClone(project),html=renderModuleSchedule(project,'app-motion');
  assert.match(html,/调用入口/);
  assert.match(html,/<details class="resource-disclosure hardware-resource module-call-entry"/);
  assert.match(html,/data-source-module="app-motion"/);
  assert.match(html,/查看代码/);
  assert.deepEqual(project,before);
});

test('a legacy shared task with a recorded budget does not pretend to offer an independent diagnostic period',()=>{
  const project=createProject();
  project.design.schedule.tasks=project.design.schedule.tasks.filter(task=>task.id!=='diagnostics');
  const control=project.design.schedule.tasks.find(task=>task.trigger==='control');
  if(!control.entries.includes('diagnostics.step'))control.entries.unshift('diagnostics.step');
  control.budgetUs=12;
  const before=structuredClone(project),html=renderSchedule(project),input=periodInput(card(html,'diagnostics'));
  assert.match(input,/\bdisabled\b/);
  assert.match(input,/aria-disabled="true"/);
  assert.match(input,/title="[^"]+"/);
  assert.deepEqual(project,before);
});
