import { OBSERVER_CHILDREN, childParameterVisible, childDefaults } from './foc-observer/chains.mjs';
import { CHILD_DESIGNS, SIGNALS, signalChoices, OBSERVER_OUTPUTS } from './signals.mjs';
export const CHILD_TYPES = {
 'foc-observer': OBSERVER_CHILDREN,
 'foc-compensation':[
  {id:'angle_delay',title:'角度延迟补偿',fields:[['delayUs','采样延迟','μs']]},
  {id:'current_calibration',title:'电流零偏',fields:[['captureOnEnable','每次使能前采集零偏','',{type:'boolean',defaultValue:false,description:'每次从未使能进入使能流程时采集一次，复用采样与 PWM 设置；采集成功后才允许正常驱动输出。失败或取消保持输出关闭，不覆盖原零偏。'}],['sampleIntervalUs','采样间隔','μs',{min:0}],['settlingMs','采样前等待','ms',{min:0}],['durationMs','采集时长','ms',{min:0}],['pwmEnabled','采集时开启 PWM','',{type:'boolean',defaultValue:false}],['pwmDutyPercent','PWM 占空比','%',{min:0,max:100}]]},
  {id:'friction',title:'摩擦补偿',fields:[['coulombNm','库仑摩擦力矩','N·m'],['viscous','黏性摩擦系数','N·m/(rad/s)'],['transitionRadS','过零平滑速度','rad/s'],['limitNm','补偿上限','N·m']]},
 ],
};
export function createAlgorithmChild(moduleId,type) {
 const definition=CHILD_TYPES[moduleId]?.find(item=>item.id===type);
 if(!definition)throw Error('请选择子模块类型。');
 return {id:crypto.randomUUID(),type,name:definition.title,compiled:true,enabled:false,routing:{...CHILD_DESIGNS[type].defaults},parameters:childDefaults(definition)};
}
export function checkAlgorithmChildren(children) {
 if(!Array.isArray(children)||children.length>32)throw Error('每组最多 32 个子模块。');
 const ids=new Set(), types=new Set();
 for(const child of children){
  const type=Object.values(CHILD_TYPES).flat().find(type=>type.id===child?.type);
  if(!type||typeof child.id!=='string'||!child.id||(ids.has(child.id)||types.has(child.type))||typeof child.name!=='string'||typeof child.compiled!=='boolean'||typeof child.enabled!=='boolean')throw Error('算法子模块格式无效。');
  ids.add(child.id);types.add(child.type);
  if(child.routing){
   const defaults=CHILD_DESIGNS[child.type].defaults;
   if(Object.keys(child.routing).some(key=>!Object.hasOwn(defaults,key)))throw Error('子模块连接字段无效。');
   for(const [key,value] of Object.entries(child.routing)){
    if(key==='method'?!['weighted','fallback'].includes(value):!signalChoices(child.type).some(([id])=>id===value))throw Error('子模块信号类型不匹配。');
   }
  }
  if(!child.parameters||Object.keys(child.parameters).sort().join()!==type.fields.map(([key])=>key).sort().join())throw Error('子模块参数与类型不匹配。');
  for(const [key,,,options] of type.fields){const v=child.parameters[key];if(options?.type==='boolean'?typeof v!=='boolean':options?.type==='select'?!options.choices.some(([id])=>id===v):v!==null&&(typeof v!=='number'||!Number.isFinite(v)))throw Error('子模块参数类型无效。');}
 }
}
export function algorithmChildrenIssues(project) {
 const issues=[];
 for(const moduleId of Object.keys(CHILD_TYPES)){
  const instance=project.instances[moduleId];if(!instance?.enabled)continue;
  for(const child of fixedAlgorithmChildren(project,moduleId)){
   if(moduleId==='foc-compensation'&&!(instance.parameters.children||[]).length)continue;
   if(!child.compiled)continue;
   const report=(key,message)=>issues.push({id:'algorithm-routing-'+child.id+'-'+key,level:'error',title:'子模块连接检查',message:child.name+'：'+message,moduleId,paramKey:'children'});
   const routing=child.routing||{};
   for(const key of ['source','secondary'])if(routing[key]){
    const signal=SIGNALS.find(s=>s.id===routing[key]);
    if(!signal||!signalChoices(child.type,project).some(([id])=>id===signal.id)){report(key,'信号物理量不匹配。');continue;}
    if(signal.sensorRole){const capability=signal.sensorRole==='output'?'outputEncoderCapability':'encoderCapability';if(project.instances['hw-sensors']?.parameters[capability]!=='present')report(key+'-encoder',signal.sensorRole==='output'?'此来源需要已配置的出轴侧编码器。':'此来源需要已配置的电机侧编码器。');}
    const owner=signal.child?project.instances['foc-observer']:project.instances[signal.module];
    const source=signal.child?fixedAlgorithmChildren(project,'foc-observer').find(c=>c.type===signal.child):null;
    if(!owner?.enabled||(signal.child&&!source?.compiled))report(key,'输入来源没有编译。');
    else if(instance.runtimeEnabled&&child.enabled&&(!owner.runtimeEnabled||source&&!source.enabled)&&signal.child)report(key,'输入来源未启用运行。');
   }
   if(routing.secondary&&routing.source===routing.secondary)report('duplicate','融合的两个来源不能相同。');
   if(child.type.endsWith('_fusion')&&routing.method==='weighted'&&!(child.parameters.weight>=0&&child.parameters.weight<=1&&child.parameters.weight!==null))report('weight','主来源权重应在 0～1 之间。');
   for(const [key,label,,options] of CHILD_TYPES[moduleId].find(t=>t.id===child.type).fields){
    if(!childParameterVisible(child,[key,label,'',options])||['boolean','select'].includes(options?.type))continue;
    if(moduleId==='foc-compensation'&&child.type==='friction')continue;
    const value=child.parameters[key];
    if(typeof value!=='number'||!Number.isFinite(value))report(key,label+'尚未配置。');
    else if((options?.min!==undefined&&value<options.min)||(options?.max!==undefined&&value>options.max)||((options?.exclusiveMin||['sampleIntervalUs','durationMs'].includes(key))&&value<=0))report(key,label+'超出允许范围。');
    else if((/bandwidth|inertia|Gain/.test(key)&&value<=0)||(/delay|transition|limit/.test(key)&&value<0))report(key,label+'超出允许范围。');
   }
   const board=project.instances['hw-board']?.parameters;
   const rate=board?.pwmHz/board?.currentLoopDivider;
   for(const field of CHILD_TYPES[moduleId].find(t=>t.id===child.type).fields){
    const [key,label,,options]=field;
    if(options?.rateLimited&&childParameterVisible(child,field)&&Number.isFinite(rate)&&child.parameters[key]>=rate/2)report(key+'-rate',label+'必须低于电流环采样频率的一半；可用范围仍需结合延迟验证。');
   }
   if(child.type==='current_calibration'&&child.parameters.durationMs*1000<child.parameters.sampleIntervalUs)report('duration','采集时长必须至少覆盖一个采样间隔。');
   issues.push({id:'algorithm-child-'+child.id,level:'pending',title:'子模块实现待接入',message:child.name+' 的独立实例与执行连接尚未接入固件生成。',moduleId,paramKey:'children'});
  }
 }
 issues.push(...observerOutputIssues(project));
 const plan=algorithmExecutionPlan(project);
 if(plan.cycle)issues.push({id:'algorithm-routing-cycle',level:'error',title:'观测连接形成循环',message:'当前周期的数据连接存在循环，请更换输入来源。',moduleId:'foc-observer',paramKey:'children'});
 return issues;
}

export function fixedAlgorithmChildren(project,moduleId) {
 const instance=project.instances[moduleId];
 const primaryType=moduleId==='foc-compensation'?'friction':null;
 return CHILD_TYPES[moduleId].map(type=>{
  const saved=instance.parameters.children?.find(child=>child.type===type.id);
  return saved?{...saved,id:type.id,name:type.title,routing:{...CHILD_DESIGNS[type.id].defaults,...saved.routing}}:{
   id:type.id,type:type.id,name:type.title,routing:{...CHILD_DESIGNS[type.id].defaults},compiled:type.id===primaryType,
   enabled:type.id===primaryType&&instance.runtimeEnabled,
   parameters:childDefaults(type)
  };
 });
}

/** Producer-first order; same-period cycles are rejected instead of silently delaying a signal. */
export function algorithmExecutionPlan(project) {
 const nodes=Object.keys(CHILD_TYPES).flatMap(moduleId=>project.instances[moduleId]?.enabled?fixedAlgorithmChildren(project,moduleId).filter(c=>c.compiled):[]);
 const byId=new Map(nodes.map(c=>[c.type,c])), visiting=new Set(), done=new Set(), order=[];
 let cycle=false;
 function visit(node){
  if(done.has(node.type))return;
  if(visiting.has(node.type)){cycle=true;return;}
  visiting.add(node.type);
  for(const key of ['source','secondary']){
   const source=SIGNALS.find(s=>s.id===node.routing?.[key]);
   if(source?.child&&byId.has(source.child))visit(byId.get(source.child));
  }
  visiting.delete(node.type);done.add(node.type);order.push(node.type);
 }
 for(const node of nodes)visit(node);
 return {order:cycle?[]:order,cycle};
}

export function observerOutputIssues(project) {
 const instance=project.instances['foc-observer'];if(!instance?.enabled)return [];
 const children=fixedAlgorithmChildren(project,'foc-observer'),issues=[];
 const report=(key,message)=>issues.push({id:'observer-output-'+key,level:'error',title:'观测结果检查',message,moduleId:'foc-observer',paramKey:key});
 if(!children.some(c=>c.compiled))report('children','尚未包含观测链路。');
 for(const [key,,quantity] of OBSERVER_OUTPUTS){
  const selected=instance.parameters[key];if(!selected||selected==='none')continue;
  const signal=SIGNALS.find(s=>s.id===selected),child=children.find(c=>c.type===signal?.child);
  if(signal?.quantity!==quantity||!child?.compiled)report(key,'所选结果与当前角度域、轴侧或编译链路不匹配。');
  else if(instance.runtimeEnabled&&!child.enabled)report(key,'所选观测结果的链路未启用运行。');
 }
 if(project.instances['foc-feedback']?.parameters.angleSource==='observer'&&instance.parameters.angleOutput==='none')report('angleOutput','电角度源使用观测器时必须选择发布的电角度。');
 return issues;
}

/** Startup is needed only when a model-based angle can actually feed commutation. */
export function observerUsesModelAngle(project) {
 if(project.instances['foc-feedback']?.parameters.angleSource!=='observer')return false;
 const observer=project.instances['foc-observer'];
 if(!observer)return false;
 const selected=observer.parameters.angleOutput;
 if(['smo.angle','flux.angle'].includes(selected))return true;
 if(selected!=='angle_fusion.angle')return false;
 const fusion=fixedAlgorithmChildren(project,'foc-observer').find(c=>c.type==='angle_fusion');
 return [fusion.routing.source,fusion.routing.secondary].some(id=>['smo.angle','flux.angle'].includes(id));
}
