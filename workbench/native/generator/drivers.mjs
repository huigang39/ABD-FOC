import {readFileSync} from 'node:fs';
import {SENSOR_ROLES,SENSOR_PARAMS,sensorFieldRequired,sensorIssues,isDiscreteGate} from '../../web/src/modules/hardware/hw-drivers/sensors.mjs';
import {SERIAL_INTERFACES} from '../../web/src/modules/hardware/hw-drivers/protocol.mjs';
import {moduleStructures,renderStructure} from './contracts.mjs';
const bytes=text=>(String(text||'').match(/[\da-f]{2}/gi)||[]).map(v=>parseInt(v,16));
const number=value=>{if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw Error('驱动参数必须为有限数值。');return value;};
const cFloat=value=>{const text=String(number(value));return (/[.eE]/.test(text)?text:text+'.0')+'f';};
export function driverConfigurationIssues(parameters){
  const issues=sensorIssues(parameters).filter(i=>i.level==='error');
  for(const role of SENSOR_ROLES){
    if(parameters[role.capability]==='absent')continue;
    if(parameters[role.capability]!=='present'){issues.push({paramKey:role.capability,message:`请选择${role.title}启用状态。`});continue;}
    if(role.id==='gate'&&isDiscreteGate(parameters)){issues.push({paramKey:'gateDriverModel',message:'分立门极驱动的 GPIO 使能与故障关断适配尚未实现，不能生成此驱动。'});continue;}
    if(!SERIAL_INTERFACES.includes(parameters[role.prefix+'Interface'])){issues.push({paramKey:role.prefix+'Interface',message:`${role.title}所选接口需要独立的采样驱动实现。`});continue;}
    for(const f of SENSOR_PARAMS.filter(f=>f.sensorRole===role.id&&sensorFieldRequired(f,parameters))){
      const v=parameters[f.key];
      if(v==null||v==='unselected'||v==='unconfirmed'||(typeof v==='string'&&!v.trim()))issues.push({paramKey:f.key,message:`${role.title}的${f.label}尚未配置。`});
    }
    const timeout=parameters[role.prefix+'TimeoutUs'];
    if(!Number.isInteger(timeout)||timeout<=0||timeout>=0x80000000)issues.push({paramKey:role.prefix+'TimeoutUs',message:'数据有效期必须为 1–2147483647 μs 的整数。'});
    const commands=Array.isArray(parameters[role.prefix+'Commands'])?parameters[role.prefix+'Commands']:[];
    if(!commands.some(command=>command?.purpose==='data'))issues.push({paramKey:role.prefix+'Commands',message:`${role.title}缺少主数据指令，无法生成接收解析。`});
    // 每条命令（含状态/其他）都要生成完整的 C 帧配置；状态命令还必须有发送指令与执行周期。
    for(const command of commands){
      const missing=[['frameBytes','接收帧长'],['dataOffset','数据起始位置'],['dataType','数值格式'],['dataBits','数值位宽'],['byteOrder','字节顺序'],['valueScale','数值倍率'],['checksum','帧校验']].filter(([key])=>command[key]==null||command[key]==='unselected').map(([,label])=>label);
      if(command?.mode==='request_response'&&!String(command.requestHex||'').trim())missing.unshift('请求指令');
      if(missing.length)issues.push({paramKey:role.prefix+'Commands',message:`${role.title}的指令尚未配置：${missing.join('、')}。`});
      else if(command?.purpose==='status'&&(!String(command.requestHex||'').trim()||!Number.isInteger(command.periodUs)||command.periodUs<=0))issues.push({paramKey:role.prefix+'Commands',message:'状态指令需要发送指令与正整数执行周期。'});
    }
  }
  return issues;
}
export function driverDescriptors(parameters){
  const issues=driverConfigurationIssues(parameters);if(issues.length)throw Error(issues.map(i=>i.message).join('\n'));
  const command=c=>({purpose:c.purpose,mode:c.mode,request:bytes(c.requestHex),header:bytes(c.headerHex),footer:bytes(c.footerHex),frame_length:c.frameBytes,data_offset:c.dataOffset,data_bits:c.dataBits,value_type:c.dataType,big_endian:c.byteOrder==='big',scale:number(c.valueScale),offset:number(c.valueOffset),checksum:c.checksum,checksum_start:c.checksum==='none'?0:c.checksumStart,status_offset:c.statusOffset??-1,status_mask:c.statusMask,status_expected:c.statusExpected,period_us:c.periodUs??0,startup_delay_us:c.startupDelayUs??0});
  return SENSOR_ROLES.map(role=>{
    const p=role.prefix;if(parameters[role.capability]==='absent')return {enabled:false};
    return {enabled:true,command_count:parameters[p+'Commands'].length,timeout_us:parameters[p+'TimeoutUs'],commands:parameters[p+'Commands'].map(command)};
  });
}
const enums={purpose:{data:'DRIVER_PURPOSE_DATA',status:'DRIVER_PURPOSE_STATUS',other:'DRIVER_PURPOSE_OTHER'},mode:{request_response:'DRIVER_REQUEST_RESPONSE',active_upload:'DRIVER_ACTIVE_UPLOAD'},value_type:{unsigned:'DRIVER_VALUE_UNSIGNED',signed:'DRIVER_VALUE_SIGNED',float32:'DRIVER_VALUE_FLOAT32'},checksum:{none:'DRIVER_CHECK_NONE',xor8:'DRIVER_CHECK_XOR8',sum8:'DRIVER_CHECK_SUM8',crc16_modbus:'DRIVER_CHECK_MODBUS'}};
function commandInitializer(c){
  const values=Object.entries(c).map(([key,value])=>{
    if(enums[key])value=enums[key][value];
    else if(['scale','offset'].includes(key))value=cFloat(value);
    else if(Array.isArray(value))value=`{${value.length?value.join(','):'0'}}`;
    return `.${key}=${value}`;
  });
  for(const key of ['request','header','footer'])values.push(`.${key}_length=${c[key].length}`);
  return '{'+values.join(',')+'}';
}
function initializer(d){
  if(!d.enabled)return '    {.enabled=false}';
  return `    {.enabled=true,.command_count=${d.command_count},.timeout_us=${d.timeout_us},.commands={${d.commands.map(commandInitializer).join(',')}}}`;
}
export function renderDrivers(project){
  const descriptors=driverDescriptors(project.instances['hw-drivers'].parameters);
  const header=readFileSync(new URL('./modules/drivers.h',import.meta.url),'utf8').replace('@CONTRACTS@',moduleStructures(project,'hw-drivers').map(renderStructure).join('\n'));
  const source=readFileSync(new URL('./modules/drivers.c',import.meta.url),'utf8')+'\nconst DriverConfig driver_config[DRIVER_CHANNELS] = {\n'+descriptors.map(initializer).join(',\n')+'\n};\n';
  return {header,source,descriptors};
}
