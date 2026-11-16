import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, serializeProject, parseProject } from '../web/src/core/model.mjs';
import { applyBuiltinDriverModel, sensorIssues } from '../web/src/modules/hardware/hw-drivers/sensors.mjs';
import { driverConfigurationIssues } from '../native/generator/drivers.mjs';
import { createResource } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { addAlgorithmChild, algorithmChildrenIssues, checkAlgorithmChildren, removeAlgorithmChild, updateAlgorithmRouting } from '../web/src/modules/algorithm/children.mjs';
import { availableAlgorithmSignals, algorithmSignalAvailable, algorithmRouteChoices, instanceSignalReference, resolveAlgorithmSignal } from '../web/src/modules/algorithm/signals.mjs';
import { updateAlgorithmOutputName } from '../web/src/modules/algorithm/editing.mjs';
import { PROCESSING_PRESETS, addProcessingPreset, appendProcessingNode, compatibleProcessingTypes, processingChains, processingOutputs, processingPresetChoices } from '../web/src/modules/algorithm/processing.mjs';
const item=(p,id)=>Object.values(p.instances).flatMap(instance=>instance.parameters.children||[]).find(child=>child.id===id);
const last=(p,moduleId)=>p.instances[moduleId].parameters.children.at(-1);
const ids=signals=>signals.map(signal=>signal.id);
const errors=(p,id)=>algorithmChildrenIssues(p).filter(issue=>issue.level==='error'&&(!id||issue.childId===id));
function fixture(){
 const p=createProject(),drivers=p.instances['hw-drivers'].parameters,board=p.instances['hw-board'].parameters;
 Object.assign(board,{pwmHz:20000,currentLoopDivider:1});
 for(const [index,prefix,capability,model] of [[1,'motorEncoder','encoderCapability','gongwang'],[2,'outputEncoder','outputEncoderCapability','jingang'],[3,'torqueSensor','torqueCapability','KW']]){
  const resource=createResource('uart',`serial-${index}`);resource.instance=`USART${index}`;resource.settings.physical='rs485';resource.pins.RX=`P${index}`;
  board.resources.push(resource);Object.assign(drivers,{[capability]:'present',[prefix+'Model']:model,[prefix+'Resource']:resource.id,[prefix+'AngleDomain']:'mechanical'});
 }
 delete drivers.torqueSensorAngleDomain;drivers.torqueSensorUnit='nm';
 return p;
}

test('menus list configured hardware and typed processing producers, retaining unavailable selections',()=>{
 const empty=createProject();assert.deepEqual(availableAlgorithmSignals(empty),[]);
 let p=fixture();assert.deepEqual(ids(availableAlgorithmSignals(p,{type:'pll'})),['sensor.motor_angle','sensor.output_angle']);
 assert.deepEqual(ids(availableAlgorithmSignals(p,{type:'low_pass'})),['feedback.speed','sensor.torque']);
 assert.deepEqual(processingPresetChoices(p).map(preset=>preset.disabled),[false,false,false]);
 const before=structuredClone(p);p=addProcessingPreset(p,'motor-speed');assert.deepEqual(before.instances['foc-observer'].parameters.children,[]);
 const pll=last(p,'foc-observer'),speed=instanceSignalReference(pll.id,'speed');
 assert(ids(availableAlgorithmSignals(p,{type:'low_pass'})).includes(speed));
 assert(!ids(availableAlgorithmSignals(p,{type:'low_pass'})).includes(instanceSignalReference(pll.id,'angle')));
 p.instances['hw-drivers'].parameters.motorEncoderResource='missing';
 assert(!algorithmSignalAvailable(p,speed));assert(!ids(availableAlgorithmSignals(p,{type:'pll'})).includes('sensor.motor_angle'));
 const choices=algorithmRouteChoices(p,'foc-observer',pll,'source');assert.match(choices.find(([id])=>id==='sensor.motor_angle')[1],/待检查/);
 assert(errors(p,pll.id).some(issue=>issue.message.includes('尚未完成配置')));
});

test('resource binding, sensor quantities and assigned sampling channels determine source availability',()=>{
 const p=fixture(),drivers=p.instances['hw-drivers'].parameters,board=p.instances['hw-board'].parameters;
 drivers.torqueSensorUnit='raw';assert(algorithmSignalAvailable(p,'sensor.torque'));drivers.torqueSensorUnit='nm';assert(algorithmSignalAvailable(p,'sensor.torque'));
 drivers.motorEncoderAngleDomain='electrical';assert(!algorithmSignalAvailable(p,'sensor.motor_angle'));drivers.motorEncoderAngleDomain='mechanical';
 const port=board.resources.find(resource=>resource.id===drivers.outputEncoderResource);port.pins.RX='';assert(!algorithmSignalAvailable(p,'sensor.output_angle'));port.pins.RX='PD6';
 p.instances['hw-drivers'].runtimeEnabled=false;assert(!algorithmSignalAvailable(p,'sensor.output_angle'));p.instances['hw-drivers'].runtimeEnabled=true;
 assert(!algorithmSignalAvailable(p,'sampling.bus_voltage'));
 const bus=board.resources.find(resource=>resource.preset==='bus-voltage');bus.instance='ADC1';bus.pins={INP2:'PA2'};assert(algorithmSignalAvailable(p,'sampling.bus_voltage'));
 const currents=board.resources.filter(resource=>resource.preset==='phase-current');
 for(const [index,current] of currents.entries()){current.instance=`ADC${index+1}`;current.pins={[`INP${index}`]:`PA${index}`};}
 assert(algorithmSignalAvailable(p,'sampling.current_u'));assert(!ids(availableAlgorithmSignals(p,{type:'low_pass'})).includes('sampling.current'));assert(!ids(availableAlgorithmSignals(p)).includes('sampling.current'));assert(ids(availableAlgorithmSignals(p,{type:'current_calibration'})).includes('sampling.current'));
 currents[0].pins={};assert(!algorithmSignalAvailable(p,'sampling.current_u'));
});

test('presets create independently named signals without invented tuning or consumer changes',()=>{
 let p=fixture();const consumer=structuredClone(p.instances['app-motion'].parameters);
 for(const preset of PROCESSING_PRESETS)p=addProcessingPreset(p,preset.id);
 const chains=processingChains(p);assert.equal(chains.length,3);
 assert.deepEqual(chains.map(chain=>chain.nodes[0].child.name),['电机轴 PLL','出轴 PLL','负载力矩低通']);
 assert.deepEqual(chains.map(chain=>chain.nodes[0].outputs.map(output=>output.quantity)),[['motor-angle','motor-speed'],['output-angle','output-speed'],['sensor-torque']]);
 assert(chains.every(chain=>Object.values(chain.nodes[0].child.parameters).every(value=>value===null)));
 assert(chains.every(chain=>Object.entries(chain.nodes[0].child.routing).filter(([key])=>key!=='source').every(([,value])=>value==='none')));
 assert(!errors(p).some(issue=>issue.message.includes('至少选择一个输出')));assert.deepEqual(p.instances['app-motion'].parameters,consumer);
 p=addProcessingPreset(p,'motor-speed');assert.equal(last(p,'foc-observer').name,'电机轴 PLL 2');
 assert.throws(()=>addProcessingPreset(createProject(),'motor-speed'),/先配置/);
});

test('append keeps independent branches and filtering preserves the exact source quantity',()=>{
 let p=addProcessingPreset(fixture(),'motor-speed');const pll=last(p,'foc-observer'),speed=instanceSignalReference(pll.id,'speed');
 assert.deepEqual(compatibleProcessingTypes(p,instanceSignalReference(pll.id,'angle')).map(type=>type.id),['pll']);
 assert.deepEqual(compatibleProcessingTypes(p,speed).map(type=>type.id),['low_pass','notch']);
 p=appendProcessingNode(p,speed,'low_pass');const low=last(p,'foc-filter');p=appendProcessingNode(p,speed,'notch');const notch=last(p,'foc-filter');
 assert.equal(low.routing.source,speed);assert.equal(notch.routing.source,speed);assert.equal(resolveAlgorithmSignal(p,instanceSignalReference(low.id,'output')).quantity,'motor-speed');
 assert.throws(()=>appendProcessingNode(p,instanceSignalReference(pll.id,'angle'),'low_pass'),/物理量兼容/);
 const group=processingChains(p)[0];assert.deepEqual(group.nodes.map(node=>[node.child.id,node.depth,node.parentId]),[[pll.id,0,null],[low.id,1,pll.id],[notch.id,1,pll.id]]);
 assert.deepEqual(ids(availableAlgorithmSignals(p,{type:'low_pass',excludeChildId:low.id})).filter(id=>id===instanceSignalReference(low.id,'output')),[]);
 const original=structuredClone(p);p=removeAlgorithmChild(p,'foc-observer',pll.id);
 assert.equal(item(p,low.id).routing.source,speed);assert.equal(processingChains(p)[0].source,null);assert.deepEqual(processingChains(p)[0].nodes.map(node=>node.child.id),[low.id,notch.id]);assert(item(original,pll.id));
});

test('downstream, disabled and cyclic nodes are not candidates while chains remain editable',()=>{
 let p=addProcessingPreset(fixture(),'load-torque');const low=last(p,'foc-filter'),lowSignal=instanceSignalReference(low.id,'output');
 p=appendProcessingNode(p,lowSignal,'notch');const notch=last(p,'foc-filter'),notchSignal=instanceSignalReference(notch.id,'output');
 assert(!ids(availableAlgorithmSignals(p,{type:'low_pass',excludeChildId:low.id})).includes(notchSignal));
 item(p,notch.id).enabled=false;assert(!algorithmSignalAvailable(p,notchSignal));item(p,notch.id).enabled=true;
 p=updateAlgorithmRouting(p,'foc-filter',low.id,'source',notchSignal);
 assert(!algorithmSignalAvailable(p,notchSignal));assert(processingChains(p)[0].cycle);assert.equal(processingChains(p)[0].nodes.length,2);
 assert(errors(p).some(issue=>issue.id==='algorithm-routing-cycle'));assert.doesNotThrow(()=>JSON.stringify(processingChains(p)));
});

test('output renaming changes presentation only and round trips strict optional names',()=>{
 let p=addProcessingPreset(fixture(),'motor-speed'),pll=last(p,'foc-observer');const signal=instanceSignalReference(pll.id,'speed');
 const before=structuredClone(p);p=updateAlgorithmOutputName(p,'foc-observer',pll.id,'speed','电机转速');
 assert.equal(resolveAlgorithmSignal(p,signal).label,'电机转速');assert.equal(resolveAlgorithmSignal(p,signal).quantity,'motor-speed');assert.deepEqual(before.instances['foc-observer'].parameters.children.at(-1).outputNames,undefined);
 p=parseProject(serializeProject(p));assert.equal(resolveAlgorithmSignal(p,signal).label,'电机转速');
 const outputs=processingOutputs(p,item(p,pll.id));assert.deepEqual(outputs.map(output=>output.port),['angle','speed']);assert.match(outputs[1].automaticLabel,/电机轴 PLL/);
 p=updateAlgorithmOutputName(p,'foc-observer',pll.id,'speed','');assert.equal(resolveAlgorithmSignal(p,signal).label,outputs[1].automaticLabel);
 assert.throws(()=>updateAlgorithmOutputName(p,'foc-observer',pll.id,'output','bad'),/输出名称格式/);
 assert.throws(()=>updateAlgorithmOutputName(p,'foc-observer',pll.id,'angle','x'.repeat(121)),/120/);
 const invalid=structuredClone(item(p,pll.id));invalid.outputNames={angle:7};assert.throws(()=>checkAlgorithmChildren([invalid],'foc-observer'),/输出名称格式/);
});

test('compiled legacy model observer results appear only when enabled and never leak an invalid source',()=>{
 let p=fixture();assert(!ids(availableAlgorithmSignals(p,{type:'pll'})).includes('smo.angle'));
 p=addAlgorithmChild(p,'foc-observer','smo');assert(ids(availableAlgorithmSignals(p,{type:'pll'})).includes('smo.angle'));
 p.instances['foc-observer'].parameters.children.find(child=>child.type==='smo').enabled=false;assert(!ids(availableAlgorithmSignals(p,{type:'pll'})).includes('smo.angle'));
});


test('a newly selected torque driver exposes logical load torque while unit and conversion readiness remain blocked',()=>{
 let p=createProject();const drivers=p.instances['hw-drivers'].parameters,board=p.instances['hw-board'].parameters;
 const port=createResource('uart','torque-port');Object.assign(port,{instance:'USART3',pins:{RX:'PD9'}});port.settings.physical='rs485';board.resources.push(port);
 applyBuiltinDriverModel(drivers,'torqueSensor','KW',board.resources);
 assert.equal(drivers.torqueSensorResource,port.id);assert.equal(drivers.torqueSensorUnit,'unselected');assert.equal(drivers.torqueSensorScale,null);
 assert(algorithmSignalAvailable(p,'sensor.torque'));assert.equal(resolveAlgorithmSignal(p,'sensor.torque').quantity,'sensor-torque');assert.equal(resolveAlgorithmSignal(p,'sensor.torque').unit,'N·m');assert.equal(resolveAlgorithmSignal(p,'sensor.torque').representation,'normalized');
 assert.equal(processingPresetChoices(p).find(preset=>preset.id==='load-torque').disabled,false);
 p=addProcessingPreset(p,'load-torque');const filter=last(p,'foc-filter');assert.equal(filter.routing.source,'sensor.torque');assert.equal(processingOutputs(p,filter)[0].quantity,'sensor-torque');
 assert(sensorIssues(p.instances['hw-drivers'].parameters).some(issue=>issue.paramKey==='torqueSensorUnit'&&issue.level==='pending'));
 assert(driverConfigurationIssues(p.instances['hw-drivers'].parameters).some(issue=>issue.paramKey==='torqueSensorUnit'));
 p.instances['hw-drivers'].parameters.torqueSensorUnit='raw';
 assert(algorithmSignalAvailable(p,'sensor.torque'));
 assert(sensorIssues(p.instances['hw-drivers'].parameters).some(issue=>issue.paramKey==='torqueSensorScale'&&issue.level==='pending'));
 assert(driverConfigurationIssues(p.instances['hw-drivers'].parameters).some(issue=>issue.paramKey==='torqueSensorScale'));
 assert.equal(p.instances['hw-drivers'].parameters.torqueSensorScale,null);
});
