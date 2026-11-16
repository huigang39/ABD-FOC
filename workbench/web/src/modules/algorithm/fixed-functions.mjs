/** Function identities own their input and output contracts; projects only tune parameters. */
const frequency={min:0,exclusiveMin:true,rateLimited:true};
const input=(key,reference,quantity,unit)=>({key,reference,quantity,unit});
const multiplierKeys=Array.from({length:8},(_,index)=>`multiplier${index+1}`);
const output=(id,port,label,quantity,unit)=>({id,port,label,quantity,unit,type:'f32',count:1});
export const FIXED_ALGORITHM_FUNCTIONS=Object.freeze([
 {id:'motor_pll',moduleId:'foc-observer',title:'电机速度 PLL',source:'sensor.motor_angle',inputs:[input('source','sensor.motor_angle','motor-angle','rad')],fields:[['bandwidthHz','带宽','Hz',{...frequency}]],outputs:[output('motor_pll.angle','angle','电机速度 PLL · 角度','motor-angle','rad'),output('motor_pll.speed','speed','电机速度 PLL · 速度','motor-speed','rad/s')]},
 {id:'output_pll',moduleId:'foc-observer',title:'出轴速度 PLL',source:'sensor.output_angle',inputs:[input('source','sensor.output_angle','output-angle','rad')],fields:[['bandwidthHz','带宽','Hz',{...frequency}]],outputs:[output('output_pll.angle','angle','出轴速度 PLL · 角度','output-angle','rad'),output('output_pll.speed','speed','出轴速度 PLL · 速度','output-speed','rad/s')]},
 {id:'load_torque_low_pass',moduleId:'foc-filter',title:'负载力矩低通滤波器',source:'sensor.torque',inputs:[input('source','sensor.torque','sensor-torque','N·m')],fields:[['cutoffHz','截止频率','Hz',{...frequency}]],outputs:[output('load_torque_low_pass.output','output','低通后的负载力矩','sensor-torque','N·m')]},
 {id:'load_torque_notch',moduleId:'foc-filter',title:'负载力矩静态陷波器（旧）',retired:true,source:'sensor.torque',inputs:[input('source','sensor.torque','sensor-torque','N·m')],fields:[['frequencyHz','中心频率','Hz',{...frequency}],['q','Q 值','',{min:0,exclusiveMin:true}]],outputs:[output('load_torque_notch.output','output','陷波后的负载力矩','sensor-torque','N·m')]},
 {id:'load_torque_motor_speed_notch',moduleId:'foc-filter',title:'负载力矩电机速度动态陷波器',source:'sensor.torque',inputs:[input('source','sensor.torque','sensor-torque','N·m'),input('motorSpeed','motor_pll.speed','motor-speed','rad/s')],fields:[...multiplierKeys.map((key,index)=>[key,`倍频系数 ${index+1}`,'倍',{min:0,exclusiveMin:true,optional:true}]),['q','Q 值','',{min:0,exclusiveMin:true}]],frequencyTracking:{topology:'series',maxStages:8,multiplierKeys,sharedQKey:'q',speedInput:'motorSpeed',formula:'abs(motorSpeed) / (2 * pi) * multiplier',unit:'Hz'},outputs:[output('load_torque_motor_speed_notch.output','output','动态陷波后的负载力矩','sensor-torque','N·m')]},
].map(definition=>Object.freeze({...definition,fixedFunction:true,inputs:Object.freeze(definition.inputs.map(Object.freeze)),fields:Object.freeze(definition.fields),outputs:Object.freeze(definition.outputs.map(Object.freeze))})));
export const fixedFunctionDefinition=type=>FIXED_ALGORITHM_FUNCTIONS.find(definition=>definition.id===type)||null;
const noCustomOutputs=child=>Object.values(child.outputNames||{}).every(value=>!String(value).trim())&&['angleOutput','speedOutput','output'].every(key=>child.routing?.[key]===undefined||child.routing[key]==='none');
/** Equivalent old nodes are presented in place; identities, parameters and references are never rewritten. */
export function fixedFunctionForChild(child) {
 if(!child)return null;
 const fixed=fixedFunctionDefinition(child.type);if(fixed)return fixed;
 if(!noCustomOutputs(child))return null;
 const source=child.routing?.source;
 let id;
 if(child.type==='pll'&&source==='sensor.motor_angle')id='motor_pll';
 else if(child.type==='pll'&&source==='sensor.output_angle')id='output_pll';
 else if(child.type==='low_pass'&&source==='sensor.torque')id='load_torque_low_pass';
 else if(child.type==='notch'&&source==='sensor.torque')id='load_torque_notch';
 else if(child.type==='encoder_tracking_motor'&&child.parameters?.extraction==='pll'&&(source===undefined||source==='sensor.motor_angle'))id='motor_pll';
 else if(child.type==='encoder_tracking_output'&&child.parameters?.extraction==='pll'&&(source===undefined||source==='sensor.output_angle'))id='output_pll';
 return fixedFunctionDefinition(id);
}
export const FIXED_COMPENSATION_SOURCES=Object.freeze({friction:'feedback.speed',angle_delay:'feedback.angle',current_calibration:'sampling.current'});
export function fixedFunctionPresentation(child) {
 const definition=fixedFunctionForChild(child),compensationSource=FIXED_COMPENSATION_SOURCES[child?.type];
 const fixedCompensation=compensationSource&&(child.routing?.source===undefined||child.routing.source===compensationSource)&&noCustomOutputs(child);
 const legacy=!fixedFunctionDefinition(child?.type)&&!fixedCompensation;
 const fields=definition?definition.fields.map(field=>child.type.startsWith('encoder_tracking_')&&field[0]==='bandwidthHz'?['pllBandwidthHz',...field.slice(1)]:field):[];
 return {definition,fields,legacy,equivalent:Boolean(definition)};
}
export function fixedFunctionChoices(project,moduleId) {
 const saved=project?.instances?.[moduleId]?.parameters?.children||[];
 return FIXED_ALGORITHM_FUNCTIONS.filter(definition=>definition.moduleId===moduleId&&!definition.retired).map(definition=>({...definition,disabled:saved.some(child=>child.compiled&&fixedFunctionForChild(child)?.id===definition.id)}));
}
export function effectiveAlgorithmRouting(child) {
 const definition=fixedFunctionDefinition(child?.type);
 return definition?Object.fromEntries(definition.inputs.map(input=>[input.key,input.reference])):child?.routing||{};
}
