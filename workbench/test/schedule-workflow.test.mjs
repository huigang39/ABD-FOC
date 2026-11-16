import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProject, serializeProject } from '../web/src/core/model.mjs';
import { newModuleProject } from './support/new-project.mjs';
import { renderGuide } from '../web/src/features/configuration/view.mjs';
import { renderModuleParameters } from '../web/src/features/configuration/parameters-view.mjs';
import { renderSchedule } from '../web/src/features/configuration/schedule-view.mjs';
import { userScheduleTasks, updateUserSchedulePeriod } from '../web/src/features/configuration/schedule.mjs';

test('project and standalone scheduler show only four fixed task periods without editable internals', () => {
  const project=newModuleProject(),before=structuredClone(project);
  const parameters=module=>module.id==='app-runtime'?renderSchedule(project):'';
  for(const html of [renderGuide(project,[],'application',{selectedModuleId:'app-runtime',parameters}),renderModuleParameters(project,'app','app-runtime',{parameters})]){
    assert.deepEqual([...html.matchAll(/data-task-id="([^"]+)"/g)].map(match=>match[1]),['control','communication','calibration','diagnostics']);
    for(const name of ['控制环','通信任务','校准任务','故障诊断任务'])assert.ok(html.includes(name));
    const inputs=[...html.matchAll(/<input[^>]*data-edit="schedule-task"[^>]*>/g)].map(match=>match[0]);
    assert.equal(inputs.length,4);
    assert.ok(inputs.every(input=>input.includes('data-key="periodUs"')));
    assert.doesNotMatch(html,/任务内容与高级设置|schedule-sequence|schedule-entry-controls|data-action="schedule-|data-edit="schedule-entry"|data-key="(?:name|budgetUs|priority)"/);
  }
  assert.deepEqual(project,before);
});

test('editing each visible task persists its own period and retains internal current and storage tasks', () => {
  let project=newModuleProject();
  const original=structuredClone(project),internal=project.design.schedule.tasks.filter(task=>['current','maintenance'].includes(task.id));
  const periods={control:400,communication:1000,calibration:4000,diagnostics:5000};
  for(const [roleId,period] of Object.entries(periods))project=updateUserSchedulePeriod(project,roleId,period);
  const loaded=parseProject(serializeProject(project));
  assert.deepEqual(Object.fromEntries(userScheduleTasks(loaded).map(row=>[row.roleId,row.periodUs])),periods);
  assert.deepEqual(loaded.design.schedule.tasks.filter(task=>['current','maintenance'].includes(task.id)),internal);
  assert.equal(loaded.design.schedule.tasks.find(task=>task.trigger==='control').frequencyHz,null);
  assert.equal(loaded.instances['app-motion'].parameters.outerHz,2500);
  assert.notDeepEqual(project,original);
  assert.equal(original.instances['app-motion'].parameters.outerHz,5000);
});

test('opening an old shared diagnostics schedule preserves it until its period is explicitly edited', () => {
  const project=newModuleProject(),schedule=project.design.schedule;
  schedule.tasks=schedule.tasks.filter(task=>task.id!=='diagnostics');
  for(const task of schedule.tasks)if(task.trigger!=='current')task.priority-=1;
  const control=schedule.tasks.find(task=>task.trigger==='control');
  control.entries.unshift('diagnostics.step');
  const before=structuredClone(project),loaded=parseProject(serializeProject(project));
  assert.deepEqual(loaded.design.schedule,schedule);
  const html=renderSchedule(loaded);
  assert.match(html,/<input[^>]*data-id="diagnostics"/);
  assert.deepEqual(loaded.design.schedule,schedule);
  const updated=updateUserSchedulePeriod(loaded,'diagnostics',2000);
  assert.equal(updated.instances['app-motion'].parameters.outerHz,project.instances['app-motion'].parameters.outerHz);
  assert.deepEqual(updated.design.schedule.tasks.find(task=>task.trigger==='control').entries,control.entries.filter(entry=>entry!=='diagnostics.step'));
  assert.equal(updated.design.schedule.tasks.filter(task=>task.entries.includes('diagnostics.step')).length,1);
  assert.equal(userScheduleTasks(updated).find(row=>row.roleId==='diagnostics').periodUs,2000);
  assert.deepEqual(project,before);
});
