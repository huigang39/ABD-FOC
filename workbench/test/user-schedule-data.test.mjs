import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,parseProject,serializeProject} from '../web/src/core/model.mjs';
import {createNeo75hProject} from '../web/src/profiles/neo75h.mjs';
import {createSchedule,userScheduleTasks,updateUserSchedulePeriod,taskFrequency,scheduledTasks,checkScheduleShape,effectiveScheduleTasks} from '../web/src/features/configuration/schedule.mjs';
const task=(p,id)=>p.design.schedule.tasks.find(task=>task.id===id);
function legacy(){
 const p=createProject();p.instances['app-motion'].parameters.outerHz=5000;
 p.design.schedule.tasks=p.design.schedule.tasks.filter(task=>task.id!=='diagnostics');
 for(const task of p.design.schedule.tasks)if(task.trigger!=='current')task.priority--;
 const control=task(p,'control');control.name='应用控制';control.entries.unshift('diagnostics.step');
 task(p,'communication').name='通信处理';task(p,'calibration').name='校准处理';return p;
}

test('new projects contain a true diagnostics task while exactly four role cards hide internal work',()=>{
 const p=createProject();p.instances['app-motion'].parameters.outerHz=2000;
 const before=structuredClone(p),rows=userScheduleTasks(p);
 assert.deepEqual(rows.map(row=>[row.roleId,row.name]),[['control','控制环'],['communication','通信任务'],['calibration','校准任务'],['diagnostics','故障诊断任务']]);
 assert(rows.every(row=>!row.readonly&&!row.detachesOnEdit));assert(rows.every(row=>row.taskId===row.roleId));
 assert.deepEqual(task(p,'control').entries,['state_machine.step','motion.step']);assert.deepEqual(task(p,'diagnostics').entries,['diagnostics.step']);
 assert.equal(task(p,'diagnostics').trigger,'diagnostics');assert.equal(task(p,'diagnostics').priority,1);assert.equal(task(p,'control').priority,2);
 assert(task(p,'current').entries.includes('current.step'));assert.deepEqual(task(p,'maintenance').entries,['records.step']);
 assert.equal(rows.find(row=>row.roleId==='diagnostics').periodUs,500);assert.deepEqual(p,before);
 assert.equal(checkScheduleShape(createSchedule()),true);
});

test('period edits bind to the true task and diagnostics becomes independent after its explicit override',()=>{
 let p=createProject();p.instances['app-motion'].parameters.outerHz=1000;task(p,'communication').id='serial-service';
 const before=structuredClone(p);p=updateUserSchedulePeriod(p,'communication',1250);
 assert.equal(task(p,'serial-service').frequencyHz,800);assert.equal(task(before,'serial-service').frequencyHz,1000);
 assert.equal(userScheduleTasks(p).find(row=>row.roleId==='communication').taskId,'serial-service');
 p=updateUserSchedulePeriod(p,'diagnostics',500);p=updateUserSchedulePeriod(p,'control',250);
 assert.equal(p.instances['app-motion'].parameters.outerHz,4000);assert.equal(taskFrequency(p,task(p,'diagnostics')),2000);assert.equal(task(p,'control').frequencyHz,null);
 assert.equal(taskFrequency(p,task(p,'calibration')),1000);assert.equal(taskFrequency(p,task(p,'maintenance')),100);
 p=updateUserSchedulePeriod(p,'diagnostics',null);assert.equal(taskFrequency(p,task(p,'diagnostics')),4000);
 for(const invalid of [0,-1,1.5,Infinity,2147483648])assert.throws(()=>updateUserSchedulePeriod(p,'control',invalid),/调度周期/);
 assert.throws(()=>updateUserSchedulePeriod(p,'maintenance',10),/任务类型不存在/);
});

test('loading, saving and projecting a historical shared diagnostic never changes its stored schedule',()=>{
 const p=legacy(),before=structuredClone(p.design.schedule),rows=userScheduleTasks(p),diagnostics=rows.find(row=>row.roleId==='diagnostics');
 assert.equal(diagnostics.taskId,'control');assert.equal(diagnostics.detachesOnEdit,true);assert.equal(diagnostics.readonly,false);assert.equal(diagnostics.periodUs,200);
 const restored=parseProject(serializeProject(p));assert.deepEqual(restored.design.schedule,before);assert.deepEqual(p.design.schedule,before);
 assert.equal(scheduledTasks(restored).find(task=>task.id==='control').entries[0].id,'diagnostics.step');
 assert(!restored.design.schedule.tasks.some(task=>task.id==='diagnostics'));
});

test('an explicit legacy diagnostic period edit detaches only diagnostics and preserves all other cadence and entry order',()=>{
 const p=legacy(),before=structuredClone(p),next=updateUserSchedulePeriod(p,'diagnostics',1500);
 assert.deepEqual(p,before);assert.equal(next.instances['app-motion'].parameters.outerHz,5000);
 assert.deepEqual(task(next,'control').entries,['state_machine.step','motion.step']);
 assert.deepEqual(task(next,'diagnostics').entries,['diagnostics.step']);assert.equal(taskFrequency(next,task(next,'diagnostics')),1e6/1500);
 assert.equal(task(next,'diagnostics').priority,task(before,'control').priority);
 for(const original of before.design.schedule.tasks){
  const updated=task(next,original.id);assert.equal(taskFrequency(next,updated),taskFrequency(before,original));
  assert.equal(updated.priority,original.trigger==='current'?original.priority:original.priority+1);
  if(original.id!=='control')assert.deepEqual(updated.entries,original.entries);
 }
 assert.equal(userScheduleTasks(next).find(row=>row.roleId==='diagnostics').taskId,'diagnostics');
 next.instances['app-runtime'].parameters.schedulingAlgorithm='rate_monotonic';task(next,'diagnostics').frequencyHz=5000;
 const ranked=effectiveScheduleTasks(next);assert(ranked.find(task=>task.id==='diagnostics').priority<ranked.find(task=>task.id==='control').priority);
});

test('custom mixed order, budget, task capacity or unavailable priority cannot be silently detached',()=>{
 for(const change of [
  p=>{task(p,'control').entries=['state_machine.step','diagnostics.step','motion.step'];},
  p=>{task(p,'control').budgetUs=20;},
  p=>{task(p,'maintenance').priority=15;},
  p=>{task(p,'communication').priority=task(p,'control').priority;},
  p=>{while(p.design.schedule.tasks.length<16)p.design.schedule.tasks.push({id:`extra-${p.design.schedule.tasks.length}`,name:'旧任务',trigger:'periodic',frequencyHz:10,priority:14,budgetUs:null,entries:[]});},
 ]){
  const p=legacy();change(p);const before=structuredClone(p),row=userScheduleTasks(p).find(row=>row.roleId==='diagnostics');
  assert.equal(row.readonly,true);assert(row.reason);assert.throws(()=>updateUserSchedulePeriod(p,'diagnostics',1000));assert.deepEqual(p,before);
  assert.deepEqual(parseProject(serializeProject(p)).design.schedule,before.design.schedule);
 }
});

test('old independently scheduled diagnostics bind their existing task and NEO inherits its actual control cadence',()=>{
 const p=legacy();task(p,'control').entries.shift();p.design.schedule.tasks.push({id:'old-safety-task',name:'保护',trigger:'periodic',frequencyHz:250,priority:6,budgetUs:20,entries:['diagnostics.step']});
 const before=structuredClone(p),row=userScheduleTasks(p).find(row=>row.roleId==='diagnostics');assert.equal(row.taskId,'old-safety-task');assert.equal(row.periodUs,4000);assert.equal(row.readonly,false);
 const updated=updateUserSchedulePeriod(p,'diagnostics',5000);assert.equal(task(updated,'old-safety-task').frequencyHz,200);assert.equal(task(updated,'old-safety-task').budgetUs,20);assert.equal(task(updated,'old-safety-task').priority,6);assert.deepEqual(p,before);
 const neo=createNeo75hProject();assert.equal(taskFrequency(neo,task(neo,'diagnostics')),neo.instances['app-motion'].parameters.outerHz);
});


test('imported pure application task roles cannot edit a current/control time source through the wrong card',()=>{
 for(const role of ['communication','calibration','diagnostics'])for(const trigger of ['current','control']){
  const p=createProject();p.instances['app-motion'].parameters.outerHz=1000;task(p,role).trigger=trigger;task(p,role).frequencyHz=null;
  const before=structuredClone(p),row=userScheduleTasks(p).find(item=>item.roleId===role);
  assert.equal(row.readonly,true,`${role} / ${trigger}`);assert.match(row.reason,/周期来源/);
  assert.throws(()=>updateUserSchedulePeriod(p,role,1000),/周期来源/);assert.deepEqual(p,before);
 }
 for(const role of ['communication','calibration']){
  const p=createProject();task(p,role).trigger='diagnostics';
  assert.equal(userScheduleTasks(p).find(item=>item.roleId===role).readonly,true);
 }
});
