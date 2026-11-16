import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, MODULES } from '../web/src/core/model.mjs';
import { addAlgorithmChild } from '../web/src/modules/algorithm/children.mjs';
import { renderAlgorithmChildren } from '../web/src/modules/algorithm/children-view.mjs';
import { fieldReference, instanceSignalReference } from '../web/src/modules/algorithm/signals.mjs';
import { observerChainContracts, observerStages, renderObserverData } from '../web/src/modules/algorithm/foc-observer/view.mjs';

const render=(project,moduleId,primary='<input data-legacy-results>')=>renderAlgorithmChildren(project,MODULES.find(module=>module.id===moduleId),primary);
const children=(project,moduleId)=>project.instances[moduleId].parameters.children.filter(child=>child.compiled);
const card=(html,id)=>html.match(new RegExp(`<section class="hardware-resource algorithm-child-card"[^>]*data-child-id="${id}">([\\s\\S]*?)<\\/section>`))[1];
const fieldKeys=html=>[...html.matchAll(/<(?:input|select)\b[^>]*data-key="([^"]+)"/g)].map(match=>match[1]);
const noFreeRouting=html=>assert.doesNotMatch(html,/data-edit="algorithm-(?:routing|output-name)"|data-key="(?:name|source|secondary|angleOutput|speedOutput|output)"|append-processing-node|add-processing-preset|observer-published-results|data-legacy-results/);
const definitions=[
  ['foc-observer','motor_pll','电机速度 PLL',['bandwidthHz'],'PLL'],
  ['foc-observer','output_pll','出轴速度 PLL',['bandwidthHz'],'PLL'],
  ['foc-filter','load_torque_low_pass','负载力矩低通滤波器',['cutoffHz'],'低通'],
  ['foc-filter','load_torque_motor_speed_notch','负载力矩电机速度动态陷波器',[...Array.from({length:8},(_,index)=>'multiplier'+(index+1)),'q'],'动态陷波'],
];

test('fixed functions show only tuning parameters with fixed titles, accessible removal and rightmost type tags',()=>{
  for(const [moduleId,type,title,keys,tag] of definitions){
    const project=addAlgorithmChild(createProject(),moduleId,type),item=children(project,moduleId)[0];
    item.name='旧自定义名称';
    const before=structuredClone(project),html=render(project,moduleId),content=card(html,item.id);
    assert.deepEqual(fieldKeys(content),keys);
    assert.match(content,new RegExp(`<strong>${title}<\\/strong>`));
    assert.match(content,new RegExp(`data-action="remove-algorithm-child"[^>]*data-id="${item.id}"[^>]*aria-label="移除${title}"`));
    assert.match(content,new RegExp(`<span class="algorithm-child-tags"><span class="attribute-tag">${tag}<\\/span><\\/span><\\/header>`));
    assert.match(content,/icons\.svg#(?:eye|wave)/);
    assert.doesNotMatch(content,/待替换|旧自定义名称|<details|<summary/);
    noFreeRouting(html);
    assert.deepEqual(project,before);
  }
});

test('each fixed function can be added once and disappears from its category menu',()=>{
  for(const moduleId of ['foc-observer','foc-filter']){
    let project=createProject();
    for(const [,type] of definitions.filter(item=>item[0]===moduleId))project=addAlgorithmChild(project,moduleId,type);
    const html=render(project,moduleId);
    assert.equal((html.match(/data-algorithm-child=/g)||[]).length,2);
    assert.doesNotMatch(html,/data-action="add-algorithm-child"/);
    assert.match(html,/disabled title="已添加全部/);
  }
});

test('equivalent older generic nodes use fixed function titles without changing stored identities or parameter keys',()=>{
  for(const [moduleId,type,source,title,key,fixedType] of [
    ['foc-observer','pll','sensor.motor_angle','电机速度 PLL','bandwidthHz','motor_pll'],
    ['foc-observer','pll','sensor.output_angle','出轴速度 PLL','bandwidthHz','output_pll'],
    ['foc-filter','low_pass','sensor.torque','负载力矩低通滤波器','cutoffHz','load_torque_low_pass'],
  ]){
    const project=addAlgorithmChild(createProject(),moduleId,type),item=children(project,moduleId)[0];
    item.routing.source=source;item.parameters[key]=23;
    const before=structuredClone(project),html=render(project,moduleId),content=card(html,item.id);
    assert.match(content,new RegExp(`<strong>${title}<\\/strong>`));
    assert.match(content,new RegExp(`data-key="${key}"`));
    assert.match(content,/value="23"/);
    assert.doesNotMatch(content,/待替换/);
    assert.doesNotMatch(html,new RegExp(`data-action="add-algorithm-child"[^>]*data-type="${fixedType}"`));
    noFreeRouting(html);
    assert.deepEqual(project,before);
  }
});

test('motor-speed dynamic notch exposes eight optional fractional multipliers and one shared Q value',()=>{
  const project=addAlgorithmChild(createProject(),'foc-filter','load_torque_motor_speed_notch');
  const item=children(project,'foc-filter')[0];
  Object.assign(item.parameters,{multiplier1:0.5,multiplier2:2,q:12});
  const before=structuredClone(project),html=render(project,'foc-filter'),content=card(html,item.id);
  assert.deepEqual(fieldKeys(content),[...Array.from({length:8},(_,index)=>'multiplier'+(index+1)),'q']);
  assert.equal((content.match(/class="field-unit">倍<\/span>/g)||[]).length,8);
  for(let index=1;index<=8;index++){
    const input=content.match(new RegExp(`<input[^>]*data-key="multiplier${index}"[^>]*>`))[0];
    assert.match(input,/step="any"/);
    assert.doesNotMatch(input,/\brequired(?:\s|=|>)/);
    if(index>2)assert.match(input,/value=""/);
  }
  assert.match(content,/value="0.5"/);
  assert.match(content,/<strong>负载力矩电机速度动态陷波器<\/strong>/);
  assert.match(content,/<span class="attribute-tag">动态陷波<\/span><\/span><\/header>/);
  assert.doesNotMatch(content,/data-key="frequencyHz"/);
  noFreeRouting(html);
  assert.deepEqual(project,before);
});

test('saved static notch settings stay explicitly static and removable without remaining in add menus',()=>{
  for(const type of ['load_torque_notch','notch']){
    const project=addAlgorithmChild(createProject(),'foc-filter',type),item=children(project,'foc-filter')[0];
    if(type==='notch')item.routing.source='sensor.torque';
    Object.assign(item.parameters,{frequencyHz:175,q:6});
    const before=structuredClone(project),html=render(project,'foc-filter'),content=card(html,item.id);
    assert.deepEqual(fieldKeys(content),['frequencyHz','q']);
    assert.match(content,/<span class="attribute-tag">旧静态陷波<\/span>/);
    assert.match(content,/value="175"/);
    assert.match(content,new RegExp(`data-action="remove-algorithm-child"[^>]*data-id="${item.id}"`));
    assert.doesNotMatch(html,/data-action="add-algorithm-child"[^>]*data-type="(?:load_torque_notch|notch)"/);
    assert.match(html,/data-action="add-algorithm-child"[^>]*data-type="load_torque_motor_speed_notch"/);
    noFreeRouting(html);
    assert.deepEqual(project,before);
  }
});

test('equivalent older encoder tracking keeps its original PLL bandwidth key and exposes no extractor selection',()=>{
  const project=addAlgorithmChild(createProject(),'foc-observer','encoder_tracking_motor');
  const item=children(project,'foc-observer')[0];
  item.parameters.extraction='pll';item.parameters.pllBandwidthHz=34;
  const before=structuredClone(project),html=render(project,'foc-observer'),content=card(html,item.id);
  assert.match(content,/<strong>电机速度 PLL<\/strong>/);
  assert.deepEqual(fieldKeys(content),['pllBandwidthHz']);
  assert.match(content,/value="34"/);
  noFreeRouting(html);
  assert.deepEqual(project,before);
});

test('older generic nodes with custom outputs or chained inputs remain marked for replacement and removable',()=>{
  for(const change of [
    item=>{item.routing.source=instanceSignalReference('upstream','speed');},
    item=>{item.routing.source='sensor.torque';item.outputNames={output:'原力矩输出'};},
    item=>{item.routing.source='sensor.torque';item.routing.output=fieldReference('old','torque');},
  ]){
    const project=addAlgorithmChild(createProject(),'foc-filter','low_pass'),item=children(project,'foc-filter')[0];
    item.name='保留 <旧配置>';item.parameters.cutoffHz=15;change(item);
    const before=structuredClone(project),html=render(project,'foc-filter'),content=card(html,item.id);
    assert.match(content,/<strong>保留 &lt;旧配置&gt;<\/strong>/);
    assert.match(content,/旧通用配置待替换/);
    assert.deepEqual(fieldKeys(content),['cutoffHz']);
    assert.match(content,new RegExp(`data-action="remove-algorithm-child"[^>]*data-id="${item.id}"`));
    assert.match(html,/data-action="add-algorithm-child"[^>]*data-type="load_torque_low_pass"/);
    noFreeRouting(html);
    assert.deepEqual(project,before);
  }
});

test('old model observer tuning remains visible without restoring source or publication selectors',()=>{
  const project=addAlgorithmChild(createProject(),'foc-observer','smo');
  const before=structuredClone(project),html=render(project,'foc-observer');
  assert.match(html,/data-algorithm-child="smo"/);
  assert.match(html,/data-key="gain"/);
  assert.match(html,/data-key="extraction"/);
  assert.match(html,/待替换/);
  assert.doesNotMatch(html,/data-action="add-algorithm-child"[^>]*data-type="smo"/);
  noFreeRouting(html);
  assert.deepEqual(project,before);
});

test('old global publication choices remain stored without reintroducing the retired editor',()=>{
  const project=createProject();
  project.instances['foc-observer'].parameters.angleOutput='smo.angle';
  const before=structuredClone(project),html=render(project,'foc-observer');
  noFreeRouting(html);
  assert.deepEqual(project,before);
});

test('calibration and angle delay stay at their relocated pages while friction retains its parameter form',()=>{
  let project=addAlgorithmChild(createProject(),'foc-compensation','current_calibration');
  project=addAlgorithmChild(project,'foc-compensation','angle_delay');
  let before=structuredClone(project),html=render(project,'foc-compensation');
  assert.doesNotMatch(html,/data-(?:algorithm-child|type)="(?:current_calibration|angle_delay)"/);
  assert.match(html,/data-action="add-algorithm-child"[^>]*data-type="friction"/);
  assert.deepEqual(project,before);
  project=addAlgorithmChild(project,'foc-compensation','friction');before=structuredClone(project);
  html=render(project,'foc-compensation','<input data-friction-parameter>');
  assert.match(html,/data-friction-parameter/);
  assert.doesNotMatch(html,/待替换/);
  noFreeRouting(html);
  assert.deepEqual(project,before);
});

test('retained generic PLL contracts still preserve motor, output and electrical angle domains',()=>{
  const project=addAlgorithmChild(createProject(),'foc-observer','pll');
  const pll=children(project,'foc-observer')[0];
  for(const [source,angle,speed] of [['sensor.motor_angle','motor_angle','motor_velocity'],['sensor.output_angle','output_angle','output_velocity'],['feedback.angle','electrical_angle','electrical_velocity']]){
    pll.routing.source=source;
    const contract=observerChainContracts(pll,project);
    assert.equal(contract.input[0].name,angle);
    assert.deepEqual(contract.output.slice(0,2).map(field=>field.name),[angle,speed]);
    assert.ok(contract.state.some(field=>field.name==='tracked_angle'));
    assert.ok(!contract.state.some(field=>field.name==='active_source'));
    assert.ok(observerStages('pll','pll',pll,project).includes('PLL 跟踪'));
  }
  assert.doesNotMatch(renderObserverData([pll],project),/<details|<summary/);
});
