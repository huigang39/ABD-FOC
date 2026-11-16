import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,parseProject,serializeProject} from '../web/src/core/model.mjs';
import {createResource} from '../web/src/modules/hardware/hw-board/resources.mjs';
import {addAlgorithmChild,removeAlgorithmChild,algorithmChildrenIssues,algorithmExecutionPlan,checkAlgorithmChildren,updateAlgorithmRouting} from '../web/src/modules/algorithm/children.mjs';
import {fixedFunctionDefinition,fixedFunctionForChild,fixedFunctionChoices,effectiveAlgorithmRouting} from '../web/src/modules/algorithm/fixed-functions.mjs';
import {algorithmInputEntries,fixedInputCompatible,resolveAlgorithmSignal,algorithmSignalAvailable} from '../web/src/modules/algorithm/signals.mjs';
const dynamicType='load_torque_motor_speed_notch';
const children=(p,moduleId)=>p.instances[moduleId].parameters.children;
const node=(p,type)=>Object.values(p.instances).flatMap(instance=>instance.parameters.children||[]).find(child=>child.type===type);
const errors=p=>algorithmChildrenIssues(p).filter(issue=>issue.level==='error'&&issue.childId===dynamicType);
function fixture(){
 let p=createProject();const board=p.instances['hw-board'].parameters,drivers=p.instances['hw-drivers'].parameters;
 Object.assign(board,{pwmHz:20000,currentLoopDivider:1});
 for(const [prefix,capability,model,id] of [['motorEncoder','encoderCapability','gongwang','USART2'],['torqueSensor','torqueCapability','KW','USART3']]){
  const port=createResource('uart',id);port.instance=id;port.pins.RX='PD9';port.settings.physical='rs485';board.resources.push(port);
  Object.assign(drivers,{[prefix+'Model']:model,[prefix+'Resource']:id,[capability]:'present'});
 }
 p=addAlgorithmChild(p,'foc-filter',dynamicType);return p;
}

test('dynamic notch defines eight optional positive multipliers, one Q, fixed dual inputs and series-bank formula',()=>{
 const p=fixture(),child=node(p,dynamicType),definition=fixedFunctionDefinition(dynamicType);
 assert.deepEqual(child.routing,{});assert.deepEqual(Object.keys(child.parameters),[...Array.from({length:8},(_,i)=>`multiplier${i+1}`),'q']);
 assert(Object.values(child.parameters).every(value=>value===null));
 assert.deepEqual(effectiveAlgorithmRouting(child),{source:'sensor.torque',motorSpeed:'motor_pll.speed'});
 assert.deepEqual(algorithmInputEntries(child).map(input=>[input.key,input.quantity,input.unit]),[['source','sensor-torque','N·m'],['motorSpeed','motor-speed','rad/s']]);
 assert.deepEqual(definition.frequencyTracking,{topology:'series',maxStages:8,multiplierKeys:Array.from({length:8},(_,i)=>`multiplier${i+1}`),sharedQKey:'q',speedInput:'motorSpeed',formula:'abs(motorSpeed) / (2 * pi) * multiplier',unit:'Hz'});
 assert.throws(()=>updateAlgorithmRouting(p,'foc-filter',child.id,'motorSpeed','output_pll.speed'),/连接字段无效/);
 assert(!fixedInputCompatible(resolveAlgorithmSignal(p,'output_pll.speed'),definition.inputs[1]));
 assert(!fixedInputCompatible(resolveAlgorithmSignal(p,'feedback.angle'),definition.inputs[1]));
});

test('blank stages are skipped, at least one is required, decimal multipliers are valid and not treated as Hz',()=>{
 let p=fixture();p=addAlgorithmChild(p,'foc-observer','motor_pll');node(p,'motor_pll').parameters.bandwidthHz=100;
 const child=node(p,dynamicType);child.parameters.q=2;
 assert.deepEqual(errors(p).map(issue=>issue.id),[`algorithm-routing-${dynamicType}-multipliers`]);
 child.parameters.multiplier3=0.5;child.parameters.multiplier8=20000;
 assert.deepEqual(errors(p),[]);assert(!errors(p).some(issue=>issue.id.endsWith('-rate')));
 child.parameters.multiplier3=0;assert(errors(p).some(issue=>issue.id.endsWith('-multiplier3')));child.parameters.multiplier3=-0.5;assert(errors(p).some(issue=>issue.id.endsWith('-multiplier3')));
 child.parameters.multiplier3=null;child.parameters.q=0;assert(errors(p).some(issue=>issue.id.endsWith('-q')));
 child.parameters.q=2;assert.doesNotThrow(()=>checkAlgorithmChildren([child],'foc-filter'));
 child.parameters.multiplier1=Infinity;assert.throws(()=>checkAlgorithmChildren([child],'foc-filter'),/参数类型无效/);
});

test('motor-speed dependency must exist and run, carries a reference tag and precedes the filter',()=>{
 let p=fixture();node(p,dynamicType).parameters.multiplier1=1;node(p,dynamicType).parameters.q=2;
 let issue=errors(p).find(issue=>issue.id.endsWith('-motorSpeed'));assert(issue);assert(issue.messageParts.some(part=>part.type==='reference'&&part.label==='电机速度 PLL · 速度'));
 assert.equal(algorithmSignalAvailable(p,dynamicType+'.output'),false);
 p=addAlgorithmChild(p,'foc-observer','motor_pll');node(p,'motor_pll').parameters.bandwidthHz=100;
 assert.deepEqual(errors(p),[]);assert.equal(algorithmSignalAvailable(p,dynamicType+'.output'),true);
 assert.deepEqual(algorithmExecutionPlan(p).order,['motor_pll',dynamicType]);
 node(p,'motor_pll').enabled=false;assert(errors(p).some(issue=>issue.id.endsWith('-motorSpeed')&&issue.message.includes('未启用运行')));assert.equal(algorithmSignalAvailable(p,dynamicType+'.output'),false);
 node(p,'motor_pll').enabled=true;p=removeAlgorithmChild(p,'foc-observer','motor_pll');assert(errors(p).some(issue=>issue.id.endsWith('-motorSpeed')&&issue.message.includes('没有编译')));
 assert.deepEqual(node(p,dynamicType).routing,{});
});

test('equivalent legacy motor PLL supplies the fixed dependency without rewriting its identity',()=>{
 let p=fixture();p=addAlgorithmChild(p,'foc-observer','pll');const pll=children(p,'foc-observer').at(-1);pll.routing.source='sensor.motor_angle';pll.parameters.bandwidthHz=100;
 const id=pll.id;node(p,dynamicType).parameters.multiplier2=2.5;node(p,dynamicType).parameters.q=3;
 assert.equal(resolveAlgorithmSignal(p,'motor_pll.speed').childId,id);assert.deepEqual(errors(p),[]);assert.deepEqual(algorithmExecutionPlan(p).order,[id,dynamicType]);
 p=parseProject(serializeProject(p));assert.equal(node(p,'pll').id,id);assert.equal(node(p,dynamicType).parameters.multiplier2,2.5);
});

test('static notch stays retired static data and never becomes an eight-stage dynamic bank',()=>{
 let p=addAlgorithmChild(createProject(),'foc-filter','load_torque_notch');const old=node(p,'load_torque_notch');old.parameters.frequencyHz=123;old.parameters.q=4;
 const before=structuredClone(old);assert.equal(fixedFunctionDefinition(old.type).retired,true);assert(!fixedFunctionChoices(p,'foc-filter').some(choice=>choice.id===old.type));
 assert(fixedFunctionChoices(p,'foc-filter').some(choice=>choice.id===dynamicType));
 p=parseProject(serializeProject(p));assert.deepEqual(node(p,'load_torque_notch'),before);assert(!node(p,dynamicType));
 p=addAlgorithmChild(p,'foc-filter','notch');const generic=children(p,'foc-filter').at(-1);generic.routing.source='sensor.torque';generic.parameters.frequencyHz=50;generic.parameters.q=2;
 assert.equal(fixedFunctionForChild(generic).id,'load_torque_notch');assert.notEqual(fixedFunctionForChild(generic).id,dynamicType);
});
