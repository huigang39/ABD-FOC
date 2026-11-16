import { FIXED_ALGORITHM_FUNCTIONS, fixedFunctionDefinition, fixedFunctionForChild, fixedFunctionPresentation, effectiveAlgorithmRouting } from './fixed-functions.mjs';
import { OBSERVER_CHILDREN, childParameterVisible, childDefaults } from './foc-observer/chains.mjs';
import { CHILD_DESIGNS, SIGNALS, signalChoices, OBSERVER_OUTPUTS, REPEATABLE_ALGORITHM_TYPES, resolveAlgorithmSignal, algorithmInstances, algorithmSampleFrequency, algorithmInputEntries, fixedInputCompatible, algorithmSignalAvailable, algorithmOutputSignal, resolveOutputField, outputFieldCompatible, algorithmOutputWriters, parseInstanceSignalReference, parseFieldReference } from './signals.mjs';
import { FILTER_CHILDREN } from './filter-chains.mjs';
export const CHILD_TYPES = {
 'foc-observer': [...OBSERVER_CHILDREN,...FIXED_ALGORITHM_FUNCTIONS.filter(definition=>definition.moduleId==='foc-observer')],
 'foc-filter': [...FILTER_CHILDREN,...FIXED_ALGORITHM_FUNCTIONS.filter(definition=>definition.moduleId==='foc-filter')],
 'foc-compensation':[
  {id:'angle_delay',title:'角度延迟补偿',fields:[['delayCycles','补偿延迟','周期',{min:0}],['delayUs','旧采样延迟','μs',{min:0,hidden:true}]]},
  {id:'current_calibration',title:'电流零偏',fields:[['captureOnEnable','每次使能前采集零偏','',{type:'boolean',defaultValue:false,description:'每次从未使能进入使能流程时采集一次，复用采样与 PWM 设置；采集成功后才允许正常驱动输出。失败或取消保持输出关闭，不覆盖原零偏。'}],['sampleIntervalUs','采样间隔','μs',{min:0}],['settlingMs','采样前等待','ms',{min:0}],['durationMs','采集时长','ms',{min:0}],['pwmEnabled','采集时开启 PWM','',{type:'boolean',defaultValue:false}],['pwmDutyPercent','PWM 占空比','%',{min:0,max:100}]]},
  {id:'friction',title:'摩擦补偿',fields:[['coulombNm','库仑摩擦力矩','N·m'],['viscous','黏性摩擦系数','N·m/(rad/s)'],['transitionRadS','过零平滑速度','rad/s'],['limitNm','补偿上限','N·m']]},
 ],
};
export function createAlgorithmChild(moduleId,type) {
 const definition=CHILD_TYPES[moduleId]?.find(item=>item.id===type);
 if(!definition)throw Error('请选择子模块类型。');
 return {id:definition.fixedFunction?type:crypto.randomUUID(),type,name:definition.title,compiled:true,enabled:false,routing:{...CHILD_DESIGNS[type].defaults},parameters:childDefaults(definition)};
}
export function checkAlgorithmChildren(children,moduleId) {
 if(!Array.isArray(children)||children.length>32)throw Error('每组最多 32 个子模块。');
 const ids=new Set(), types=new Set();
 for(const child of children){
  const type=(moduleId?CHILD_TYPES[moduleId]||[]:Object.values(CHILD_TYPES).flat()).find(type=>type.id===child?.type);
  if(!type||typeof child.id!=='string'||!child.id||(ids.has(child.id)||!type.repeatable&&types.has(child.type))||typeof child.name!=='string'||typeof child.compiled!=='boolean'||typeof child.enabled!=='boolean')throw Error('算法子模块格式无效。');
  if(type.fixedFunction&&child.id!==type.id)throw Error('固定功能标识不能修改。');
  ids.add(child.id);types.add(child.type);
  if(Object.hasOwn(child,'outputNames')){
   const ports=child.type==='pll'?['angle','speed']:['low_pass','notch'].includes(child.type)?['output']:[];
   if(!child.outputNames||typeof child.outputNames!=='object'||Array.isArray(child.outputNames)||Object.entries(child.outputNames).some(([key,value])=>!ports.includes(key)||typeof value!=='string'||value.length>120))throw Error('算法输出名称格式无效。');
  }
  if(child.routing){
   const defaults=CHILD_DESIGNS[child.type].defaults;
   if(Object.keys(child.routing).some(key=>!Object.hasOwn(defaults,key)))throw Error('子模块连接字段无效。');
   for(const [key,value] of Object.entries(child.routing)){
    const output=['angleOutput','speedOutput','output'].includes(key);
    const valid=key==='method'?['weighted','fallback'].includes(value):output?value==='none'||Boolean(parseFieldReference(value)):typeof value==='string'&&(Boolean(parseInstanceSignalReference(value))||(REPEATABLE_ALGORITHM_TYPES.has(child.type)?value===''||SIGNALS.some(signal=>signal.id===value):signalChoices(child.type).some(([id])=>id===value)));
    if(!valid)throw Error('子模块信号类型不匹配。');
   }
  }
  if(!child.parameters||Object.keys(child.parameters).sort().join()!==type.fields.map(([key])=>key).sort().join())throw Error('子模块参数与类型不匹配。');
  for(const [key,,,options] of type.fields){const v=child.parameters[key];if(options?.type==='boolean'?typeof v!=='boolean':options?.type==='select'?!options.choices.some(([id])=>id===v):v!==null&&(typeof v!=='number'||!Number.isFinite(v)))throw Error('子模块参数类型无效。');}
 }
}
const reference=(label,kind='algorithm')=>({type:'reference',label:String(label).slice(0,160)||'未命名',kind});
const ownerFor=(moduleId,child)=>child.type==='current_calibration'?{moduleId:'hw-board',paramKey:'resources'}:child.type==='angle_delay'?{moduleId:'foc-current',paramKey:'children'}:{moduleId,paramKey:'children'};
function allChildren(project) {return Object.keys(CHILD_TYPES).flatMap(moduleId=>fixedAlgorithmChildren(project,moduleId).map(child=>({moduleId,child})));}
function producerFor(project,signal) {
 if(!signal?.childId)return null;
 return allChildren(project).find(item=>item.child.id===signal.childId||!REPEATABLE_ALGORITHM_TYPES.has(item.child.type)&&item.child.type===signal.childId);
}
export function algorithmChildrenIssues(project) {
 const issues=[];
 for(const {moduleId,child} of algorithmInstances(project))if(!CHILD_TYPES[moduleId]?.some(type=>type.id===child.type))issues.push({id:`algorithm-child-module-${moduleId}-${child.id}`,level:'error',title:'算法实例所属模块不匹配',message:'此算法类型不能放在当前模块。',messageParts:[reference(child.name),' 不能放在当前模块。'],moduleId,paramKey:'children',childId:child.id});
 const all=allChildren(project);
 const fixedRoles=new Map();
 for(const {moduleId,child} of all)if(child.compiled&&['foc-observer','foc-filter'].includes(moduleId)){
  const definition=fixedFunctionForChild(child);
  if(!definition)issues.push({id:`algorithm-legacy-function-${child.id}`,level:'pending',title:'旧功能待替换',message:'此旧配置不能等价映射到现有固定功能，配置已保留，请替换或移除。',messageParts:[reference(child.name),' 不能等价映射到现有固定功能，配置已保留，请替换或移除。'],moduleId,paramKey:'children',childId:child.id});
  else {const previous=fixedRoles.get(definition.id);if(previous)issues.push({id:`algorithm-fixed-duplicate-${child.id}`,level:'error',title:'固定功能重复',message:definition.title+' 已存在，旧实例均已保留，请仅保留一个。',messageParts:[reference(definition.title),' 已存在，请仅保留一个实例。'],moduleId,paramKey:'children',childId:child.id});else fixedRoles.set(definition.id,child);}
 }
 for(const {moduleId,child} of all)if(moduleId==='foc-compensation'&&child.compiled&&fixedFunctionPresentation(child).legacy)issues.push({id:`algorithm-legacy-compensation-${child.id}`,level:'pending',title:'旧补偿连接待替换',message:'补偿器使用固定输入，旧自定义连接已保留，请替换或移除。',messageParts:[reference(child.name),' 的旧自定义连接已保留，请替换或移除。'],...ownerFor(moduleId,child),childId:child.id});
 const identifiers=new Map();
 for(const item of all){const list=identifiers.get(item.child.id)||[];list.push(item);identifiers.set(item.child.id,list);}
 for(const [id,items] of identifiers)if(items.length>1)for(const item of items)issues.push({id:`algorithm-instance-id-${item.moduleId}-${id}`,level:'error',title:'实例标识重复',message:'不同模块的算法实例不能使用相同标识。',messageParts:[reference(item.child.name),' 与其他实例的标识重复。'],...ownerFor(item.moduleId,item.child),childId:id});
 for(const moduleId of Object.keys(CHILD_TYPES)){
  const instance=project.instances[moduleId];if(!instance?.enabled)continue;
  for(const child of fixedAlgorithmChildren(project,moduleId)){
   if(moduleId==='foc-compensation'&&!(instance.parameters.children||[]).length)continue;
   if(!child.compiled)continue;
   const report=(key,message,parts=[])=>issues.push({id:'algorithm-routing-'+child.id+'-'+key,level:'error',title:'子模块连接检查',message:child.name+'：'+message,messageParts:[reference(child.name),'：',...(parts.length?parts:[message])],...ownerFor(moduleId,child),childId:child.id});
   const routing=effectiveAlgorithmRouting(child),repeatable=REPEATABLE_ALGORITHM_TYPES.has(child.type),fixed=Boolean(fixedFunctionDefinition(child.type));
   for(const input of algorithmInputEntries(child)){
    const {key,reference:source}=input;
    if(!source){if(repeatable&&key==='source')report(key,'请选择输入数据。');continue;}
    const signal=resolveAlgorithmSignal(project,source);
    if(!signal||signal.cycle||!(fixed?fixedInputCompatible(signal,input):signalChoices(child.type,project,child).some(([id])=>id===signal.id))){report(key,signal?.cycle?'输入连接形成循环。':'输入数据不存在或物理量不匹配。');continue;}
    if(signal.sensorRole){const capability={motor:'encoderCapability',output:'outputEncoderCapability',torque:'torqueCapability'}[signal.sensorRole];if(project.instances['hw-drivers']?.parameters[capability]!=='present')report(key+(signal.sensorRole==='torque'?'-sensor':'-encoder'),'此输入需要已配置的传感器。',[reference(signal.label,'signal'),' 需要已配置的传感器。']);}
    const producer=producerFor(project,signal),owner=project.instances[producer?.moduleId||signal.module];
    if(!owner?.enabled||signal.childId&&!producer?.child.compiled)report(key,'输入来源没有编译。',[reference(signal.label,'signal'),' 没有编译。']);
    else if(instance.runtimeEnabled&&child.enabled&&(!owner.runtimeEnabled||producer&&!producer.child.enabled))report(key,'输入来源未启用运行。',[reference(signal.label,'signal'),' 未启用运行。']);
    else if((repeatable||fixed)&&!algorithmSignalAvailable(project,signal.id))report(key,'输入来源尚未完成配置或上游不可用。',[reference(signal.label,'signal'),' 尚未完成配置或上游不可用。']);
   }
   if(routing.secondary&&routing.source===routing.secondary)report('duplicate','融合的两个来源不能相同。');
   if(child.type.endsWith('_fusion')&&routing.method==='weighted'&&!(child.parameters.weight>=0&&child.parameters.weight<=1&&child.parameters.weight!==null))report('weight','主来源权重应在 0～1 之间。');
   const type=CHILD_TYPES[moduleId].find(type=>type.id===child.type);
   for(const field of type.fields){
    const [key,label,,options]=field;
    if(!childParameterVisible(child,field)||['boolean','select'].includes(options?.type))continue;
    if(moduleId==='foc-compensation'&&child.type==='friction')continue;
    const value=child.parameters[key];
    if(options?.optional&&value===null)continue;
    if(typeof value!=='number'||!Number.isFinite(value))report(key,label+'尚未配置。');
    else if((options?.min!==undefined&&value<options.min)||(options?.max!==undefined&&value>options.max)||((options?.exclusiveMin||['sampleIntervalUs','durationMs'].includes(key))&&value<=0))report(key,label+'超出允许范围。');
    else if((/bandwidth|inertia|Gain/.test(key)&&value<=0)||(/delay|transition|limit/.test(key)&&value<0))report(key,label+'超出允许范围。');
   }
   const tracking=fixedFunctionDefinition(child.type)?.frequencyTracking;
   if(tracking&&!tracking.multiplierKeys.some(key=>typeof child.parameters[key]==='number'&&Number.isFinite(child.parameters[key])&&child.parameters[key]>0))report('multipliers','至少填写一个正倍频系数；留空的级不启用。');
   const rate=algorithmSampleFrequency(project);
   for(const field of type.fields){
    const [key,label,,options]=field;
    if(options?.rateLimited&&childParameterVisible(child,field)&&rate&&child.parameters[key]>=rate/2)report(key+'-rate',label+'必须低于电流环采样频率的一半。');
   }
   if(child.type==='angle_delay'&&child.parameters.delayUs!=null&&child.parameters.delayCycles==null)report('legacy-delay','旧延迟需要有效的采样周期后才能换算为周期数。');
   if(child.type==='current_calibration'&&child.parameters.durationMs*1000<child.parameters.sampleIntervalUs)report('duration','采集时长必须至少覆盖一个采样间隔。');
   if(repeatable){
    const keys=child.type==='pll'?['angleOutput','speedOutput']:['output'];
    for(const key of keys){
     const target=routing[key];if(!target||target==='none')continue;
     const field=resolveOutputField(project,moduleId,target),signal=algorithmOutputSignal(project,child,key);
     if(!field)report(key,'输出字段不存在或不属于本模块可写结构。');
     else if(!outputFieldCompatible(field,signal))report(key,'输出字段的类型、单位或角度域不匹配。',[reference(field.label,'field'),' 的类型、单位或角度域不匹配。']);
    }
   }
   issues.push({id:'algorithm-child-'+child.id,level:'pending',title:'子模块实现待接入',message:child.name+' 的独立实例与执行连接尚未接入固件生成。',messageParts:[reference(child.name),' 的独立实例与执行连接尚未接入固件生成。'],...ownerFor(moduleId,child),childId:child.id});
  }
 }
 const writers=algorithmOutputWriters(project);
 for(const writer of writers){
  const peers=writers.filter(other=>other!==writer&&other.target.structureId===writer.target.structureId&&other.target.fieldId===writer.target.fieldId);
  if(!peers.length)continue;
  const parts=[reference(writer.target.label,'field'),' 同时由 ',...[writer,...peers].flatMap((item,index)=>[...(index?['、']:[]),reference(item.label)]),' 写入，请保留一个写入来源。'];
  issues.push({id:`algorithm-output-conflict-${writer.childId||'legacy'}-${writer.key}`,level:'error',title:'输出字段重复写入',message:parts.map(part=>typeof part==='string'?part:part.label).join(''),messageParts:parts,moduleId:writer.moduleId,paramKey:writer.childId?'children':writer.key,...(writer.childId?{childId:writer.childId}:{})});
 }
 issues.push(...observerOutputIssues(project));
 const plan=algorithmExecutionPlan(project);
 if(plan.cycle)issues.push({id:'algorithm-routing-cycle',level:'error',title:'观测连接形成循环',message:'当前周期的数据连接存在循环，请更换输入来源。',moduleId:'foc-observer',paramKey:'children'});
 return issues;
}

export function fixedAlgorithmChildren(project,moduleId) {
 const instance=project.instances?.[moduleId];
 if(!instance||!CHILD_TYPES[moduleId])return [];
 const primaryType=moduleId==='foc-compensation'?'friction':null,savedChildren=instance.parameters.children||[];
 const fixed=CHILD_TYPES[moduleId].filter(type=>!type.repeatable&&(!type.fixedFunction||savedChildren.some(child=>child.type===type.id))).map(type=>{
  const saved=savedChildren.find(child=>child.type===type.id);
  return saved?{...saved,parameters:{...childDefaults(type),...saved.parameters},id:type.id,name:type.title,routing:{...CHILD_DESIGNS[type.id].defaults,...saved.routing}}:{
   id:type.id,type:type.id,name:type.title,routing:{...CHILD_DESIGNS[type.id].defaults},compiled:type.id===primaryType,
   enabled:type.id===primaryType&&instance.runtimeEnabled,parameters:childDefaults(type)
  };
 });
 return [...fixed,...savedChildren.filter(child=>CHILD_TYPES[moduleId].some(type=>type.id===child.type&&type.repeatable)).map(child=>({...child,routing:{...CHILD_DESIGNS[child.type].defaults,...child.routing}}))];
}

/** The legacy friction implementation had no child record of its own. */
function hasLegacyFriction(project) {
 const instance=project.instances['foc-compensation'];
 if(instance.parameters.children?.some(child=>child.type==='friction'))return false;
 return instance.enabled||['frictionModel','frictionSource','viscousNmPerRadS','coulombNm','transitionRadS','maxCompensationNm'].some(key=>{
  const value=instance.parameters[key];
  return value!==null&&value!==undefined&&value!==''&&value!=='unselected';
 });
}

/** Visible membership follows inclusion, without materializing defaults during rendering. */
export function configuredAlgorithmChildren(project,moduleId) {
 const saved=project.instances[moduleId]?.parameters.children||[];
 return fixedAlgorithmChildren(project,moduleId).filter(child=>child.compiled&&(child.type!=='friction'||saved.some(item=>item.type==='friction')||hasLegacyFriction(project)));
}

function editableChildren(project,moduleId,type) {
 if(!CHILD_TYPES[moduleId]?.some(item=>item.id===type)||!project.instances[moduleId])throw Error('请选择有效的子模块类型。');
 const included=new Set(configuredAlgorithmChildren(project,moduleId).map(child=>child.type));
 const children=fixedAlgorithmChildren(project,moduleId);
 // An explicit off record prevents the old friction default from reappearing.
 if(moduleId==='foc-compensation'&&!included.has('friction')&&!project.instances[moduleId].parameters.children?.some(child=>child.type==='friction')){
  const friction=children.find(child=>child.type==='friction');friction.compiled=false;friction.enabled=false;
 }
 return {children,included};
}

/** Explicit addition includes and enables only the requested function. */
export function addAlgorithmChild(project,moduleId,type) {
 const definition=CHILD_TYPES[moduleId]?.find(item=>item.id===type);
 if(!definition)throw Error('请选择有效的子模块类型。');
 const next=structuredClone(project), {children,included}=editableChildren(next,moduleId,type);
 if(!definition.repeatable&&included.has(type)||definition.fixedFunction&&children.some(child=>child.compiled&&fixedFunctionForChild(child)?.id===type))throw Error('该子模块已经添加。');
 const instance=next.instances[moduleId];
 if(!instance.enabled||!instance.runtimeEnabled)for(const child of children)if(child.compiled)child.enabled=false;
 let child;
 if(definition.repeatable){
  if(children.length>=32)throw Error('每组最多 32 个子模块。');
  child=createAlgorithmChild(moduleId,type);
  const names=new Set(children.map(item=>item.name));let index=1;while(names.has(`${definition.title} ${index}`))index++;
  child.name=`${definition.title} ${index}`;children.push(child);
 }else {
  child=children.find(item=>item.type===type);
  if(!child){if(children.length>=32)throw Error('每组最多 32 个子模块。');child=createAlgorithmChild(moduleId,type);child.id=type;children.push(child);}
 }
 child.compiled=true;child.enabled=true;
 instance.parameters.children=children;instance.enabled=true;instance.runtimeEnabled=true;
 return next;
}
/** Keep non-repeatable settings for re-add; instance removals preserve unrelated IDs and routes. */
export function removeAlgorithmChild(project,moduleId,id) {
 const next=structuredClone(project),instance=next.instances[moduleId];
 if(!instance||!CHILD_TYPES[moduleId])throw Error('请选择有效的子模块类型。');
 const children=fixedAlgorithmChildren(next,moduleId);
 const child=children.find(item=>item.id===id)||children.find(item=>item.type===id&&!REPEATABLE_ALGORITHM_TYPES.has(item.type));
 if(!child?.compiled)throw Error('该子模块尚未添加。');
 if(REPEATABLE_ALGORITHM_TYPES.has(child.type))instance.parameters.children=children.filter(item=>item!==child);
 else {child.compiled=false;child.enabled=false;instance.parameters.children=children;}
 if(!instance.parameters.children.some(item=>item.compiled))instance.enabled=false;
 if(!instance.enabled||!instance.parameters.children.some(item=>item.compiled&&item.enabled))instance.runtimeEnabled=false;
 return next;
}
export function updateAlgorithmRouting(project,moduleId,childId,key,value) {
 const next=structuredClone(project),instance=next.instances?.[moduleId];
 if(!instance||!CHILD_TYPES[moduleId])throw Error('算法模块不存在。');
 const children=fixedAlgorithmChildren(next,moduleId),child=children.find(item=>item.id===childId);
 if(!child||!Object.hasOwn(CHILD_DESIGNS[child.type].defaults,key))throw Error('子模块连接字段无效。');
 child.routing[key]=value;
 checkAlgorithmChildren(children,moduleId);
 instance.parameters.children=children;
 return next;
}

/** Producer-first order; same-period cycles are rejected instead of silently delaying a signal. */
export function algorithmExecutionPlan(project) {
 const nodes=allChildren(project).filter(item=>project.instances[item.moduleId]?.enabled&&item.child.compiled);
 const byId=new Map(nodes.map(item=>[item.child.id,item])),visiting=new Set(),done=new Set(),order=[];
 let cycle=false;
 function visit(item){
  const id=item.child.id;if(done.has(id))return;if(visiting.has(id)){cycle=true;return;}visiting.add(id);
  for(const {reference} of algorithmInputEntries(item.child)){
   const parsed=parseInstanceSignalReference(reference),signal=resolveAlgorithmSignal(project,reference);
   const producer=byId.get(parsed?.id||signal?.childId||signal?.child);if(producer)visit(producer);
   if(reference==='feedback.angle'&&project.instances['foc-feedback']?.parameters.angleSource==='observer')for(const publisher of electricalAnglePublishers(project))if(byId.has(publisher.childId))visit(byId.get(publisher.childId));
  }
  visiting.delete(id);done.add(id);order.push(id);
 }
 for(const node of nodes)visit(node);
 return {order:cycle?[]:order,cycle};
}
function electricalAnglePublishers(project) {
 const id=project.design?.moduleContracts?.['foc-observer']?.output;
 const structure=project.design?.structures?.find(item=>item.id===id);
 const field=structure?.fields.find(item=>item.id==='foc-observer-output-angle')||structure?.fields.find(item=>item.name==='angle');
 return algorithmOutputWriters(project).filter(writer=>writer.target.structureId===id&&writer.target.fieldId===field?.id).map(writer=>writer.childId?writer:{...writer,childId:resolveAlgorithmSignal(project,project.instances['foc-observer'].parameters[writer.key])?.childId});
}
export function observerOutputIssues(project) {
 const instance=project.instances['foc-observer'];if(!instance?.enabled)return [];
 const children=fixedAlgorithmChildren(project,'foc-observer'),issues=[];
 const report=(key,message)=>issues.push({id:'observer-output-'+key,level:'error',title:'观测结果检查',message,moduleId:'foc-observer',paramKey:key});
 if(!children.some(child=>child.compiled))report('children','尚未包含观测链路。');
 for(const [key,,quantity] of OBSERVER_OUTPUTS){
  const selected=instance.parameters[key];if(!selected||selected==='none')continue;
  const signal=resolveAlgorithmSignal(project,selected),child=children.find(child=>child.id===signal?.childId||child.type===signal?.child);
  if(signal?.quantity!==quantity||!child?.compiled)report(key,'所选结果与当前角度域、轴侧或编译链路不匹配。');
  else if(instance.runtimeEnabled&&!child.enabled)report(key,'所选观测结果的链路未启用运行。');
 }
 if(project.instances['foc-feedback']?.parameters.angleSource==='observer'){
  const publishers=electricalAnglePublishers(project),valid=publishers.filter(writer=>children.some(child=>child.id===writer.childId&&child.compiled));
  if(!valid.length)report('angleOutput','电角度源使用观测器时必须选择写入电角度字段的链路。');
  else if(instance.runtimeEnabled&&valid.some(writer=>!children.find(child=>child.id===writer.childId)?.enabled))report('angleOutput','发布电角度的链路未启用运行。');
 }
 return issues;
}
/** Follow the actual electrical-angle writer through PLL/filter chains without domain conversion. */
export function observerUsesModelAngle(project) {
 if(project.instances['foc-feedback']?.parameters.angleSource!=='observer')return false;
 const nodes=allChildren(project);
 function trace(reference,seen=new Set()){
  if(['smo.angle','flux.angle'].includes(reference))return true;
  const parsed=parseInstanceSignalReference(reference),signal=SIGNALS.find(signal=>signal.id===reference),id=parsed?.id||signal?.child;
  if(!id||seen.has(id))return false;
  const child=nodes.find(item=>item.child.id===id||item.child.type===id)?.child;if(!child)return false;
  const next=new Set(seen);next.add(id);return ['source','secondary'].some(key=>trace(child.routing?.[key],next));
 }
 return electricalAnglePublishers(project).some(writer=>writer.childId?trace(project.instances['foc-observer'].parameters[writer.key])||['source','secondary'].some(key=>trace(nodes.find(item=>item.child.id===writer.childId)?.child.routing?.[key])):false);
}
