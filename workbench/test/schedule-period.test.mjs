import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseProject, serializeProject } from '../web/src/core/model.mjs';
import { periodMicroseconds, validateSchedule } from '../web/src/features/configuration/schedule.mjs';
import { renderSchedule } from '../web/src/features/configuration/schedule-view.mjs';
import { moduleConfig, writeNewProject } from '../native/generator/project.mjs';
import { newModuleProject } from './support/new-project.mjs';

test('integer periods survive Hz storage, JSON, display, budget checking and C generation',()=>{
  for(const period of [1,7,123,333,1234,1000,5001,2147483647]) {
    const project=newModuleProject(),task=project.design.schedule.tasks.find(item=>item.id==='maintenance');
    task.frequencyHz=1e6/period;task.budgetUs=period;
    project.design.schedule.tasks.find(item=>item.id==='communication').frequencyHz=1e6/period;
    const loaded=parseProject(serializeProject(project)),stored=loaded.design.schedule.tasks.find(item=>item.id===task.id);
    assert.equal(stored.frequencyHz,task.frequencyHz,'the existing Hz schema is unchanged');
    assert.equal(periodMicroseconds(stored.frequencyHz),period);
    assert.deepEqual(validateSchedule(loaded).filter(issue=>/schedule-(period|budget)-maintenance/.test(issue.id)),[],String(period));
    const scheduleHtml=renderSchedule(loaded);
    assert.doesNotMatch(scheduleHtml,/data-task-id="(?:current|maintenance)"/);
    const input=scheduleHtml.match(/<input[^>]*data-edit="schedule-task"[^>]*data-key="periodUs"[^>]*data-id="communication"[^>]*>/)?.[0];
    assert.match(input,new RegExp(`aria-valuenow="${period}"`));
    assert.match(moduleConfig(loaded,'app-runtime'),new RegExp(`\\.period_us=\\{200u,200u,${period}u\\}`));
  }
});

test('control tasks use the same normalized period while retaining a single frequency source',()=>{
  const project=newModuleProject();project.instances['app-motion'].parameters.outerHz=1e6/7;
  const control=project.design.schedule.tasks.find(item=>item.id==='control');control.budgetUs=7;
  assert.equal(control.frequencyHz,null);
  assert.deepEqual(validateSchedule(project).filter(issue=>/schedule-(period|budget|source)-control/.test(issue.id)),[]);
  assert.match(moduleConfig(project,'app-runtime'),/\.period_us=\{7u,7u,10000u\}/);
});

test('fractional periods outside floating-point tolerance and unsupported bounds still reject',()=>{
  for(const period of [7.25,7+1e-10,333+1e-8,2147483646.5,.5,2147483648]) {
    const project=newModuleProject(),task=project.design.schedule.tasks.find(item=>item.id==='maintenance');task.frequencyHz=1e6/period;
    assert(validateSchedule(project).some(issue=>issue.id==='schedule-period-maintenance'),String(period));
    assert.throws(()=>moduleConfig(project,'app-runtime'),/整数微秒/);
  }
  assert.equal(periodMicroseconds(3000),1e6/3000,'3000 Hz must not silently become 333 microseconds');
});

test('scheduler execution plan and emitted integer C use the identical normalized period',async t=>{
  const directory=resolve(tmpdir()),output=await mkdtemp(join(directory,'abd-schedule-period-'));
  assert.equal(dirname(output),directory);
  t.after(()=>rm(output,{recursive:true,force:true}));
  const project=newModuleProject();project.design.schedule.tasks.find(task=>task.id==='maintenance').frequencyHz=1e6/7;
  await writeNewProject(output,project);
  const plan=JSON.parse(await readFile(join(output,'execution-plan.json'),'utf8'));
  assert.equal(plan.scheduler.tasks.find(task=>task.id==='maintenance').periodUs,7);
  assert.match(await readFile(join(output,'firmware/application/scheduler/scheduler.c'),'utf8'),/\.period_us=\{200u,200u,7u\}/);
});
