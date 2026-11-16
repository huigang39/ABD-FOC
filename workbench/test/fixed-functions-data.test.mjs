import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, serializeProject, parseProject } from '../web/src/core/model.mjs';
import { createAlgorithmChild, addAlgorithmChild, removeAlgorithmChild, configuredAlgorithmChildren, checkAlgorithmChildren, updateAlgorithmRouting, algorithmChildrenIssues, algorithmExecutionPlan } from '../web/src/modules/algorithm/children.mjs';
import { updateAlgorithmOutputName } from '../web/src/modules/algorithm/editing.mjs';
import { FIXED_ALGORITHM_FUNCTIONS, fixedFunctionForChild, fixedFunctionPresentation, fixedFunctionChoices, effectiveAlgorithmRouting } from '../web/src/modules/algorithm/fixed-functions.mjs';
import { resolveAlgorithmSignal, availableAlgorithmSignals } from '../web/src/modules/algorithm/signals.mjs';
import { createResource } from '../web/src/modules/hardware/hw-board/resources.mjs';
const saved=(p,moduleId)=>p.instances[moduleId].parameters.children;
const last=(p,moduleId)=>saved(p,moduleId).at(-1);
function fixture(){
 const p=createProject(),drivers=p.instances['hw-drivers'].parameters,resources=p.instances['hw-board'].parameters.resources;
 for(const [prefix,capability,model,id] of [['motorEncoder','encoderCapability','gongwang','USART1'],['outputEncoder','outputEncoderCapability','jingang','USART2'],['torqueSensor','torqueCapability','KW','USART3']]){
  const resource=createResource('uart',id);resource.instance=id;resource.settings.physical='rs485';resource.pins.RX='PA1';resources.push(resource);
  Object.assign(drivers,{[capability]:'present',[prefix+'Model']:model,[prefix+'Resource']:id});
 }
 return p;
}

test('active and retained fixed functions store only parameters and derive distinct fixed input/output contracts',()=>{
 let p=fixture();assert.deepEqual(configuredAlgorithmChildren(p,'foc-filter'),[]);
 for(const definition of FIXED_ALGORITHM_FUNCTIONS){
  const constructed=createAlgorithmChild(definition.moduleId,definition.id);assert.equal(constructed.id,definition.id);assert.doesNotThrow(()=>checkAlgorithmChildren([constructed],definition.moduleId));assert.deepEqual(JSON.parse(JSON.stringify(constructed)),constructed);
  p=addAlgorithmChild(p,definition.moduleId,definition.id);const child=saved(p,definition.moduleId).find(child=>child.type===definition.id);
  assert.equal(child.id,definition.id);assert.equal(child.name,definition.title);assert.deepEqual(child.routing,{});
  assert.deepEqual(child.parameters,Object.fromEntries(definition.fields.map(([key])=>[key,null])));
  assert.equal(effectiveAlgorithmRouting(child).source,definition.source);assert.equal(fixedFunctionForChild(child),definition);
  assert.equal(fixedFunctionPresentation(child).legacy,false);
  assert.throws(()=>addAlgorithmChild(p,definition.moduleId,definition.id),/已经添加/);
  for(const output of definition.outputs){const signal=resolveAlgorithmSignal(p,output.id);assert.equal(signal.quantity,output.quantity);assert.equal(signal.unit,output.unit);assert.equal(signal.childId,child.id);}
  assert.throws(()=>updateAlgorithmRouting(p,definition.moduleId,child.id,'source','feedback.angle'),/连接字段无效/);
  assert.throws(()=>updateAlgorithmOutputName(p,definition.moduleId,child.id,'output','other'),/输出名称格式无效/);
 }
 const before=structuredClone(p),restored=parseProject(serializeProject(p));assert.deepEqual(p,before);
 for(const definition of FIXED_ALGORITHM_FUNCTIONS)assert.deepEqual(saved(restored,definition.moduleId).find(child=>child.type===definition.id),saved(p,definition.moduleId).find(child=>child.type===definition.id));
 assert.deepEqual(algorithmExecutionPlan(p).order,['motor_pll','output_pll','load_torque_low_pass','load_torque_notch','load_torque_motor_speed_notch']);
 assert(FIXED_ALGORITHM_FUNCTIONS.flatMap(definition=>definition.outputs).every(output=>availableAlgorithmSignals(p).some(signal=>signal.id===output.id)));
});

test('equivalent generic functions keep original identifiers, parameters and bindings through save',()=>{
 for(const [type,moduleId,source,functionId] of [['pll','foc-observer','sensor.motor_angle','motor_pll'],['pll','foc-observer','sensor.output_angle','output_pll'],['low_pass','foc-filter','sensor.torque','load_torque_low_pass'],['notch','foc-filter','sensor.torque','load_torque_notch']]){
  let p=addAlgorithmChild(fixture(),moduleId,type),child=last(p,moduleId);child.routing.source=source;for(const key of Object.keys(child.parameters))child.parameters[key]=17;
  const before=structuredClone(child),view=fixedFunctionPresentation(child);assert.equal(view.definition.id,functionId);assert.equal(view.legacy,true);assert.equal(view.equivalent,true);
  if(!view.definition.retired)assert(fixedFunctionChoices(p,moduleId).find(choice=>choice.id===functionId).disabled);
  else assert(!fixedFunctionChoices(p,moduleId).some(choice=>choice.id===functionId));
  assert.throws(()=>addAlgorithmChild(p,moduleId,functionId),/已经添加/);
  p=parseProject(serializeProject(p));assert.deepEqual(saved(p,moduleId).find(item=>item.id===before.id),before);
  const signal=resolveAlgorithmSignal(p,view.definition.outputs[0].id);assert.equal(signal.childId,before.id);
 }
});

test('legacy encoder PLL extraction is equivalent but difference extraction is retained for replacement',()=>{
 for(const [type,functionId] of [['encoder_tracking_motor','motor_pll'],['encoder_tracking_output','output_pll']]){
  const p=addAlgorithmChild(fixture(),'foc-observer',type),child=saved(p,'foc-observer').find(item=>item.type===type);child.parameters.pllBandwidthHz=42;
  const before=structuredClone(child),view=fixedFunctionPresentation(child);assert.equal(view.definition.id,functionId);assert.equal(view.fields[0][0],'pllBandwidthHz');assert.deepEqual(child,before);
  child.parameters.extraction='difference';assert.equal(fixedFunctionForChild(child),null);
  assert(algorithmChildrenIssues(p).some(issue=>issue.id===`algorithm-legacy-function-${child.id}`&&issue.level==='pending'));
  assert.deepEqual(saved(parseProject(serializeProject(p)),'foc-observer').find(item=>item.id===child.id),child);
 }
});

test('non-equivalent generic sources, custom outputs and names are never silently reinterpreted',()=>{
 let p=addAlgorithmChild(fixture(),'foc-observer','pll'),child=last(p,'foc-observer');child.routing.source='feedback.angle';child.parameters.bandwidthHz=100;
 assert.equal(fixedFunctionForChild(child),null);assert(algorithmChildrenIssues(p).some(issue=>issue.title==='旧功能待替换'&&issue.childId===child.id));
 child.routing.source='sensor.motor_angle';child.outputNames={speed:'custom-speed'};assert.equal(fixedFunctionForChild(child),null);
 child.outputNames={};child.routing.angleOutput='field:custom:angle';assert.equal(fixedFunctionForChild(child),null);
 const before=structuredClone(child),serialized=parseProject(serializeProject(p));assert.deepEqual(saved(serialized,'foc-observer').find(item=>item.id===child.id),before);
 const removed=removeAlgorithmChild(p,'foc-observer',child.id);assert(!saved(removed,'foc-observer').some(item=>item.id===child.id));assert.deepEqual(last(p,'foc-observer'),before);
});

test('fixed functions reject configurable identity and routing; duplicate legacy equivalents remain explicit',()=>{
 let p=addAlgorithmChild(fixture(),'foc-filter','load_torque_low_pass'),child=last(p,'foc-filter');
 const bad=structuredClone(child);bad.id='changed';assert.throws(()=>checkAlgorithmChildren([bad],'foc-filter'),/标识不能修改/);
 bad.id=child.id;bad.routing={source:'sensor.torque'};assert.throws(()=>checkAlgorithmChildren([bad],'foc-filter'),/连接字段无效/);
 p=addAlgorithmChild(p,'foc-filter','low_pass');last(p,'foc-filter').routing.source='sensor.torque';
 assert(algorithmChildrenIssues(p).some(issue=>issue.title==='固定功能重复'));
 assert.equal(saved(p,'foc-filter').filter(item=>item.compiled).length,2);
});


test('existing compensators keep their fixed semantics and only customized old routes need replacement',()=>{
 let p=fixture();
 for(const type of ['friction','angle_delay','current_calibration']){
  p=addAlgorithmChild(p,'foc-compensation',type);const child=saved(p,'foc-compensation').find(item=>item.type===type);
  assert.equal(fixedFunctionPresentation(child).legacy,false);
 }
 const friction=saved(p,'foc-compensation').find(item=>item.type==='friction');friction.routing.source='smo.speed';
 assert.equal(fixedFunctionPresentation(friction).legacy,true);
 assert(algorithmChildrenIssues(p).some(issue=>issue.title==='旧补偿连接待替换'&&issue.childId===friction.id));
 assert.equal(saved(p,'foc-compensation').find(item=>item.id===friction.id).routing.source,'smo.speed');
});
