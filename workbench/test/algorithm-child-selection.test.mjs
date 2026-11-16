import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, MODULES } from '../web/src/core/model.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { CHILD_TYPES, createAlgorithmChild, configuredAlgorithmChildren, addAlgorithmChild, removeAlgorithmChild, fixedAlgorithmChildren } from '../web/src/modules/algorithm/children.mjs';
import { renderAlgorithmChildren } from '../web/src/modules/algorithm/children-view.mjs';

const instance=(project,id='foc-observer')=>project.instances[id];
const child=(project,type,id='foc-observer')=>instance(project,id).parameters.children.find(item=>item.type===type);
const render=(project,id='foc-observer')=>renderAlgorithmChildren(project,MODULES.find(item=>item.id===id),'<input data-primary-parameter>');

test('empty algorithms offer add menus without rendering or materializing every child',()=>{
 const project=createProject(),before=structuredClone(project);
 for(const id of Object.keys(CHILD_TYPES)){
  const html=render(project,id);
  assert.equal(configuredAlgorithmChildren(project,id).length,0);
  assert.doesNotMatch(html,/data-algorithm-child=|data-primary-parameter|observer-guide|observer-stages|observer-contract-notes/);
  assert.match(html,/data-action="add-algorithm-child"/);
  const offered={'foc-observer':['motor_pll','output_pll'],'foc-filter':['load_torque_low_pass','load_torque_motor_speed_notch'],'foc-compensation':['friction']}[id];
  assert.deepEqual([...html.matchAll(/data-action="add-algorithm-child"[^>]*data-type="([^"]+)"/g)].map(match=>match[1]),offered);
 }
 assert.deepEqual(project,before);
});

test('algorithm add controls use accessible icon menus and fixed functions can be added once',()=>{
 for(const [id,label] of [['foc-observer','观测器'],['foc-filter','滤波器'],['foc-compensation','补偿器']]){
  let project=createProject();
  const html=render(project,id);
  assert.match(html,new RegExp(`<div class="design-toolbar algorithm-children-toolbar"><h3>${label}</h3><details class="configuration-more algorithm-add-menu"`));
  const summary=/<summary class="button small hardware-add-toggle"([^>]*)>([\s\S]*?)<\/summary>/.exec(html);
  assert.ok(summary);
  assert.ok(summary[1].includes(`title="添加${label}"`));
  assert.ok(summary[1].includes(`aria-label="添加${label}"`));
  assert.match(summary[2],/icons\.svg#plus/);
  assert.doesNotMatch(summary[2],/添加|已添加/);
  for(const type of {'foc-observer':['motor_pll','output_pll'],'foc-filter':['load_torque_low_pass','load_torque_motor_speed_notch'],'foc-compensation':['friction']}[id])project=addAlgorithmChild(project,id,type);
  const complete=render(project,id);
  assert.doesNotMatch(complete,/data-action="add-algorithm-child"/);
  assert.match(complete,new RegExp(`<button class="button small hardware-add-toggle" type="button" disabled title="已添加全部${label}" aria-label="添加${label}">`));
 }
});

test('adding enables only the selected child and keeps other paused children effectively off',()=>{
 const project=createProject(),original=createAlgorithmChild('foc-observer','smo');
 original.enabled=true;original.parameters.gain=12;
 instance(project).enabled=true;instance(project).runtimeEnabled=false;instance(project).parameters.children=[original];
 const before=structuredClone(project),next=addAlgorithmChild(project,'foc-observer','flux');
 assert.deepEqual(project,before);
 assert.equal(instance(next).enabled,true);assert.equal(instance(next).runtimeEnabled,true);
 assert.equal(child(next,'flux').compiled,true);assert.equal(child(next,'flux').enabled,true);
 assert.equal(child(next,'smo').compiled,true);assert.equal(child(next,'smo').enabled,false);
 assert.equal(child(next,'smo').parameters.gain,12);
 const html=render(next);
 assert.equal((html.match(/data-algorithm-child=/g)||[]).length,2);
 assert.doesNotMatch(html,/data-action="add-algorithm-child"[^>]*data-type="(?:smo|flux)"/);
 assert.doesNotMatch(html,/data-key="(?:compiled|enabled)"|编译期|运行期|observer-stages|observer-contract-notes/);
});

test('adding to an active group preserves other enabled and disabled selections',()=>{
 let project=addAlgorithmChild(createProject(),'foc-observer','smo');
 project=addAlgorithmChild(project,'foc-observer','flux');child(project,'flux').enabled=false;
 const next=addAlgorithmChild(project,'foc-observer','load_torque');
 assert.equal(child(next,'smo').enabled,true);assert.equal(child(next,'flux').enabled,false);assert.equal(child(next,'load_torque').enabled,true);
 assert.throws(()=>addAlgorithmChild(next,'foc-observer','flux'),/已经添加/);
});

test('remove and re-add preserve parameters, with explicit removal disabling the last group',()=>{
 let project=addAlgorithmChild(createProject(),'foc-observer','smo');
 Object.assign(child(project,'smo').parameters,{gain:4,boundary:.25,extraction:'atan2',speedFilterHz:123});
 const saved=structuredClone(child(project,'smo').parameters);
 project=removeAlgorithmChild(project,'foc-observer','smo');
 assert.equal(instance(project).enabled,false);assert.equal(instance(project).runtimeEnabled,false);
 assert.equal(configuredAlgorithmChildren(project,'foc-observer').length,0);
 assert.deepEqual(child(project,'smo').parameters,saved);
 const restored=parseProject(serializeProject(project));
 const next=addAlgorithmChild(restored,'foc-observer','smo');
 assert.deepEqual(child(next,'smo').parameters,saved);assert.equal(child(next,'smo').enabled,true);
 assert.equal(instance(next).runtimeEnabled,true);
});

test('legacy implicit friction remains visible and off without render mutation, and removal cannot revive it',()=>{
 const project=createNeo75hProject(),before=structuredClone(project),id='foc-compensation';
 assert.equal(instance(project,id).parameters.children.length,0);
 assert.equal(instance(project,id).runtimeEnabled,false);
 assert.deepEqual(configuredAlgorithmChildren(project,id).map(item=>[item.type,item.enabled]),[['friction',false]]);
 assert.match(render(project,id),/data-algorithm-child="friction"/);
 assert.deepEqual(project,before);
 const next=removeAlgorithmChild(project,id,'friction');
 assert.equal(child(next,'friction',id).compiled,false);assert.equal(child(next,'friction',id).enabled,false);
 assert.equal(instance(next,id).enabled,false);assert.equal(instance(next,id).runtimeEnabled,false);
 assert.equal(configuredAlgorithmChildren(parseProject(serializeProject(next)),id).length,0);
 assert.equal(fixedAlgorithmChildren(next,id).find(item=>item.type==='friction').compiled,false);
 assert.equal(instance(next,id).parameters.coulombNm,instance(project,id).parameters.coulombNm);
});

test('adding a fresh compensator does not silently add the legacy friction default',()=>{
 const project=addAlgorithmChild(createProject(),'foc-compensation','angle_delay');
 assert.deepEqual(configuredAlgorithmChildren(project,'foc-compensation').map(item=>item.type),['angle_delay']);
 assert.equal(child(project,'friction','foc-compensation').compiled,false);
 assert.equal(child(project,'angle_delay','foc-compensation').enabled,true);
});

test('invalid additions and removals reject without changing configuration',()=>{
 const project=createProject(),before=structuredClone(project);
 assert.throws(()=>addAlgorithmChild(project,'hw-board','smo'),/有效/);
 assert.throws(()=>addAlgorithmChild(project,'foc-observer','friction'),/有效/);
 assert.throws(()=>removeAlgorithmChild(project,'foc-observer','smo'),/尚未添加/);
 assert.deepEqual(project,before);
});
