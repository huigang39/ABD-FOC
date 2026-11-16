import { DRIVER_FRAME_BYTES, DRIVER_TX_BYTES } from './contracts.mjs';
export const SERIAL_INTERFACES=['spi','uart','rs485','i2c','ssi','biss','can'];
const choices=items=>items.map(([value,label])=>({value,label}));
export function sensorProtocolFields(role) {
  const field=(suffix,label,type,defaultValue,extra={})=>({key:role.prefix+suffix,label,type,defaultValue,phase:'init',description:`${role.title}的${label}。`,required:false,sensorRole:role.id,sensorGroup:'protocol',when:'serial',sensorRequired:true,...extra});
  const select=(suffix,label,items,extra={})=>field(suffix,label,'select','unselected',{options:choices([['unselected','待选择'],...items]),...extra});
  return [
    select('TransferMode','通信模式',[['request_response','请求应答'],['active_upload','主动上传']],{sensorLayoutTrigger:true,description:'请求应答按采样时序发送请求；主动上传只在初始化时发送启动指令，之后持续接收。'}),
    field('RequestHex','请求指令','text','',{when:'request_response',sensorRequired:true,description:'每次采样发送的完整十六进制字节，包含协议要求的校验，例如 01 03 00 00。'}),
    field('StartHex','启动上传指令','text','',{when:'active_upload',sensorRequired:false,description:'初始化时发送一次的完整十六进制字节；设备上电即上传时可留空。运行中不会周期重发，重新初始化后才再次发送。'}),
    field('StartupDelayUs','启动等待','integer',0,{min:0,max:10000000,unit:'μs',description:'初始化后等待指定时间再发送首条指令，等待期间不阻塞其他模块。'}),
    field('HeaderHex','接收帧头','text','',{sensorRequired:false,description:'固定十六进制帧头，例如 AA 55；无固定帧头可留空。'}),
    field('FooterHex','接收帧尾','text','',{sensorRequired:false,description:'固定十六进制帧尾；不含校验字段，没有时留空。'}),
    field('FrameBytes','接收帧长','integer',null,{min:1,max:DRIVER_FRAME_BYTES,unit:'byte',description:'完整帧的字节数，包含帧头、数据、校验和帧尾。'}),
    field('DataOffset','数据起始位置','integer',null,{min:0,max:DRIVER_FRAME_BYTES-1,unit:'byte',description:'从完整接收帧第 0 字节开始计数。'}),
    select('DataType','数值格式',[['unsigned','无符号整数'],['signed','有符号整数'],['float32','IEEE 754 · float32']],{sensorLayoutTrigger:true}),
    field('DataBits','数值位宽','integer',null,{options:choices([8,16,24,32].map(value=>[value,`${value} bit`])),min:8,max:32}),
    select('ByteOrder','字节顺序',[['little','低字节在前'],['big','高字节在前']]),
    field('ValueScale','数值倍率','number',null,{description:'解析值 × 倍率 + 偏移，得到通道输出值；编码器为 rad，力矩为所选接口输出单位。'}),
    field('ValueOffset','数值偏移','number',0,{description:'协议数值换算偏移，不替代校准或标零记录。'}),
    select('Checksum','帧校验',[['none','无'],['xor8','XOR-8'],['sum8','SUM-8'],['crc16_modbus','CRC-16/MODBUS']],{sensorLayoutTrigger:true,description:'校验字段位于固定帧尾之前；MODBUS CRC 低字节在前。'}),
    field('ChecksumStart','校验起始位置','integer',0,{when:'checksum',min:0,max:DRIVER_FRAME_BYTES-1,unit:'byte',description:'从第 0 字节计数，校验覆盖到校验字段之前。'}),
    field('StatusOffset','状态字节位置','integer',null,{sensorRequired:false,min:0,max:DRIVER_FRAME_BYTES-1,unit:'byte',description:'可选。提取器件状态字节；未设置时不读取。'}),
    field('StatusMask','状态位掩码','integer',0,{min:0,max:255,description:'状态字节与掩码按位与后应等于期望值，否则此帧无效。0 表示仅记录状态，不据此拒绝数据。'}),
    field('StatusExpected','状态期望值','integer',0,{min:0,max:255}),
  ];
}
export function sensorProtocolVisible(field,parameters,role) {
  const p=role.prefix;
  if(!SERIAL_INTERFACES.includes(parameters[p+'Interface']))return false;
  if(['request_response','active_upload'].includes(field.when))return parameters[p+'TransferMode']===field.when;
  if(field.when==='checksum')return !['unselected','none'].includes(parameters[p+'Checksum']);
  return true;
}
export function sensorProtocolIssues(parameters,role) {
  const p=role.prefix, issues=[];
  if(parameters[role.capability]!=='present'||!SERIAL_INTERFACES.includes(parameters[p+'Interface']))return issues;
  const add=(suffix,message)=>issues.push({id:`sensor-frame-${p}-${suffix}`,level:'error',title:`${role.title} · 帧格式无效`,message,moduleId:'hw-drivers',paramKey:p+suffix});
  const hexBytes=(key,limit)=>{
    const hex=parameters[p+key]||'';
    if(!/^(?:\s*[\da-f]{2})*\s*$/i.test(hex)){add(key,'请输入完整的十六进制字节，例如 AA 55。');return null;}
    const n=hex.replace(/\s/g,'').length/2;
    if(n>limit)add(key,`最多 ${limit} 字节。`);
    return n;
  };
  hexBytes(parameters[p+'TransferMode']==='active_upload'?'StartHex':'RequestHex',DRIVER_TX_BYTES);
  const header=hexBytes('HeaderHex',DRIVER_FRAME_BYTES),footer=hexBytes('FooterHex',DRIVER_FRAME_BYTES);
  const bytes=parameters[p+'FrameBytes'],offset=parameters[p+'DataOffset'],bits=parameters[p+'DataBits'];
  const checksum=parameters[p+'Checksum'],checkBytes=checksum==='crc16_modbus'?2:['xor8','sum8'].includes(checksum)?1:0;
  const end=bytes-footer-checkBytes;
  if(header!==null&&offset!=null&&offset<header)add('DataOffset','数据起始位置与固定帧头重叠。');
  if(bytes!=null&&offset!=null&&bits!=null&&offset+bits/8>end)add('FrameBytes','帧长不足以容纳帧头、数值、校验和帧尾。');
  if(bits!=null&&![8,16,24,32].includes(bits))add('DataBits','数值位宽只能选择 8、16、24 或 32 bit。');
  if(parameters[p+'DataType']==='float32'&&bits!=null&&bits!==32)add('DataBits','float32 数值位宽必须为 32 bit。');
  if(checkBytes&&bytes!=null&&parameters[p+'ChecksumStart']!=null&&parameters[p+'ChecksumStart']>=end)add('ChecksumStart','校验起始位置必须位于校验字段之前。');
  const status=parameters[p+'StatusOffset'],mask=parameters[p+'StatusMask'],expected=parameters[p+'StatusExpected'];
  if(status!=null&&bytes!=null&&(status<header||status>=end))add('StatusOffset','状态字节必须位于帧头之后、校验和帧尾之前。');
  if(mask&&status==null)add('StatusOffset','使用状态位检查时，需要指定状态字节。');
  if(mask!=null&&expected!=null&&(expected&mask)!==expected)add('StatusExpected','期望值不能包含掩码范围外的位。');
  return issues;
}
