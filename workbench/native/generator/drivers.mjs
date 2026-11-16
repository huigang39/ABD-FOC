import {readFileSync} from 'node:fs';
import {SENSOR_ROLES,SENSOR_PARAMS,sensorFieldRequired,sensorIssues} from '../../web/src/modules/hardware/hw-drivers/sensors.mjs';
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
    if(!SERIAL_INTERFACES.includes(parameters[role.prefix+'Interface'])){issues.push({paramKey:role.prefix+'Interface',message:`${role.title}所选接口需要独立的采样驱动实现。`});continue;}
    for(const f of SENSOR_PARAMS.filter(f=>f.sensorRole===role.id&&sensorFieldRequired(f,parameters))){
      const v=parameters[f.key];
      if(v==null||v==='unselected'||v==='unconfirmed'||(typeof v==='string'&&!v.trim()))issues.push({paramKey:f.key,message:`${role.title}的${f.label}尚未配置。`});
    }
    const timeout=parameters[role.prefix+'TimeoutUs'];
    if(!Number.isInteger(timeout)||timeout<=0||timeout>=0x80000000)issues.push({paramKey:role.prefix+'TimeoutUs',message:'数据有效期必须为 1–2147483647 μs 的整数。'});
  }
  return issues;
}
export function driverDescriptors(parameters){
  const issues=driverConfigurationIssues(parameters);if(issues.length)throw Error(issues.map(i=>i.message).join('\n'));
  return SENSOR_ROLES.map(role=>{
    const p=role.prefix;if(parameters[role.capability]==='absent')return {enabled:false};
    const get=s=>parameters[p+s];
    return {enabled:true,mode:get('TransferMode'),request:bytes(get(get('TransferMode')==='active_upload'?'StartHex':'RequestHex')),header:bytes(get('HeaderHex')),footer:bytes(get('FooterHex')),frame_length:get('FrameBytes'),data_offset:get('DataOffset'),data_bits:get('DataBits'),value_type:get('DataType'),big_endian:get('ByteOrder')==='big',scale:number(get('ValueScale')),offset:number(get('ValueOffset')),checksum:get('Checksum'),checksum_start:get('Checksum')==='none'?0:get('ChecksumStart'),status_offset:get('StatusOffset')??-1,status_mask:get('StatusMask'),status_expected:get('StatusExpected'),timeout_us:get('TimeoutUs'),startup_delay_us:get('StartupDelayUs')};
  });
}
const enums={mode:{request_response:'DRIVER_REQUEST_RESPONSE',active_upload:'DRIVER_ACTIVE_UPLOAD'},value_type:{unsigned:'DRIVER_VALUE_UNSIGNED',signed:'DRIVER_VALUE_SIGNED',float32:'DRIVER_VALUE_FLOAT32'},checksum:{none:'DRIVER_CHECK_NONE',xor8:'DRIVER_CHECK_XOR8',sum8:'DRIVER_CHECK_SUM8',crc16_modbus:'DRIVER_CHECK_MODBUS'}};
function initializer(d){
  if(!d.enabled)return '    {.enabled=false}';
  const values=Object.entries(d).map(([key,value])=>{
    if(enums[key])value=enums[key][value];
    else if(['scale','offset'].includes(key))value=cFloat(value);
    else if(Array.isArray(value))value=`{${value.length?value.join(','):'0'}}`;
    return `.${key}=${value}`;
  });
  for(const key of ['request','header','footer'])values.push(`.${key}_length=${d[key].length}`);
  return '    {'+values.join(',')+'}';
}
export function renderDrivers(project){
  const descriptors=driverDescriptors(project.instances['hw-drivers'].parameters);
  const header=readFileSync(new URL('./modules/drivers.h',import.meta.url),'utf8').replace('@CONTRACTS@',moduleStructures(project,'hw-drivers').map(renderStructure).join('\n'));
  const source=readFileSync(new URL('./modules/drivers.c',import.meta.url),'utf8')+'\nconst DriverConfig driver_config[DRIVER_CHANNELS] = {\n'+descriptors.map(initializer).join(',\n')+'\n};\n';
  return {header,source,descriptors};
}
