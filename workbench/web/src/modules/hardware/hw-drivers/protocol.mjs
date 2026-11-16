import { DRIVER_FRAME_BYTES, DRIVER_TX_BYTES, DRIVER_COMMANDS_MAX } from './contracts.mjs';
export { DRIVER_COMMANDS_MAX };
/** 驱动命令：每个串行通道一组收发单元；主数据命令产出测量值，状态读取独立成命令。 */
export const SERIAL_INTERFACES=['spi','uart','rs485','i2c','ssi','biss','can'];
export const COMMAND_PURPOSES=[['data','主数据'],['status','状态读取'],['other','其他指令']];
export const DRIVER_COMMAND_KEYS=['id','name','purpose','mode','requestHex','periodUs','startupDelayUs','headerHex','footerHex','frameBytes','dataOffset','dataType','dataBits','byteOrder','valueScale','valueOffset','checksum','checksumStart','statusOffset','statusMask','statusExpected'];
const hexByteCount=text=>String(text||'').replace(/\s/g,'').length/2;
const isHexBytes=text=>/^(?:\s*[\da-f]{2})*\s*$/i.test(String(text||''));
export function createDriverCommand(purpose='data',id=globalThis.crypto?.randomUUID?.()||`command-${Date.now()}-${Math.random().toString(36).slice(2,10)}`){
  return {id,name:COMMAND_PURPOSES.find(([value])=>value===purpose)?.[1]||'指令',purpose,mode:'request_response',requestHex:'',periodUs:null,startupDelayUs:0,headerHex:'',footerHex:'',frameBytes:null,dataOffset:null,dataType:'unselected',dataBits:null,byteOrder:'unselected',valueScale:null,valueOffset:0,checksum:'unselected',checksumStart:0,statusOffset:null,statusMask:0,statusExpected:0};
}
export function checkDriverCommandShape(commands){
  if(!Array.isArray(commands)||commands.length>DRIVER_COMMANDS_MAX)throw Error(`驱动命令必须是不超过 ${DRIVER_COMMANDS_MAX} 条的数组。`);
  const ids=new Set();let dataCommands=0;
  const integer=(value,min,max,label)=>{if(value!==null&&(!Number.isSafeInteger(value)||value<min||value>max))throw Error(`驱动命令的${label}必须是 ${min} 至 ${max} 的整数或 null。`);};
  const hex=(value,limit,label)=>{if(!isHexBytes(value))throw Error(`驱动命令的${label}必须是完整的十六进制字节，例如 AA 55。`);if(hexByteCount(value)>limit)throw Error(`驱动命令的${label}最多 ${limit} 字节。`);};
  for(const command of commands){
    if(command===null||typeof command!=='object'||Array.isArray(command))throw Error('驱动命令必须是对象。');
    for(const key of Object.keys(command))if(!DRIVER_COMMAND_KEYS.includes(key))throw Error(`驱动命令含未知字段：${key}`);
    for(const key of DRIVER_COMMAND_KEYS)if(!Object.hasOwn(command,key))throw Error(`驱动命令缺少字段：${key}`);
    if(typeof command.id!=='string'||!command.id)throw Error('驱动命令 ID 必须是非空文本。');
    if(ids.has(command.id))throw Error(`驱动命令 ID 必须唯一：${command.id}`);
    ids.add(command.id);
    if(typeof command.name!=='string')throw Error('驱动命令名称必须是文本。');
    if(!COMMAND_PURPOSES.some(([value])=>value===command.purpose))throw Error('驱动命令用途不是允许的选项。');
    if(command.purpose==='data')dataCommands++;
    if(!['request_response','active_upload'].includes(command.mode))throw Error('驱动命令通信模式不是允许的选项。');
    hex(command.requestHex,DRIVER_TX_BYTES,'发送指令');hex(command.headerHex,DRIVER_FRAME_BYTES,'接收帧头');hex(command.footerHex,DRIVER_FRAME_BYTES,'接收帧尾');
    integer(command.periodUs,1,60000000,'执行周期');integer(command.startupDelayUs,0,10000000,'启动等待');
    integer(command.frameBytes,1,DRIVER_FRAME_BYTES,'接收帧长');integer(command.dataOffset,0,DRIVER_FRAME_BYTES-1,'数据起始位置');
    if(!['unselected','unsigned','signed','float32'].includes(command.dataType))throw Error('驱动命令数值格式不是允许的选项。');
    integer(command.dataBits,8,32,'数值位宽');
    if(!['unselected','little','big'].includes(command.byteOrder))throw Error('驱动命令字节顺序不是允许的选项。');
    for(const [key,label] of [['valueScale','数值倍率'],['valueOffset','数值偏移']])if(command[key]!==null&&(typeof command[key]!=='number'||!Number.isFinite(command[key])))throw Error(`驱动命令的${label}必须是有限数字或 null。`);
    if(!['unselected','none','xor8','sum8','crc16_modbus'].includes(command.checksum))throw Error('驱动命令帧校验不是允许的选项。');
    integer(command.checksumStart,0,DRIVER_FRAME_BYTES-1,'校验起始位置');integer(command.statusOffset,0,DRIVER_FRAME_BYTES-1,'状态字节位置');
    integer(command.statusMask,0,255,'状态位掩码');integer(command.statusExpected,0,255,'状态期望值');
  }
  if(dataCommands>1)throw Error('每个通道最多一条主数据指令。');
}
export function sensorCommandIssues(parameters,role){
  const p=role.prefix,issues=[];
  if(parameters[role.capability]!=='present'||role.id==='gate'&&parameters[p+'Model']==='discrete'||!SERIAL_INTERFACES.includes(parameters[p+'Interface']))return issues;
  const commands=Array.isArray(parameters[p+'Commands'])?parameters[p+'Commands']:[],data=commands.find(command=>command?.purpose==='data');
  const pending=(key,label)=>issues.push({id:`sensor-command-${p}-${key}`,level:'pending',title:`${role.title} · ${label}待填写`,message:'补充当前传感器方案所需的配置。',moduleId:'hw-drivers',paramKey:p+'Commands'});
  if(!data){pending('data','主数据指令');return issues;}
  const add=(key,message)=>issues.push({id:`sensor-frame-${p}-${key}`,level:'error',title:`${role.title} · 帧格式无效`,message,moduleId:'hw-drivers',paramKey:p+'Commands'});
  if(data.mode==='request_response'&&!String(data.requestHex||'').trim())pending('requestHex','请求指令');
  for(const [key,label] of [['frameBytes','接收帧长'],['dataOffset','数据起始位置'],['dataType','数值格式'],['dataBits','数值位宽'],['byteOrder','字节顺序'],['checksum','帧校验'],['valueScale','数值倍率']])if(data[key]==null||data[key]==='unselected')pending(key,label);
  const bytes=data.frameBytes,offset=data.dataOffset,bits=data.dataBits,header=hexByteCount(data.headerHex),footer=hexByteCount(data.footerHex);
  const checksum=data.checksum,checkBytes=checksum==='crc16_modbus'?2:['xor8','sum8'].includes(checksum)?1:0;
  const end=bytes-footer-checkBytes;
  if(header&&offset!=null&&offset<header)add('dataOffset','数据起始位置与固定帧头重叠。');
  if(bytes!=null&&offset!=null&&bits!=null&&offset+bits/8>end)add('frameBytes','帧长不足以容纳帧头、数值、校验和帧尾。');
  if(bits!=null&&![8,16,24,32].includes(bits))add('dataBits','数值位宽只能选择 8、16、24 或 32 bit。');
  if(data.dataType==='float32'&&bits!=null&&bits!==32)add('dataBits','float32 数值位宽必须为 32 bit。');
  if(checkBytes&&bytes!=null&&data.checksumStart!=null&&data.checksumStart>=end)add('checksumStart','校验起始位置必须位于校验字段之前。');
  const status=data.statusOffset,mask=data.statusMask,expected=data.statusExpected;
  if(status!=null&&bytes!=null&&(status<header||status>=end))add('statusOffset','状态字节必须位于帧头之后、校验和帧尾之前。');
  if(mask&&status==null)add('statusOffset','使用状态位检查时，需要指定状态字节。');
  if(mask!=null&&expected!=null&&(expected&mask)!==expected)add('statusExpected','期望值不能包含掩码范围外的位。');
  return issues;
}
