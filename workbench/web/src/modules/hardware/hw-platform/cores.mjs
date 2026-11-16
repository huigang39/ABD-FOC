import { INTERRUPT_LEVELS, interruptPriorityMapping } from './priorities.mjs';
import { number, integer, select, choices, unset } from '../../shared/fields.mjs';
import { getMcuCores, identifyMcu } from './targets.mjs';
import { validateOscillatorClock } from './clocks.mjs';

// ST DS12923 / DS12288 and CMSIS device headers; HPM5300 FSV0.5 / UM1.0.
// https://www.st.com/resource/en/datasheet/stm32g474mb.pdf
// https://www.hpmicro.com/Public/Uploads/uploadfile/files/20240822/HPM5300FSV05.pdf
// These are capability/target checks, not a PLL, supply or Flash-latency implementation.
export const H745_AHB_DIVIDERS = Object.freeze([1,2,4,8,16,64,128,256,512]);
export function coreCapabilities(mcu, coreId) {
  const family=identifyMcu(mcu);
  if(!family?.cores.some(core=>core.id===coreId))return null;
  const base={architecture:family.architecture};
  if(family.prefix==='STM32H745')return {...base,irqPriorityBits:4,maxClockHz:coreId==='cm7'?480000000:240000000,defaultClockHz:coreId==='cm7'?400000000:200000000,cache:coreId==='cm7',clockFromBus:coreId==='cm4',busName:'D2 HCLK',fpu:coreId==='cm7'?'FPv5 · 单 / 双精度':'FPv4 · 单精度'};
  if(family.prefix==='STM32G474')return {...base,irqPriorityBits:4,maxClockHz:170000000,defaultClockHz:150000000,cache:false,clockFromBus:true,busName:'AHB HCLK',fpu:'FPv4 · 单精度'};
  if(family.vendor==='hpmicro')return {...base,maxClockHz:family.prefix==='HPM5301'?360000000:480000000,defaultClockHz:360000000,cache:true,clockFromBus:false,fpu:'RISC-V · 单 / 双精度'};
  return base;
}

export const CORE_FIELDS = [
  number('clockHz','内核时钟','Hz','init','目标频率须满足共享时钟树、供电档位与 FLASH 等待周期约束。',{min:1,group:'clock'}),
  number('systemTickHz','系统时基','Hz','init','当前内核独立的系统计时基准。',{min:1,group:'clock'}),
  integer('irqPriorityBits','中断优先级位数','init','按当前内核实现选择。',{min:1,max:8,group:'interrupt',architectureOnly:'arm'}),
  select('controlIrqPriority','电流采样中断优先级',INTERRUPT_LEVELS,'init','逻辑等级由 MCU 适配层映射；不指定固定执行内核。',{group:'interrupt',required:false,defaultValue:'realtime'}),
  select('communicationIrqPriority','通信中断优先级',INTERRUPT_LEVELS,'init','根据通信时限选择逻辑等级，由 MCU 适配层映射；通信实现未接入前保持未配置。',{group:'interrupt',required:false,defaultValue:null}),
  select('floatAbi','浮点约定',choices([unset,['hard','硬件浮点 ABI'],['softfp','软件 ABI / 硬件运算'],['soft','软件浮点']]),'compile','分别与当前内核的编译、链接对象保持一致。',{group:'core',architectureOnly:'arm'}),
  select('instructionCache','指令缓存',choices([unset,['enabled','启用'],['disabled','禁用']]),'init','仅作用于当前内核的指令缓存。',{group:'core'}),
  select('dataCache','数据缓存',choices([unset,['enabled','启用'],['disabled','禁用']]),'init','当前内核的数据缓存；共享内存及 DMA 仍需指定一致性策略。',{group:'core'}),
];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
export function createCoreSettings(mcu, coreId) {
  const caps=coreCapabilities(mcu,coreId);
  const settings=Object.fromEntries(CORE_FIELDS.map(field=>[field.key,field.defaultValue]));
  if(caps)Object.assign(settings,{clockHz:caps.defaultClockHz??null,systemTickHz:1000,floatAbi:caps.fpu?'hard':settings.floatAbi,irqPriorityBits:caps.irqPriorityBits??null,instructionCache:'disabled',dataCache:'disabled'});
  return settings;
}
export function createCoreConfigs(mcu) {
  return Object.fromEntries(getMcuCores(mcu).map(core=>[core.id,createCoreSettings(mcu,core.id)]));
}
export function checkCoreConfigShape(configs) {
  if(!plain(configs)||Object.keys(configs).length>16)throw new Error('各核配置必须是最多 16 个内核的对象。');
  for(const [id,params] of Object.entries(configs)) {
    if(!/^[a-z][a-z0-9_-]{0,39}$/.test(id)||!plain(params))throw new Error('内核配置标识或格式无效。');
    if(Object.keys(params).some(key=>!CORE_FIELDS.some(field=>field.key===key)))throw new Error(`内核 ${id} 含未知参数。`);
    for(const field of CORE_FIELDS) {
      const value=params[field.key];
      if(value===undefined)throw new Error(`内核 ${id} 缺少 ${field.key}。`);
      if(value===null)continue;
      if(['number','integer'].includes(field.type)&&(typeof value!=='number'||!Number.isFinite(value)||field.type==='integer'&&!Number.isSafeInteger(value)))throw new Error(`内核 ${id} 的 ${field.label}必须为有效数值。`);
      if(field.type==='select'&&!field.options.some(option=>option.value===value))throw new Error(`内核 ${id} 的 ${field.label}选项无效。`);
    }
  }
}
export function coreRoles(mcu, project) {
  const cores=getMcuCores(mcu), assignments=project?.execution?.assignments||{};
  const assigned=id=>cores.some(core=>core.id===assignments[id])?assignments[id]:'';
  return {
    control:assigned('foc-current')||(cores.length===1?cores[0].id:''),
    communication:assigned('app-comms')||(cores.length===1?cores[0].id:''),
    communicationEnabled:project?.instances?.['app-comms']?.enabled===true,
  };
}
export function coreFields(mcu,coreId,project) {
  const caps=coreCapabilities(mcu,coreId)||{}, roles=coreRoles(mcu,project);
  return CORE_FIELDS.filter(field=>field.key!=='irqPriorityBits'&&(!field.architectureOnly||field.architectureOnly===caps.architecture)&&(!/Cache$/.test(field.key)||caps.cache!==false)&&(field.key!=='controlIrqPriority'||coreId===roles.control)&&(field.key!=='communicationIrqPriority'||roles.communicationEnabled&&coreId===roles.communication)).map(field=>{
    const priority=field.key.endsWith('IrqPriority');
    const required=field.key==='controlIrqPriority'?coreId===roles.control:field.key==='communicationIrqPriority'?roles.communicationEnabled&&coreId===roles.communication:field.required;
    const options=field.options;
    return {...field,required,...(priority?{description:field.description+(interruptPriorityMapping(mcu)?' 当前映射：紧急 0、实时 3、高 7、普通 11、后台 15。':' 当前 MCU 的中断映射尚未适配。')}:{}),...(options?{options}:{}),...(field.key==='clockHz'&&caps.maxClockHz?{max:caps.maxClockHz}:{}),...(field.key==='clockHz'&&caps.clockFromBus?{description:`Cortex-M4 使用 ${caps.busName}，须与芯片公共配置的总线时钟一致。`}:{})};
  });
}
export function validateCoreConfigs(mcu,platform,project) {
  const issues=validateOscillatorClock(mcu,platform), cores=getMcuCores(mcu), configs=platform?.coreConfigs;
  const add=(id,level,message,coreId='',coreKey='')=>issues.push({id:`core-${id}`,level,title:level==='error'?'内核配置冲突':'内核配置待完善',message,moduleId:'hw-platform',paramKey:'coreConfigs',coreId,coreKey});
  try{checkCoreConfigShape(configs);}catch(error){add('format','error',error.message);return issues;}
  for(const id of Object.keys(configs))if(!cores.some(core=>core.id===id))add(`${id}-target`,'error',`${id} 不属于当前 MCU，请移除该内核配置。`,id);
  for(const core of cores) {
    const params=configs[core.id], caps=coreCapabilities(mcu,core.id);
    if(!interruptPriorityMapping(mcu))add(`${core.id}-priority-capability`,'pending',`${core.label} 的逻辑中断优先级映射尚未适配，构建前需完善控制器等级与抢占分组信息。`,core.id);
    if(!params){add(`${core.id}-missing`,'pending',`${core.label} 尚未配置。`,core.id);continue;}
    for(const field of coreFields(mcu,core.id,project)) {
      const value=params[field.key], blank=value===null||value==='unselected';
      if(blank){if(field.required)add(`${core.id}-${field.key}-empty`,'pending',`${core.label} · ${field.label}待配置。`,core.id,field.key);continue;}
      if((field.options&&!field.options.some(option=>option.value===value))||typeof value==='number'&&((field.min!==undefined&&value<field.min)||(field.max!==undefined&&value>field.max)))add(`${core.id}-${field.key}-range`,'error',`${core.label} · ${field.label}超出当前内核支持范围。`,core.id,field.key);
      if(field.key.endsWith('IrqPriority')&&caps.architecture==='arm'&&caps.irqPriorityBits&&value>=2**caps.irqPriorityBits)add(`${core.id}-${field.key}-bits`,'error',`${core.label} · ${field.label}超出优先级位数范围。`,core.id,field.key);
    }
    if(caps.cache===false&&['instructionCache','dataCache'].some(key=>!['disabled','unselected',null].includes(params[key])))add(`${core.id}-cache`,'error',`${core.label} 没有独立的指令 / 数据缓存，不能启用这些配置。`,core.id);
    if(params.clockHz&&platform.busClockHz) {
      if(caps.clockFromBus&&params.clockHz!==platform.busClockHz)add(`${core.id}-clock-link`,'error',`${core.label} 时钟必须等于 ${caps.busName}（当前总线时钟）。`,core.id,'clockHz');
      if(caps.clockFromBus===false&&platform.busClockHz>params.clockHz)add(`${core.id}-clock-order`,'error',`${core.label} 时钟低于总线时钟，请核对时钟树。`,core.id,'clockHz');
    }
    if(core.id==='cm4'&&identifyMcu(mcu)?.prefix==='STM32H745'&&params.clockHz>0&&configs.cm7?.clockHz>0&&!H745_AHB_DIVIDERS.some(divider=>Math.abs(configs.cm7.clockHz/divider-params.clockHz)<=4*Number.EPSILON*Math.max(1,params.clockHz)))add(`${core.id}-clock-divider`,'error','Cortex-M4 时钟须由 Cortex-M7 时钟按有效 AHB 分频得到（1、2、4、8、16、64、128、256、512）。',core.id,'clockHz');
  }
  return issues;
}
