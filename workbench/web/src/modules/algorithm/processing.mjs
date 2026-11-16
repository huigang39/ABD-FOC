import { addAlgorithmChild, updateAlgorithmRouting } from './children.mjs';
import { algorithmInstances, REPEATABLE_ALGORITHM_TYPES, availableAlgorithmSignals, algorithmSignalAvailable, resolveAlgorithmSignal, instanceSignalReference, parseInstanceSignalReference, signalCompatibleWithProcessingType } from './signals.mjs';

export const PROCESSING_TYPES=Object.freeze([
 {id:'pll',title:'PLL',moduleId:'foc-observer'},
 {id:'low_pass',title:'低通',moduleId:'foc-filter'},
 {id:'notch',title:'陷波',moduleId:'foc-filter'},
].map(Object.freeze));
export const PROCESSING_PRESETS=Object.freeze([
 {id:'motor-speed',title:'电机轴转速',sourceRef:'sensor.motor_angle',types:['pll'],name:'电机轴 PLL'},
 {id:'output-speed',title:'出轴转速',sourceRef:'sensor.output_angle',types:['pll'],name:'出轴 PLL'},
 {id:'load-torque',title:'负载力矩',sourceRef:'sensor.torque',types:['low_pass'],name:'负载力矩低通'},
].map(preset=>Object.freeze({...preset,types:Object.freeze(preset.types)})));

/** Every instance publishes stable independent signals, even before they are consumed. */
export function processingOutputs(project,child) {
 if(!REPEATABLE_ALGORITHM_TYPES.has(child?.type))return [];
 return (child.type==='pll'?['angle','speed']:['output']).map(port=>resolveAlgorithmSignal(project,instanceSignalReference(child.id,port))).filter(Boolean);
}
export function compatibleProcessingTypes(project,sourceRef) {
 const signal=resolveAlgorithmSignal(project,sourceRef);
 if(!algorithmSignalAvailable(project,sourceRef))return [];
 return PROCESSING_TYPES.filter(type=>signalCompatibleWithProcessingType(signal,type.id)).map(type=>({...type}));
}
export function processingPresetAvailability(project,presetId) {
 const preset=PROCESSING_PRESETS.find(item=>item.id===presetId);
 if(!preset)return {available:false,reason:'处理预设不存在。'};
 const available=availableAlgorithmSignals(project,{type:preset.types[0]}).some(signal=>signal.id===preset.sourceRef);
 return {available,reason:available?'':presetId==='load-torque'?'先配置力矩传感器及接收外设。':`先配置${presetId==='motor-speed'?'电机轴':'出轴'}编码器及接收外设。`};
}
export function processingPresetChoices(project) {
 return PROCESSING_PRESETS.map(preset=>{const status=processingPresetAvailability(project,preset.id);return {...preset,disabled:!status.available,reason:status.reason};});
}
export function appendProcessingNode(project,sourceRef,type) {
 const definition=compatibleProcessingTypes(project,sourceRef).find(item=>item.id===type);
 if(!definition)throw Error('请选择已配置且物理量兼容的输入数据与处理方式。');
 const next=addAlgorithmChild(project,definition.moduleId,type);
 const child=next.instances[definition.moduleId].parameters.children.at(-1);
 return updateAlgorithmRouting(next,definition.moduleId,child.id,'source',sourceRef);
}
export function addProcessingPreset(project,presetId) {
 const preset=PROCESSING_PRESETS.find(item=>item.id===presetId),status=processingPresetAvailability(project,presetId);
 if(!preset||!status.available)throw Error(status.reason);
 let next=project,sourceRef=preset.sourceRef;
 for(const type of preset.types){
  next=appendProcessingNode(next,sourceRef,type);
  const moduleId=PROCESSING_TYPES.find(item=>item.id===type).moduleId,child=next.instances[moduleId].parameters.children.at(-1);
  const peers=algorithmInstances(next).filter(item=>item.child.id!==child.id),names=new Set(peers.map(item=>item.child.name));
  let name=preset.name,index=2;while(names.has(name))name=`${preset.name} ${index++}`;
  child.name=name;
  sourceRef=instanceSignalReference(child.id,type==='pll'?'speed':'output');
 }
 return next;
}

/** Group source-connected nodes without losing branches, missing sources, or cycles. */
export function processingChains(project) {
 const nodes=algorithmInstances(project).filter(({child})=>child.compiled&&REPEATABLE_ALGORITHM_TYPES.has(child.type)).map(({moduleId,child})=>({moduleId,child,sourceRef:child.routing?.source||'',outputs:processingOutputs(project,child)}));
 const byId=new Map(nodes.map(node=>[node.child.id,node]));
 function ancestry(node) {
  let current=node;const path=[],seen=new Set();
  while(current){
   if(seen.has(current.child.id)){
    const cycleIds=path.slice(path.indexOf(current.child.id)).sort();
    return {id:`cycle:${cycleIds[0]}`,sourceRef:'',cycle:true};
   }
   seen.add(current.child.id);path.push(current.child.id);
   const parentId=parseInstanceSignalReference(current.sourceRef)?.id,parent=byId.get(parentId);
   if(!parent)return {id:current.sourceRef||`unconnected:${current.child.id}`,sourceRef:current.sourceRef,cycle:false};
   current=parent;
  }
 }
 const groups=new Map();
 for(const node of nodes){
  const root=ancestry(node);let group=groups.get(root.id);
  if(!group){group={...root,source:resolveAlgorithmSignal(project,root.sourceRef),nodes:[]};groups.set(root.id,group);}
  group.nodes.push(node);
 }
 return [...groups.values()].map(group=>{
  const remaining=new Set(group.nodes),ordered=[],visited=new Set();
  function visit(node,depth){
   if(visited.has(node))return;visited.add(node);remaining.delete(node);
   const parentId=parseInstanceSignalReference(node.sourceRef)?.id;
   ordered.push({...node,depth,parentId:byId.has(parentId)?parentId:null});
   for(const candidate of group.nodes)if(parseInstanceSignalReference(candidate.sourceRef)?.id===node.child.id)visit(candidate,depth+1);
  }
  for(const node of group.nodes)if(!byId.has(parseInstanceSignalReference(node.sourceRef)?.id))visit(node,0);
  while(remaining.size)visit(remaining.values().next().value,0);
  return {...group,nodes:ordered};
 });
}
