import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newModuleProject } from './support/new-project.mjs';
import { parseProject, serializeProject } from '../web/src/core/model.mjs';
import { taskFrequency, schedulerTasks, validateSchedule, userScheduleTasks, updateUserSchedulePeriod } from '../web/src/features/configuration/schedule.mjs';
import { moduleConfig, writeNewProject } from '../native/generator/project.mjs';
import { inspectFirmwareSupport } from '../native/firmware.mjs';

function legacyProject() {
  const project = newModuleProject();
  project.design.schedule.tasks = [
    structuredClone(project.design.schedule.tasks.find(task => task.id === 'current')),
    { id:'control', name:'应用控制', trigger:'control', frequencyHz:null, priority:1, budgetUs:null, entries:['diagnostics.step','state_machine.step','motion.step'] },
    { id:'communication', name:'通信处理', trigger:'periodic', frequencyHz:1000, priority:2, budgetUs:null, entries:['commands.step'] },
    { id:'calibration', name:'校准处理', trigger:'periodic', frequencyHz:1000, priority:3, budgetUs:null, entries:['zeroing.step'] },
    { id:'maintenance', name:'参数存储', trigger:'periodic', frequencyHz:100, priority:4, budgetUs:null, entries:['records.step'] },
  ];
  return project;
}
async function generatedPlan(t, project) {
  const root = await mkdtemp(join(tmpdir(), 'abd-diagnostics-schedule-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  await writeNewProject(root, project);
  return {
    plan: JSON.parse(await readFile(join(root, 'execution-plan.json'), 'utf8')),
    source: await readFile(join(root, 'firmware/application/scheduler/scheduler.c'), 'utf8'),
  };
}

test('new diagnostics task has its own native release bit and period while the default frequency follows control', async t => {
  const project = newModuleProject(), diagnostics = project.design.schedule.tasks.find(task => task.id === 'diagnostics');
  assert.equal(diagnostics.trigger, 'diagnostics');
  assert.equal(diagnostics.frequencyHz, null);
  assert.deepEqual(diagnostics.entries, ['diagnostics.step']);
  assert(!project.design.schedule.tasks.find(task => task.id === 'control').entries.includes('diagnostics.step'));
  assert.deepEqual(validateSchedule(project), []);
  assert.deepEqual(schedulerTasks(project).map(task => task.id), ['diagnostics','control','maintenance']);
  assert.equal(inspectFirmwareSupport(project).sourceReady, true);
  const { plan, source } = await generatedPlan(t, project);
  assert.deepEqual(plan.scheduler.tasks, [
    { id:'diagnostics', releaseBit:0, periodUs:200 },
    { id:'control', releaseBit:1, periodUs:200 },
    { id:'maintenance', releaseBit:2, periodUs:10000 },
  ]);
  assert.match(source, /\.period_us=\{200u,200u,10000u\}/);
  const diagnosticPlan = plan.tasks.find(task => task.id === 'diagnostics');
  assert.deepEqual(diagnosticPlan.entries.map(entry => entry.id), ['diagnostics.step']);
  project.instances['app-motion'].parameters.outerHz = 1000;
  assert.equal(taskFrequency(project, diagnostics), 1000);
  diagnostics.frequencyHz = 400;
  assert.equal(taskFrequency(project, diagnostics), 400);
  assert.equal(project.instances['app-motion'].parameters.outerHz, 1000);
  assert.match(moduleConfig(project, 'app-runtime'), /\.period_us=\{2500u,1000u,10000u\}/);
});

test('saved shared diagnostics retain the original cadence, order and native bit indices across import and generation', async t => {
  const project = legacyProject(), original = structuredClone(project.design.schedule), config = moduleConfig(project, 'app-runtime');
  const loaded = parseProject(serializeProject(project));
  assert.deepEqual(loaded.design.schedule, original);
  assert.equal(moduleConfig(loaded, 'app-runtime'), config);
  assert.deepEqual(schedulerTasks(loaded).map(task => task.id), ['control','maintenance']);
  assert.deepEqual(validateSchedule(loaded), []);
  const { plan, source } = await generatedPlan(t, loaded);
  assert.deepEqual(plan.scheduler.tasks, [{ id:'control', releaseBit:0, periodUs:200 }, { id:'maintenance', releaseBit:1, periodUs:10000 }]);
  assert.deepEqual(plan.tasks.find(task => task.id === 'control').entries.map(entry => entry.id), ['diagnostics.step','state_machine.step','motion.step']);
  assert.match(source, /\.period_us=\{200u,10000u\}/);
  loaded.instances['app-motion'].parameters.outerHz = 2500;
  assert.equal(taskFrequency(loaded, loaded.design.schedule.tasks.find(task => task.id === 'control')), 2500);
  assert.match(moduleConfig(loaded, 'app-runtime'), /\.period_us=\{400u,10000u\}/);
  assert.deepEqual(project.design.schedule, original);
});

test('default safety interfaces remain snapshots and invalid diagnostic periods cannot enter native configuration', () => {
  const project = newModuleProject(), diagnostics = project.design.schedule.tasks.find(task => task.id === 'diagnostics');
  assert(project.design.layerInterfaces.filter(link => link.fromModule === 'app-safety' || link.toModule === 'app-safety').every(link => link.handoff === 'snapshot'));
  for (const frequency of [0, -1, 3000]) {
    diagnostics.frequencyHz = frequency;
    assert.throws(() => moduleConfig(project, 'app-runtime'), /任务频率|整数微秒/);
  }
  diagnostics.frequencyHz = null;
  project.instances['app-runtime'].parameters.schedulingAlgorithm = 'rate_monotonic';
  const ids = schedulerTasks(project).map(task => task.id);
  assert(ids.indexOf('diagnostics') < ids.indexOf('control'));
});

test('explicitly separating old diagnostics preserves call order and rejects an indivisible saved execution budget', () => {
  const original = legacyProject(), before = structuredClone(original);
  const row = userScheduleTasks(original).find(task => task.roleId === 'diagnostics');
  assert.equal(row.detachesOnEdit, true);
  assert.equal(row.periodUs, 200);
  assert.deepEqual(original, before);
  const separated = updateUserSchedulePeriod(original, 'diagnostics', 1000);
  assert.deepEqual(original, before);
  assert.deepEqual(validateSchedule(separated), []);
  const tasks = schedulerTasks(separated);
  assert.deepEqual(tasks.map(task => task.id), ['diagnostics','control','maintenance']);
  assert.deepEqual(tasks[0].entries.map(entry => entry.id), ['diagnostics.step']);
  assert.deepEqual(tasks[1].entries.map(entry => entry.id), ['state_machine.step','motion.step']);
  assert(tasks[0].priority < tasks[1].priority);
  assert.equal(separated.instances['app-motion'].parameters.outerHz, original.instances['app-motion'].parameters.outerHz);
  assert.match(moduleConfig(separated, 'app-runtime'), /\.period_us=\{1000u,200u,10000u\}/);
  const changedControl = updateUserSchedulePeriod(separated, 'control', 250);
  assert.match(moduleConfig(changedControl, 'app-runtime'), /\.period_us=\{1000u,250u,10000u\}/);
  original.design.schedule.tasks.find(task => task.id === 'control').budgetUs = 75;
  const budgeted = structuredClone(original);
  assert.equal(userScheduleTasks(original).find(task => task.roleId === 'diagnostics').readonly, true);
  assert.throws(() => updateUserSchedulePeriod(original, 'diagnostics', 1000), /预算/);
  assert.deepEqual(original, budgeted);
});
