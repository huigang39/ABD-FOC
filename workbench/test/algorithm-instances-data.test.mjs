import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,parseProject,serializeProject} from '../web/src/core/model.mjs';
import {createResource} from '../web/src/modules/hardware/hw-board/resources.mjs';
import {addAlgorithmChild,removeAlgorithmChild,fixedAlgorithmChildren,checkAlgorithmChildren,updateAlgorithmRouting,algorithmChildrenIssues,algorithmExecutionPlan,observerOutputIssues,observerUsesModelAngle} from '../web/src/modules/algorithm/children.mjs';
import {algorithmRouteChoices,resolveAlgorithmSignal,instanceSignalReference,fieldReference,resolveOutputField,algorithmSampleFrequency,signalChoices} from '../web/src/modules/algorithm/signals.mjs';
const children=(p,module='foc-observer')=>p.instances[module].parameters.children;
const get=(p,id)=>Object.values(p.instances).flatMap(instance=>instance.parameters.children||[]).find(child=>child.id===id);
function add(p,module,type){const next=addAlgorithmChild(p,module,type);return [next,children(next,module).at(-1).id];}
function target(p,module,name){const s=p.design.structures.find(s=>s.id===p.design.moduleContracts[module].output);return fieldReference(s.id,s.fields.find(f=>f.name===name).id);}
const issues=(p,id)=>algorithmChildrenIssues(p).filter(issue=>issue.level==='error'&&(!id||issue.childId===id));
function fixture(){
 const p=createProject();Object.assign(p.instances['hw-board'].parameters,{pwmHz:20000,currentLoopDivider:1});
 const drivers=p.instances['hw-drivers'].parameters;
 Object.assign(drivers,{encoderCapability:'present',outputEncoderCapability:'present',torqueCapability:'present',torqueSensorUnit:'nm'});
 for(const [index,prefix,model] of [[1,'motorEncoder','gongwang'],[2,'outputEncoder','jingang'],[3,'torqueSensor','KW']]){
  const resource=createResource('uart',`test-port-${index}`);resource.instance=`USART${index}`;resource.settings.physical='rs485';resource.pins.RX=`P${index}`;
  p.instances['hw-board'].parameters.resources.push(resource);Object.assign(drivers,{[prefix+'Model']:model,[prefix+'Resource']:resource.id});
 }
 return p;
}
function configure(p,id,source,outputKey,output){const c=get(p,id);c.routing.source=source;if(outputKey)c.routing[outputKey]=output;Object.assign(c.parameters,c.type==='pll'?{bandwidthHz:100}:c.type==='low_pass'?{cutoffHz:100}:{frequencyHz:1000,q:2});}

test('repeatable instances preserve UUIDs and independent routes through edit, save and removal',()=>{
 let p=fixture();assert(!fixedAlgorithmChildren(p,'foc-observer').some(c=>c.type==='pll'));assert.deepEqual(fixedAlgorithmChildren(p,'foc-filter'),[]);
 let a,b;[p,a]=add(p,'foc-observer','pll');[p,b]=add(p,'foc-observer','pll');
 assert.notEqual(a,b);assert.equal(get(p,a).name,'PLL 1');assert.equal(get(p,b).name,'PLL 2');
 p=updateAlgorithmRouting(p,'foc-observer',a,'source','sensor.motor_angle');p=updateAlgorithmRouting(p,'foc-observer',b,'source','sensor.output_angle');
 assert.equal(get(p,a).routing.source,'sensor.motor_angle');assert.equal(get(p,b).routing.source,'sensor.output_angle');
 p=parseProject(serializeProject(p));assert(get(p,a));assert(get(p,b));
 p=removeAlgorithmChild(p,'foc-observer',a);assert(!get(p,a));assert.equal(get(p,b).routing.source,'sensor.output_angle');
 checkAlgorithmChildren(children(p));
});

test('PLL target choices enforce coordinate domains, stable field semantics and source edits retain invalid targets',()=>{
 let p=fixture(),id;[p,id]=add(p,'foc-observer','pll');configure(p,id,'sensor.motor_angle','angleOutput',target(p,'foc-observer','motor_angle'));
 assert(algorithmRouteChoices(p,'foc-observer',get(p,id),'angleOutput').some(([value])=>value===target(p,'foc-observer','motor_angle')));
 assert(!algorithmRouteChoices(p,'foc-observer',get(p,id),'angleOutput').some(([value])=>value===target(p,'foc-observer','angle')));
 const beforeTarget=get(p,id).routing.angleOutput;p=updateAlgorithmRouting(p,'foc-observer',id,'source','sensor.output_angle');
 assert.equal(get(p,id).routing.angleOutput,beforeTarget);assert(issues(p,id).some(i=>i.id.endsWith('angleOutput')));
 const s=p.design.structures.find(s=>s.id===p.design.moduleContracts['foc-observer'].output);s.fields.find(f=>f.name==='motor_angle').name='renamed_angle';
 assert.equal(resolveOutputField(p,'foc-observer',beforeTarget).quantity,'motor-angle');assert(issues(p,id).some(i=>i.id.endsWith('angleOutput')));
});

test('saved scalar filters retain their typed routes while angle filtering is explicitly invalid',()=>{
 let p=fixture(),a,b,c;[p,a]=add(p,'foc-observer','pll');[p,b]=add(p,'foc-filter','low_pass');[p,c]=add(p,'foc-observer','pll');
 configure(p,a,'sensor.motor_angle');configure(p,b,instanceSignalReference(a,'angle'));configure(p,c,instanceSignalReference(b,'output'),'angleOutput',target(p,'foc-observer','motor_angle'));
 assert.equal(resolveAlgorithmSignal(p,instanceSignalReference(b,'output')).quantity,'motor-angle');
 assert.equal(resolveAlgorithmSignal(p,instanceSignalReference(c,'speed')).quantity,'motor-speed');
 const choices=signalChoices('low_pass',p,get(p,b)).map(([id])=>id);
 for(const id of ['sampling.bus_voltage','sampling.current_u','sampling.current_v','sampling.current_w','sensor.torque'])assert(choices.includes(id),id);
 const menu=algorithmRouteChoices(p,'foc-filter',get(p,b),'source');assert(menu.some(([id])=>id==='sensor.torque'));assert.equal(menu.at(-1)[0],instanceSignalReference(a,'angle'));assert.match(menu.at(-1)[1],/待检查/);
 assert(!choices.includes('sampling.current'));
 assert(issues(p,b).some(issue=>issue.message.includes('物理量不匹配')));
 assert.deepEqual(algorithmExecutionPlan(p).order,[a,b,c]);
 p.instances['hw-drivers'].parameters.torqueSensorUnit='raw';assert.equal(resolveAlgorithmSignal(p,'sensor.torque').quantity,'sensor-torque');
});

test('custom scalar output fields inherit source domain while input/state, arrays and wrong units are excluded',()=>{
 let p=fixture(),id;[p,id]=add(p,'foc-observer','pll');configure(p,id,'sensor.output_angle');
 p.design.structures.push({id:'user-output',name:'UserOutput',owner:'foc-observer',consumers:[],description:'',rate:'fast',fields:[{id:'a',name:'angle',type:'f32',count:1,unit:'rad',meaning:''},{id:'array',name:'angles',type:'f32',count:2,unit:'rad',meaning:''},{id:'voltage',name:'voltage',type:'f32',count:1,unit:'V',meaning:''}]});
 const ref=fieldReference('user-output','a');get(p,id).routing.angleOutput=ref;
 const options=algorithmRouteChoices(p,'foc-observer',get(p,id),'angleOutput').map(([id])=>id);
 assert(options.includes(ref));assert(!options.includes(fieldReference('user-output','array')));assert(!options.includes(fieldReference('user-output','voltage')));
 assert.equal(resolveOutputField(p,'foc-observer',ref).quantity,'output-angle');
 assert.equal(resolveOutputField(p,'foc-observer',fieldReference(p.design.moduleContracts['foc-observer'].input,'foc-observer-input-measured_angle')),null);
 assert.deepEqual(issues(p,id),[]);
});

test('output writers conflict across instances and with legacy publish slots; renamed fields do not bypass checks',()=>{
 let p=fixture(),a,b;[p,a]=add(p,'foc-observer','pll');[p,b]=add(p,'foc-observer','pll');
 const output=target(p,'foc-observer','angle');configure(p,a,'feedback.angle','angleOutput',output);configure(p,b,'feedback.angle','angleOutput',output);
 p.instances['foc-observer'].parameters.angleOutput='smo.angle';
 const outputStructure=p.design.structures.find(s=>s.id===p.design.moduleContracts['foc-observer'].output);outputStructure.fields.find(f=>f.id==='foc-observer-output-angle').name='renamed_angle';
 const conflicts=issues(p).filter(i=>i.title==='输出字段重复写入');assert.equal(conflicts.length,3);assert(conflicts.every(i=>i.messageParts.some(part=>part.type==='reference')));
 get(p,b).routing.angleOutput='none';p.instances['foc-observer'].parameters.angleOutput='none';
 assert(!issues(p).some(i=>i.title==='输出字段重复写入'));
});

test('cycles, missing producers, runtime-disabled inputs, frequency limits and duplicate cross-module IDs are explicit errors',()=>{
 let p=fixture(),a,b;[p,a]=add(p,'foc-observer','pll');[p,b]=add(p,'foc-filter','notch');
 configure(p,a,'sensor.motor_angle','angleOutput',target(p,'foc-observer','motor_angle'));configure(p,b,instanceSignalReference(a,'speed'));
 get(p,a).routing.source=instanceSignalReference(b,'output');assert.equal(algorithmExecutionPlan(p).cycle,true);assert(issues(p).some(i=>i.id==='algorithm-routing-cycle'));
 get(p,a).routing.source='sensor.motor_angle';get(p,a).enabled=false;assert(issues(p,b).some(i=>i.message.includes('未启用运行')));
 get(p,a).enabled=true;get(p,b).parameters.frequencyHz=10000;assert.equal(algorithmSampleFrequency(p),20000);assert(issues(p,b).some(i=>i.id.endsWith('-rate')));
 get(p,b).parameters.q=0;assert(issues(p,b).some(i=>i.id.endsWith('-q')));
 get(p,b).id=a;assert(issues(p).some(i=>i.title==='实例标识重复'));
});

test('PLL electrical output satisfies publication and follows model-based sources without implicit electrical conversion',()=>{
 let p=fixture(),id;[p,id]=add(p,'foc-observer','pll');configure(p,id,'smo.angle','angleOutput',target(p,'foc-observer','angle'));
 p.instances['foc-feedback'].parameters.angleSource='observer';
 p.design.structures.find(s=>s.id===p.design.moduleContracts['foc-observer'].output).fields.find(f=>f.id==='foc-observer-output-angle').name='renamed_angle';
 assert(!observerOutputIssues(p).some(i=>i.paramKey==='angleOutput'));assert.equal(observerUsesModelAngle(p),true);
 get(p,id).routing.source='feedback.angle';assert.equal(algorithmExecutionPlan(p).cycle,true);
 get(p,id).routing.source='sensor.motor_angle';assert(issues(p,id).some(i=>i.id.endsWith('angleOutput')));
});

test('repeatable capacity is rejected before returning invalid persisted data',()=>{
 let p=fixture();for(let i=0;i<32;i++)p=addAlgorithmChild(p,'foc-filter','low_pass');
 const before=structuredClone(p);assert.throws(()=>addAlgorithmChild(p,'foc-filter','notch'),/32/);assert.deepEqual(p,before);
});


test('instance source menus follow configured sources and keep saved unavailable input visible',()=>{
 let p=createProject(),pll,low,notch;[p,pll]=add(p,'foc-observer','pll');[p,low]=add(p,'foc-filter','low_pass');[p,notch]=add(p,'foc-filter','notch');
 assert.deepEqual(algorithmRouteChoices(p,'foc-observer',get(p,pll),'source'),[['','—']]);
 for(const id of [low,notch])assert.deepEqual(algorithmRouteChoices(p,'foc-filter',get(p,id),'source'),[['','—']]);
 p=updateAlgorithmRouting(p,'foc-filter',low,'source','sensor.torque');
 assert.equal(get(parseProject(serializeProject(p)),low).routing.source,'sensor.torque');
 assert(issues(p,low).some(issue=>issue.id.endsWith('-source')));
 assert.match(algorithmRouteChoices(p,'foc-filter',get(p,low),'source').at(-1)[1],/待检查/);
 p=updateAlgorithmRouting(p,'foc-observer',pll,'source','smo.angle');
 const retained=algorithmRouteChoices(p,'foc-observer',get(p,pll),'source');
 assert.equal(retained.at(-1)[0],'smo.angle');assert.match(retained.at(-1)[1],/待检查/);
 for(const source of ['smo.angle','flux.angle'])assert.equal(resolveAlgorithmSignal(p,source).module,'foc-observer');
});

test('an algorithm type in the wrong module is rejected explicitly',()=>{
 let p=fixture(),id;[p,id]=add(p,'foc-observer','pll');const misplaced=structuredClone(get(p,id));
 assert.throws(()=>checkAlgorithmChildren([misplaced],'foc-filter'),/格式无效/);
 children(p,'foc-filter').push(misplaced);
 assert(issues(p,id).some(issue=>issue.title==='算法实例所属模块不匹配'&&issue.moduleId==='foc-filter'));
});
