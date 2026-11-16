import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { MODULES, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { validateModuleContracts } from '../web/src/core/module-contracts.mjs';
import { resolveFieldReference } from '../web/src/core/interface-defaults.mjs';
import { createSchedule, checkScheduleShape, validateSchedule, taskFrequency, moveScheduleEntry, schedulerTasks } from '../web/src/features/configuration/schedule.mjs';
import { renderModuleInterfaces } from '../web/src/features/configuration/interfaces-view.mjs';
import { renderModuleData } from '../web/src/features/configuration/view.mjs';
import { moduleConfig } from '../native/generator/project.mjs';
import { newModuleProject } from './support/new-project.mjs';

test('默认接口带有精确映射，同层连接有效，数组元素按编码器通道连接',()=>{
  const p=createNeo75hProject();
  assert.equal(p.design.layerInterfaces.length,22);
  assert(p.design.layerInterfaces.every(link=>link.name && link.version && link.fieldMap.length));
  const contractIssues=validateModuleContracts(p);
  assert.ok(contractIssues.every(issue=>issue.level==='warning'),JSON.stringify(contractIssues.filter(issue=>issue.level!=='warning')));
  assert.equal(contractIssues.filter(issue=>issue.id.endsWith('toModule-excluded')).length,3);
  const link=p.design.layerInterfaces.find(link=>link.id==='link-encoders');
  const source=p.design.structures.find(s=>s.id===link.sourceStructure);
  assert.deepEqual(['name','count','unit'].map(key=>resolveFieldReference(source,link.fieldMap[0].sourceField)[key]),['value[0]',1,'rad']);
  link.fieldMap[0].sourceField='hw-drivers-output-value[4]';
  assert(validateModuleContracts(p).some(issue=>issue.level==='error'&&issue.itemId===link.id));
});

test('输入可由多条连接共同提供，数组与标量重复写入都能检测',()=>{
  const p=createNeo75hProject(),link=p.design.layerInterfaces.find(link=>link.id==='link-reference');
  const duplicate=structuredClone(link);duplicate.id='duplicate';p.design.layerInterfaces.push(duplicate);
  assert(validateModuleContracts(p).some(issue=>issue.id.endsWith('multiple-writers')));
  duplicate.fieldMap[0].targetField+='[0]';
  assert(validateModuleContracts(p).some(issue=>issue.id.endsWith('multiple-writers')));
  p.design.layerInterfaces.pop();
  link.fieldMap=[];
  assert(validateModuleContracts(p).some(issue=>issue.id==='contract-foc-current-unmapped'));
});

test('接口缺省值只补一次，已删除的映射与任务调整保存后不恢复',()=>{
  const p=createNeo75hProject(),fingerprint=configurationFingerprint(p);
  p.design.layerInterfaces=[];
  p.design.schedule.tasks.find(task=>task.id==='calibration').frequencyHz=500;
  assert.notEqual(configurationFingerprint(p),fingerprint);
  const loaded=parseProject(serializeProject(p));
  assert.deepEqual(loaded.design,p.design);
  const old=structuredClone(p);delete old.design.schedule;
  assert.equal(parseProject(JSON.stringify(old)).design.layerInterfaces.length,22);
});

test('所有模块显示真实调用入口和输入来源，数据页不再跳转全局接口',()=>{
  const p=createNeo75hProject();
  for(const module of MODULES){
    const html=renderModuleInterfaces(p,[],module.id);
    assert.match(html.replace(/<[^>]+>/g,''),/void \w+\(const /);
    assert.match(html,/输入来源/);
    assert.doesNotMatch(html,/尚未配置接口|配置层间接口|#\/project\/interfaces/);
    assert.doesNotMatch(renderModuleData(p,module),/配置层间接口|#\/project\/interfaces/);
  }
  assert.match(renderModuleInterfaces(p,[],'foc-modulation'),/modulation_transform/);
  assert.match(renderModuleInterfaces(p,[],'foc-modulation'),/modulation_update/);
});

test('控制周期各自单一来源，观测器和电流环不能拆成不同任务',()=>{
  const p=createNeo75hProject(),tasks=p.design.schedule.tasks;
  assert.deepEqual(validateSchedule(p),[]);
  p.instances['hw-board'].parameters.pwmHz=20000;
  p.instances['hw-board'].parameters.currentLoopDivider=2;
  assert.equal(taskFrequency(p,tasks[0]),10000);
  p.instances['app-motion'].parameters.outerHz=2000;
  assert.equal(taskFrequency(p,tasks[1]),2000);
  moveScheduleEntry(p.design.schedule,'observer.step','maintenance');
  p.instances['foc-observer'].enabled=true;p.instances['foc-observer'].runtimeEnabled=true;
  assert(validateSchedule(p).some(issue=>issue.id==='schedule-domain-observer.step'));
});

test('任务顺序、预算、优先级、重复调用与内核冲突阻止构建',()=>{
  const p=createNeo75hProject();
  moveScheduleEntry(p.design.schedule,'current.step','current',1);
  assert(validateSchedule(p).some(issue=>issue.id.includes('order-current.step-modulation.update')));
  assert.throws(()=>moduleConfig(p,'app-runtime'));
  p.design.schedule=createSchedule();
  const task=p.design.schedule.tasks[1];task.entries.push('current.step');task.budgetUs=10000;task.priority=4;
  moveScheduleEntry(p.design.schedule,'commands.step','control');
  const ids=validateSchedule(p).map(issue=>issue.id);
  assert(ids.includes('schedule-duplicate-current.step'));
  assert(ids.includes('schedule-budget-control'));
  assert(ids.includes('schedule-cores-control'));
  assert(ids.some(id=>id.startsWith('schedule-control-priority-')));
});

test('应用周期校验微秒精度；生成器按本核优先级输出多个周期',()=>{
  const p=newModuleProject(),tasks=schedulerTasks(p);
  assert.deepEqual(tasks.map(task=>task.id),['control','maintenance']);
  const config=moduleConfig(p,'app-runtime');
  assert.match(config,/\.task_count=2u/);
  assert.match(config,/\.period_us=\{200u,10000u\}/);
  p.design.schedule.tasks.find(task=>task.id==='maintenance').frequencyHz=3000;
  assert(validateSchedule(p).some(issue=>issue.id==='schedule-period-maintenance'));
  assert.throws(()=>moduleConfig(p,'app-runtime'));
});

test('自定义任务可移动同核入口；非法任务表与事件入口被拒绝',()=>{
  const p=createNeo75hProject();
  p.design.schedule.tasks.push({id:'extra',name:'诊断任务',trigger:'periodic',frequencyHz:1000,priority:5,budgetUs:10,entries:[]});
  moveScheduleEntry(p.design.schedule,'diagnostics.step','extra');
  assert.deepEqual(validateSchedule(p),[]);
  p.design.schedule.tasks.at(-1).entries.push('scheduler.step');
  assert(validateSchedule(p).some(issue=>issue.id==='schedule-entry-scheduler.step'));
  const bad=createSchedule();bad.tasks[0].priority=1.5;
  assert.throws(()=>checkScheduleShape(bad));
});
