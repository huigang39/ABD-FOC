import { FIXED_ALGORITHM_FUNCTIONS, fixedFunctionDefinition, fixedFunctionForChild, effectiveAlgorithmRouting } from './fixed-functions.mjs';
import { sensorResources } from '../hardware/hw-board/resources.mjs';
import { builtinDriverInterfaceForModel } from '../hardware/hw-drivers/sensors.mjs';

/** Typed signal identities: unit alone is insufficient to establish compatibility. */
export const SIGNALS = [
 ...FIXED_ALGORITHM_FUNCTIONS.flatMap(definition=>definition.outputs.map(output=>({...output,module:definition.moduleId,child:definition.id,fixedFunction:definition.id}))),
 {id:'sensor.motor_angle',label:'电机轴编码器角度',quantity:'motor-angle',unit:'rad',module:'hw-drivers',sensorRole:'motor'},
 {id:'sensor.output_angle',label:'出轴编码器角度',quantity:'output-angle',unit:'rad',module:'hw-drivers',sensorRole:'output'},
 {id:'feedback.angle',label:'已换算的电角度',quantity:'electrical-angle',unit:'rad',module:'foc-feedback',sensorRole:'motor'},
 {id:'feedback.speed',label:'电机侧机械速度',quantity:'motor-speed',unit:'rad/s',module:'foc-feedback',sensorRole:'motor'},
 {id:'load_torque.torque',label:'电机侧扰动转矩',quantity:'motor-disturbance-torque',unit:'N·m',child:'load_torque'},
 {id:'sampling.current',label:'三相采样电流',quantity:'phase-current',unit:'A',count:3,module:'hw-board'},
 {id:'sampling.bus_voltage',label:'母线电压',quantity:'bus-voltage',unit:'V',module:'hw-board'},
 ...['u','v','w'].map(phase=>({id:`sampling.current_${phase}`,label:`${phase.toUpperCase()} 相电流`,quantity:`phase-current-${phase}`,unit:'A',module:'hw-board'})),
 // This is the logical physical value after interface conversion, not raw DriversOutput.value[2].
 // Device-unit and conversion completeness remain hardware/runtime validation concerns.
 {id:'sensor.torque',label:'负载力矩',quantity:'sensor-torque',unit:'N·m',module:'hw-drivers',sensorRole:'torque',representation:'normalized'},
 {id:'encoder_tracking_motor.angle',label:'跟踪后的电机侧机械角度',quantity:'motor-angle',unit:'rad',child:'encoder_tracking_motor'},
 {id:'encoder_tracking_motor.speed',label:'跟踪后的电机侧机械速度',quantity:'motor-speed',unit:'rad/s',child:'encoder_tracking_motor'},
 {id:'encoder_tracking_output.angle',label:'跟踪后的出轴侧机械角度',quantity:'output-angle',unit:'rad',child:'encoder_tracking_output'},
 {id:'encoder_tracking_output.speed',label:'跟踪后的出轴侧机械速度',quantity:'output-speed',unit:'rad/s',child:'encoder_tracking_output'},
 {id:'smo.angle',label:'滑模估算电角度',quantity:'electrical-angle',unit:'rad',child:'smo'},
 {id:'smo.speed',label:'滑模速度（按转子极对数换算）',quantity:'motor-speed',unit:'rad/s',child:'smo'},
 {id:'flux.angle',label:'磁链估算电角度',quantity:'electrical-angle',unit:'rad',child:'flux'},
 {id:'flux.speed',label:'磁链速度（按转子极对数换算）',quantity:'motor-speed',unit:'rad/s',child:'flux'},
 {id:'angle_fusion.angle',label:'融合电角度',quantity:'electrical-angle',unit:'rad',child:'angle_fusion'},
 {id:'speed_fusion.speed',label:'融合机械速度',quantity:'motor-speed',unit:'rad/s',child:'speed_fusion'},
];
export const CHILD_DESIGNS = {
 ...Object.fromEntries(FIXED_ALGORITHM_FUNCTIONS.map(definition=>[definition.id,{group:'固定功能',quantities:[definition.id.includes('pll')?definition.id==='motor_pll'?'motor-angle':'output-angle':'sensor-torque'],sourceIds:[definition.source],defaults:{}}])),
 pll:{group:'角度跟踪',quantities:['motor-angle','output-angle','electrical-angle'],input:'选择单圈角度数据',output:'与输入同域的角度和角速度',state:'PLL 角度及积分状态',defaults:{source:'',angleOutput:'none',speedOutput:'none'}},
 low_pass:{group:'滤波',scalar:true,input:'选择非角度标量数据',output:'同物理量的滤波结果',state:'上一输出',defaults:{source:'',output:'none'}},
 notch:{group:'滤波',scalar:true,input:'选择非角度标量数据',output:'同物理量的滤波结果',state:'滤波历史状态',defaults:{source:'',output:'none'}},
 encoder_tracking_motor:{group:'角度跟踪',quantities:['motor-angle'],sourceIds:['sensor.motor_angle'],input:'电机侧编码器的单圈机械角度、采样时间与有效标志',output:'同一参考下的电机侧跟踪角度和角速度；不隐式乘除极对数',state:'跟踪角度、速度与上一采样状态',use:'只跟踪电机侧编码器的单圈机械角度，按 2π 处理回绕；单圈输入不能凭空建立多圈绝对参考。用于换相前须经过明确的电角度换算。',defaults:{source:'sensor.motor_angle'},formula:String.raw`$\hat\omega=K_p e_\theta+z$，$\dot z=K_i e_\theta$`},
 encoder_tracking_output:{group:'角度跟踪',quantities:['output-angle'],sourceIds:['sensor.output_angle'],input:'出轴侧编码器的单圈机械角度、采样时间与有效标志',output:'同一参考下的出轴侧跟踪角度和角速度；不隐式乘除减速比',state:'跟踪角度、速度与上一采样状态',use:'只跟踪出轴侧编码器的单圈机械角度，按 2π 处理回绕。本链路可以关闭；关闭后出轴位置与速度由电机侧跟踪结果经减速比估算，估算需结合减速机速比、方向与标零记录核对，不能替代真实出轴反馈。',defaults:{source:'sensor.output_angle'},formula:String.raw`$\hat\omega=K_p e_\theta+z$，$\dot z=K_i e_\theta$`},
 smo:{group:'电角度与速度',stages:['电流 / 已生效电压','反电动势估算','转子相位提取','角度 / 速度'],input:'本周期电流、对应采样区间的已生效电压、电机 R/L',output:'反电动势 αβ、电角度、电角速度、机械速度、时间戳与有效标志',state:'电流估计、反电动势与滤波状态',use:'反电动势方向先按旋转方向转换为转子相位，再由 PLL 或反正切提取；需要处理滤波延迟。反电动势不足时无效。',defaults:{}},
 flux:{group:'电角度与速度',stages:['电流 / 已生效电压','转子磁链估算','转子相位提取','角度 / 速度'],input:'本周期电流、对应采样区间的已生效电压、电机 R/L',output:'转子磁链 αβ、电角度、电角速度、机械速度、时间戳与有效标志',state:'磁链积分、漂移修正状态',use:'先分离转子磁链，再提取角度；定子磁链方向不是转子方向。低速性能取决于模型、偏置与漂移处理。',defaults:{}},
 load_torque:{group:'机械状态',quantity:'motor-speed',input:'电机侧机械速度、实际电流对应的电磁转矩、等效惯量',output:'电机侧估计扰动转矩、时间戳与有效标志',state:'速度滤波、转矩估计状态',use:'用于诊断或后续策略；包含负载、摩擦与模型误差，不等同力矩传感器读数，不自动加入给定',defaults:{source:'feedback.speed'},formula:String.raw`$\hat T_d\approx T_e-J\dot\omega_m$`},
 angle_fusion:{group:'选择与融合',quantity:'electrical-angle',input:'同一采样时刻、同一方向及零位的两个电角度与有效标志',output:'融合电角度、来源与有效标志',state:'上一有效角度、过渡状态',use:'加权时两路均须有效，按最短圆弧融合；主备模式仅在备用有效时切换。两路都失效则输出无效，不能冻结旧角度继续驱动',defaults:{source:'feedback.angle',secondary:'smo.angle',method:'weighted'}},
 speed_fusion:{group:'选择与融合',quantity:'motor-speed',input:'同一采样时刻的两路电机侧机械速度与有效标志',output:'融合机械速度、来源与有效标志',state:'滤波、切换过渡状态',use:'仅融合电机侧机械速度。加权时两路均须有效；主备模式两路都失效则输出无效。速度来源可独立选择，但不用于恢复机械位置',defaults:{source:'feedback.speed',secondary:'encoder_tracking_motor.speed',method:'weighted'}},
 friction:{group:'转矩补偿',quantity:'motor-speed',input:'电机侧机械速度、摩擦辨识参数',output:'受限电机侧补偿转矩与有效标志',state:'过零平滑与限幅状态',use:'叠加到电机侧转矩给定，合成后总限幅，再换算 Iq',defaults:{source:'feedback.speed'},formula:String.raw`$T_f=T_c\tanh(\omega_m/\omega_s)+B\omega_m$`},
 angle_delay:{group:'角度补偿',quantity:'electrical-angle',input:'电角度、电角速度、已知采样延迟',output:'预测到控制时刻的电角度与有效标志',state:'角度时间戳、预测状态',use:'角度反馈进入 Park 变换前；零位由编码器校准处理，再做延迟预测',defaults:{source:'feedback.angle'},formula:String.raw`$\theta_c=\operatorname{wrap}(\theta+\omega_e\Delta t)$`},
 current_calibration:{group:'电流补偿',quantity:'phase-current',input:'无相电流条件下的 ADC 电流采样、采样间隔、采集时长与 PWM 设置',output:'自动测得的三相零偏、有效样本数、测量状态；运行时输出去零偏电流',state:'采样累加值、样本计数、等待计时与测量结果',use:'开启每次使能前采集时，在使能请求上升沿进入采集流程，每次使能只采集一次，成功后才放行正常驱动输出；失败或取消保持输出关闭。先等待采样链路稳定，再按间隔采集并求均值。PWM 开启时三相使用同一占空比；必须由硬件适配确认无相电流且采样有效，禁止注入转矩。结果有效后才用于 Clarke 变换前的电流修正，失败不覆盖原结果。',defaults:{source:'sampling.current'},formula:String.raw`$b_k=\frac{1}{N}\sum_{n=1}^{N}i_k[n]$，$i_{c,k}=i_k-b_k$`},
};
export const OBSERVER_OUTPUTS = [
 ['angleOutput','发布电角度','electrical-angle'],
 ['speedOutput','发布电机侧机械速度','motor-speed'],
 ['motorAngleOutput','发布电机侧机械角度','motor-angle'],
 ['outputAngleOutput','发布出轴侧机械角度','output-angle'],
 ['outputSpeedOutput','发布出轴侧机械速度','output-speed'],
 ['torqueOutput','发布扰动转矩','motor-disturbance-torque'],
];
const TRACKING_DOMAINS = {
 'sensor.motor_angle':{label:'电机侧机械角度',angleField:'motor_angle',speedField:'motor_velocity',speedLabel:'电机侧机械速度',quantity:'motor-angle'},
 'sensor.output_angle':{label:'出轴侧机械角度',angleField:'output_angle',speedField:'output_velocity',speedLabel:'出轴侧机械速度',quantity:'output-angle'},
 'feedback.angle':{label:'电角度',angleField:'electrical_angle',speedField:'electrical_velocity',speedLabel:'电角速度',quantity:'electrical-angle'},
};
export function encoderTrackingDomain(child) {
 return TRACKING_DOMAINS[child?.routing?.source] || TRACKING_DOMAINS['sensor.motor_angle'];
}
export function signalChoices(type,project,child) {
 const spec=CHILD_DESIGNS[type];
 if(!spec)return [];
 const signals=[...SIGNALS.map(signal=>resolveAlgorithmSignal(project,signal.id)),...algorithmInstances(project).filter(item=>item.child.compiled&&['pll','low_pass','notch'].includes(item.child.type)).flatMap(({child:item})=>(item.type==='pll'?['angle','speed']:['output']).map(port=>resolveAlgorithmSignal(project,instanceSignalReference(item.id,port))))].filter(Boolean);
 return signals.filter(signal=>signalCompatibleWithProcessingType(signal,type)&&(!child||signal.childId!==child.id)&&signal.child!==type).map(signal=>[signal.id,signal.label]);
}
export function observerOutputOptions(key,project) {
 const spec=OBSERVER_OUTPUTS.find(([id])=>id===key);
 if(!spec)return null;
 return [{value:'none',label:'不发布'},...SIGNALS.filter(s=>s.child&&s.quantity===spec[2]).map(s=>({value:s.id,label:s.label}))];
}


export const REPEATABLE_ALGORITHM_TYPES=new Set(['pll','low_pass','notch']);
export const instanceSignalReference=(id,port)=>`instance:${id}:${port}`;
export function parseInstanceSignalReference(reference) {
 const match=/^instance:(.+):(angle|speed|output)$/.exec(reference||'');
 return match?{id:match[1],port:match[2]}:null;
}
export const fieldReference=(structureId,fieldId)=>`field:${encodeURIComponent(structureId)}:${encodeURIComponent(fieldId)}`;
export function parseFieldReference(reference) {
 const match=/^field:([^:]+):([^:]+)$/.exec(reference||'');
 if(!match)return null;
 try {const structureId=decodeURIComponent(match[1]),fieldId=decodeURIComponent(match[2]);return structureId&&fieldId?{structureId,fieldId}:null;}catch{return null;}
}
export function algorithmInstances(project) {
 return ['foc-observer','foc-filter','foc-compensation'].flatMap(moduleId=>(project?.instances?.[moduleId]?.parameters?.children||[]).map(child=>({moduleId,child})));
}
export function algorithmSampleFrequency(project) {
 const board=project?.instances?.['hw-board']?.parameters,rate=board?.pwmHz/board?.currentLoopDivider;
 return Number.isFinite(rate)&&rate>0?rate:null;
}
const speedQuantity={'motor-angle':'motor-speed','output-angle':'output-speed','electrical-angle':'electrical-speed'};
/** Fixed input roles carry independent physical contracts, including auxiliary speed inputs. */
export function algorithmInputEntries(child) {
 const definition=fixedFunctionDefinition(child?.type);if(definition)return definition.inputs;
 const routing={...CHILD_DESIGNS[child?.type]?.defaults,...child?.routing};
 return ['source','secondary'].filter(key=>Object.hasOwn(routing,key)).map(key=>({key,reference:routing[key]}));
}
export function fixedInputCompatible(signal,input) {
 return Boolean(signal&&!signal.cycle&&signal.id===input.reference&&signal.type==='f32'&&signal.count===1&&signal.quantity===input.quantity&&signal.unit===input.unit);
}

export function resolveAlgorithmSignal(project,reference,visited=new Set()) {
 const staticSignal=SIGNALS.find(signal=>signal.id===reference);
 if(staticSignal) {
  if(staticSignal.fixedFunction){const producer=algorithmInstances(project).find(({moduleId,child})=>moduleId===staticSignal.module&&child.compiled&&fixedFunctionForChild(child)?.id===staticSignal.fixedFunction);return {...staticSignal,type:'f32',count:1,childId:producer?.child.id||staticSignal.child};}
  return {...staticSignal,module:staticSignal.module||(staticSignal.child?'foc-observer':undefined),type:'f32',count:staticSignal.count??1,childId:staticSignal.child};
 }
 const parsed=parseInstanceSignalReference(reference);
 if(!parsed)return null;
 const item=algorithmInstances(project).find(item=>item.child.id===parsed.id);
 if(!item||!REPEATABLE_ALGORITHM_TYPES.has(item.child.type)||!(item.child.type==='pll'?['angle','speed']:['output']).includes(parsed.port))return null;
 const automaticLabel=`${item.child.name} · ${{angle:'角度',speed:'角速度',output:'输出'}[parsed.port]}`;
 const base={id:reference,label:item.child.outputNames?.[parsed.port]?.trim()||automaticLabel,automaticLabel,port:parsed.port,module:item.moduleId,childId:item.child.id,childType:item.child.type,type:'f32',count:1};
 if(visited.has(item.child.id))return {...base,quantity:null,unit:'',cycle:true};
 const next=new Set(visited);next.add(item.child.id);
 const source=resolveAlgorithmSignal(project,item.child.routing?.source,next);
 if(!source||source.cycle||!source.quantity||source.count!==1)return {...base,quantity:null,unit:'',cycle:Boolean(source?.cycle),unresolved:true};
 if(item.child.type==='pll'&&!speedQuantity[source.quantity])return {...base,quantity:null,unit:'',unresolved:true};
 return {...base,quantity:parsed.port==='speed'?speedQuantity[source.quantity]:source.quantity,unit:parsed.port==='speed'?'rad/s':source.unit};
}
const fixedOutputQuantities={
 'foc-observer':{angle:'electrical-angle',electrical_velocity:'electrical-speed',motor_angle:'motor-angle',motor_velocity:'motor-speed',output_angle:'output-angle',output_velocity:'output-speed',disturbance_torque:'motor-disturbance-torque'},
 'foc-filter':{motor_velocity:'motor-speed',output_velocity:'output-speed',bus_voltage:'bus-voltage',torque:'sensor-torque',phase_current_u:'phase-current-u',phase_current_v:'phase-current-v',phase_current_w:'phase-current-w'},
};
function outputStructures(project,moduleId) {
 const design=project?.design,refs=design?.moduleContracts||{},ownOutput=refs[moduleId]?.output;
 const bound=new Set(Object.values(refs).flatMap(roles=>Object.values(roles||{})));
 const privateIds=new Set(design?.privateStructures||[]);
 return (design?.structures||[]).filter(structure=>structure.owner===moduleId&&(structure.id===ownOutput||!bound.has(structure.id)&&!privateIds.has(structure.id)));
}
export function resolveOutputField(project,moduleId,reference) {
 const parsed=parseFieldReference(reference);
 if(!parsed)return null;
 const structure=outputStructures(project,moduleId).find(item=>item.id===parsed.structureId);
 const field=structure?.fields?.find(item=>item.id===parsed.fieldId);
 if(!field)return null;
 const semanticName=String(field.id).startsWith(moduleId+'-output-')?field.id.slice((moduleId+'-output-').length):'';
 const known=structure.id===project.design.moduleContracts?.[moduleId]?.output?(fixedOutputQuantities[moduleId]?.[semanticName]||fixedOutputQuantities[moduleId]?.[field.name]):null;
 const inherited=new Set();
 if(!known)for(const {child} of algorithmInstances(project))if(child.compiled&&REPEATABLE_ALGORITHM_TYPES.has(child.type))for(const key of child.type==='pll'?['angleOutput','speedOutput']:['output']){
  const target=parseFieldReference(child.routing?.[key]);
  if(target?.structureId===structure.id&&target.fieldId===field.id){const signal=algorithmOutputSignal(project,child,key);if(signal?.quantity)inherited.add(signal.quantity);}
 }
 return {id:reference,structureId:structure.id,fieldId:field.id,label:`${structure.name}.${field.name}`,module:moduleId,type:field.type,count:field.count,unit:field.unit||'',quantity:known||(inherited.size===1?[...inherited][0]:null),quantityConflict:inherited.size>1,custom:!known};
}
export function algorithmOutputSignal(project,child,key) {
 const port=child.type==='pll'?(key==='angleOutput'?'angle':key==='speedOutput'?'speed':null):key==='output'?'output':null;
 return port?resolveAlgorithmSignal(project,instanceSignalReference(child.id,port)):null;
}
export function outputFieldCompatible(field,signal) {
 return Boolean(field&&!field.quantityConflict&&signal?.quantity&&field.type==='f32'&&field.count===1&&field.unit===signal.unit&&(!field.quantity||field.quantity===signal.quantity));
}
/** Selectable sources are configured producers; saved unavailable routes stay visible. */
export function algorithmRouteChoices(project,moduleId,child,key) {
 if(key==='source'||key==='secondary'){
  const choices=availableAlgorithmSignals(project,{type:child.type,excludeChildId:child.id}).map(signal=>[signal.id,signal.label]);
  const selected=child.routing?.[key];
  if(selected&&!choices.some(([id])=>id===selected))choices.push([selected,`${resolveAlgorithmSignal(project,selected)?.label||'原输入'} · 待检查`]);
  return [['','—'],...choices];
 }
 if(key==='method')return [['weighted','加权融合'],['fallback','主来源优先，失效后切换']];
 const output=algorithmOutputSignal(project,child,key);
 return [['none','不写入'],...outputStructures(project,moduleId).flatMap(structure=>(structure.fields||[]).map(field=>resolveOutputField(project,moduleId,fieldReference(structure.id,field.id))).filter(field=>outputFieldCompatible(field,output)).map(field=>[field.id,field.label]))];
}
export const legacyObserverOutputFields={angleOutput:'angle',speedOutput:'motor_velocity',motorAngleOutput:'motor_angle',outputAngleOutput:'output_angle',outputSpeedOutput:'output_velocity',torqueOutput:'disturbance_torque'};
export function algorithmOutputWriters(project) {
 const writers=[];
 for(const {moduleId,child} of algorithmInstances(project))if(project.instances[moduleId]?.enabled&&child.compiled&&REPEATABLE_ALGORITHM_TYPES.has(child.type))for(const key of child.type==='pll'?['angleOutput','speedOutput']:['output']) {
  const target=resolveOutputField(project,moduleId,child.routing?.[key]);
  if(target)writers.push({moduleId,childId:child.id,key,label:child.name,target,signal:algorithmOutputSignal(project,child,key)});
 }
 const observer=project?.instances?.['foc-observer'];
 if(observer?.enabled)for(const [key,name] of Object.entries(legacyObserverOutputFields))if(observer.parameters[key]&&observer.parameters[key]!=='none') {
  const structure=project.design?.structures?.find(item=>item.id===project.design.moduleContracts?.['foc-observer']?.output),field=structure?.fields?.find(item=>item.id===`foc-observer-output-${name}`)||structure?.fields?.find(item=>item.name===name);
  if(field)writers.push({moduleId:'foc-observer',childId:null,key,label:'观测结果选择',target:resolveOutputField(project,'foc-observer',fieldReference(structure.id,field.id)),signal:resolveAlgorithmSignal(project,observer.parameters[key])});
 }
 return writers;
}


const angleQuantities=new Set(['motor-angle','output-angle','electrical-angle']);
/** Ordinary scalar filters do not handle phase wrapping. */
export function signalCompatibleWithProcessingType(signal,type) {
 const spec=CHILD_DESIGNS[type];
 if(!spec||!signal?.quantity||signal.cycle)return false;
 if((spec.scalar||type==='pll')&&(signal.count??1)!==1)return false;
 if(spec.scalar&&angleQuantities.has(signal.quantity))return false;
 return (spec.scalar||(spec.quantities||[spec.quantity]).includes(signal.quantity))&&(!spec.sourceIds||spec.sourceIds.includes(signal.id));
}
const configuredValue=value=>typeof value==='string'&&value.trim()&&!['none','unselected','unconfirmed'].includes(value);
const hasPin=(resource,signal)=>Boolean(configuredValue(resource?.pins?.[signal]));
function hasReceivingPins(resource) {
 const required={uart:['RX'],spi:['SCK','MISO'],i2c:['SCL','SDA'],can:['RX'],timer:['CH1','CH2']};
 return resource?.kind==='adc'?Object.entries(resource.pins||{}).some(([key,pin])=>/^IN[PN]\d+$/.test(key)&&configuredValue(pin)):(required[resource?.kind]||[]).length>0&&required[resource.kind].every(key=>hasPin(resource,key));
}
function configuredSensor(project,role) {
 const instance=project?.instances?.['hw-drivers'],board=project?.instances?.['hw-board'],parameters=instance?.parameters;
 if(!instance?.enabled||!instance.runtimeEnabled||!board?.enabled)return false;
 const [prefix,capability]={motor:['motorEncoder','encoderCapability'],output:['outputEncoder','outputEncoderCapability'],torque:['torqueSensor','torqueCapability']}[role]||[];
 if(!prefix||parameters[capability]!=='present'||!configuredValue(parameters[prefix+'Model']))return false;
 // A source explicitly declared electrical cannot masquerade as an axis mechanical angle.
 if(role!=='torque'&&parameters[prefix+'AngleDomain']==='electrical')return false;
 const transport=builtinDriverInterfaceForModel(prefix,parameters[prefix+'Model'])||parameters[prefix+'Interface'];
 const resource=sensorResources(board.parameters.resources,transport).find(item=>item.id===parameters[prefix+'Resource']);
 return Boolean(resource&&hasReceivingPins(resource));
}
function configuredSampling(project,preset) {
 const instance=project?.instances?.['hw-board'];
 if(!instance?.enabled||!instance.runtimeEnabled)return false;
 const resources=(instance.parameters.resources||[]).filter(resource=>resource.kind==='adc'&&resource.preset===preset);
 return resources.length>0&&(preset==='phase-current'?resources.every(resource=>configuredValue(resource.instance)&&hasReceivingPins(resource)):resources.some(resource=>configuredValue(resource.instance)&&hasReceivingPins(resource)));
}
function signalProducer(project,signal) {
 return algorithmInstances(project).find(item=>item.moduleId===signal.module&&(item.child.id===signal.childId||!REPEATABLE_ALGORITHM_TYPES.has(item.child.type)&&item.child.type===signal.childId));
}
/** Selectable configured sources and producer paths; hardware conversion readiness is validated separately. */
export function algorithmSignalAvailable(project,reference,{excludeChildId}={}) {
 function available(ref,visited) {
  if(visited.has(ref))return false;
  const signal=resolveAlgorithmSignal(project,ref);
  if(!signal||signal.cycle||!signal.quantity||signal.childId===excludeChildId&&excludeChildId)return false;
  const owner=project?.instances?.[signal.module];if(!owner?.enabled||!owner.runtimeEnabled)return false;
  const next=new Set(visited);next.add(ref);
  if(signal.childId){
   const producer=signalProducer(project,signal),child=producer?.child;
   if(!child?.compiled||!child.enabled)return false;
   return algorithmInputEntries(child).every(input=>{
    const source=resolveAlgorithmSignal(project,input.reference);
    return (input.quantity?fixedInputCompatible(source,input):signalCompatibleWithProcessingType(source,child.type))&&available(input.reference,next);
   });
  }
  if(ref==='sensor.motor_angle')return configuredSensor(project,'motor');
  if(ref==='sensor.output_angle')return configuredSensor(project,'output');
  if(ref==='sensor.torque')return configuredSensor(project,'torque');
  if(ref==='sampling.bus_voltage')return configuredSampling(project,'bus-voltage');
  if(ref==='sampling.current'||/^sampling\.current_[uvw]$/.test(ref))return configuredSampling(project,'phase-current');
  if(ref==='feedback.speed')return configuredSensor(project,'motor');
  if(ref==='feedback.angle'){
   const mode=owner.parameters.angleSource;
   if(mode==='encoder')return configuredSensor(project,'motor');
   if(mode==='forced')return Number.isFinite(owner.parameters.forcedAngleRad);
   if(mode==='observer'){
    const structure=project.design?.structures?.find(item=>item.id===project.design.moduleContracts?.['foc-observer']?.output),field=structure?.fields?.find(item=>item.id==='foc-observer-output-angle')||structure?.fields?.find(item=>item.name==='angle');
    return algorithmOutputWriters(project).some(writer=>writer.target.structureId===structure?.id&&writer.target.fieldId===field?.id&&writer.target.quantity==='electrical-angle'&&available(writer.signal?.id,next));
   }
   return false;
  }
  return false;
 }
 return available(reference,new Set());
}
/** Typed descriptors for the hardware and processing outputs configured in this project. */
export function availableAlgorithmSignals(project,{type,excludeChildId}={}) {
 const references=[...SIGNALS.map(signal=>signal.id),...algorithmInstances(project).filter(({child})=>REPEATABLE_ALGORITHM_TYPES.has(child.type)).flatMap(({child})=>(child.type==='pll'?['angle','speed']:['output']).map(port=>instanceSignalReference(child.id,port)))];
 return references.map(reference=>resolveAlgorithmSignal(project,reference)).filter(signal=>signal&&(type?signalCompatibleWithProcessingType(signal,type):signal.count===1)&&algorithmSignalAvailable(project,signal.id,{excludeChildId}));
}
