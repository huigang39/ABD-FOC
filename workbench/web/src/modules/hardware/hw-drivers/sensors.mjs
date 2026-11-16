import { sensorResources } from '../hw-board/resources.mjs';
import { createDriverCommand, sensorCommandIssues } from './protocol.mjs';
import { driverResourceOccupants } from './resource-usage.mjs';
/** Maintained encoder models set transport defaults; frame formats remain explicit parameters. */
const options = entries => entries.map(([value,label])=>({value,label}));
const states = options([['unconfirmed','待确定'],['present','启用'],['absent','禁用']]);
const interfaces = options([['unselected','待选择'],['adc','ADC / 模拟采样'],['spi','SPI'],['i2c','I²C'],['uart','UART'],['rs485','RS-485'],['abz','ABZ / 定时器'],['ssi','SSI'],['biss','BiSS-C'],['can','CAN'],['custom','自定义接口']]);
export const SENSOR_ROLES = [
  {id:'motor',title:'角度编码器',capability:'encoderCapability',prefix:'motorEncoder',description:'转子角度，供电角度计算与换相使用。'},
  {id:'output',title:'角度编码器（出轴侧）',capability:'outputEncoderCapability',prefix:'outputEncoder',description:'减速机输出轴位置，供全闭环位置控制使用。'},
  {id:'torque',title:'力矩传感器',capability:'torqueCapability',prefix:'torqueSensor',description:'测量输出负载力矩，与电流估计力矩分别记录。'},
  {id:'gate',title:'门极驱动器',capability:'gateDriverCapability',prefix:'gateDriver',description:'三相门极驱动器；提供功率级故障状态，参与通道有效性与内核分配。'},
];
export const isDiscreteGate = parameters => parameters?.gateDriverModel === 'discrete';
const encoderModels = new Map([
  ...['MC_ENCODER_GW_OUTER','MC_ENCODER_GW_INNER','GW 外圈','GW 内圈','GW Outer','GW Inner','gongwang','弓望'].map(model => [model,{vendor:'gongwang',interface:'rs485'}]),
  ...['MC_ENCODER_JG','jingang','金刚'].map(model => [model,{vendor:'jingang',interface:'rs485'}]),
]);
export const encoderInterfaceForModel = model => encoderModels.get(model)?.interface || '';
/** An explicit model selection never invents baud rate, frame fields or pin assignments. */
export function applyEncoderModel(parameters, prefix, model) {
  const role = SENSOR_ROLES.find(role => ['motor','output'].includes(role.id) && role.prefix === prefix);
  if (!role || typeof model !== 'string') throw new Error('编码器型号配置无效。');
  const definition = encoderModels.get(model);
  parameters[prefix+'Model'] = model;
  if (definition) {
    parameters[prefix+'Vendor'] = definition.vendor;
    parameters[prefix+'Interface'] = definition.interface;
    parameters[role.capability] = 'present';
  }
  return parameters;
}

// Transport defaults follow the maintained NEO project wiring, not every product from each vendor.
const torqueModels = new Set(['MC_TOR_SENSOR_KW','MC_TOR_SENSOR_XH','MC_TOR_SENSOR_LD','MC_TOR_SENSOR_SMH','KW','XH','LD','SMH']);
export function builtinDriverInterfaceForModel(prefix, model) {
  if (['motorEncoder','outputEncoder'].includes(prefix)) return encoderInterfaceForModel(model);
  if (prefix === 'torqueSensor' && torqueModels.has(model)) return 'rs485';
  if (prefix === 'gateDriver' && ['DRV8353S','DRV8353'].includes(model)) return 'spi';
  return '';
}
const resourceRate = (resource, transport) => {
  const key = ['uart','rs485','can'].includes(transport) ? 'bitrate' : ['spi','i2c','ssi','biss'].includes(transport) ? 'clockHz' : '';
  return key ? resource.settings?.[key] ?? null : null;
};
function builtinDriverFamily(prefix, model) {
  if (['motorEncoder','outputEncoder'].includes(prefix)) return encoderModels.get(model)?.vendor || '';
  if (prefix === 'torqueSensor' && torqueModels.has(model)) return String(model).replace(/^MC_TOR_SENSOR_/, '');
  if (prefix === 'gateDriver' && ['DRV8353S','DRV8353'].includes(model)) return 'DRV8353';
  if (prefix === 'gateDriver' && model === 'discrete') return 'discrete';
  return '';
}
export function applyBuiltinDriverModel(parameters, prefix, model, resources = []) {
  const role = SENSOR_ROLES.find(role => role.prefix === prefix);
  if (!role || typeof model !== 'string') throw new Error('驱动器型号配置无效。');
  if (['','unselected','unconfirmed'].includes(model.trim())) {
    parameters[prefix+'Model'] = '';
    parameters[prefix+'Commands'] = [];
    parameters[role.capability] = 'absent';
    return parameters;
  }
  const previousFamily = builtinDriverFamily(prefix,parameters[prefix+'Model']);
  const nextFamily = builtinDriverFamily(prefix,model);
  // Command frames belong to the old device family. Explicit model changes
  // invalidate them; reselecting the same model or a known alias keeps them.
  if (nextFamily && nextFamily !== previousFamily) parameters[prefix+'Commands'] = [];
  if (['motor','output'].includes(role.id)) applyEncoderModel(parameters,prefix,model);
  else parameters[prefix+'Model'] = model;
  if (role.id === 'gate' && model === 'discrete') { parameters[role.capability] = 'present'; return parameters; }
  const transport = builtinDriverInterfaceForModel(prefix,model);
  if (!transport) return parameters;
  parameters[prefix+'Interface'] = transport;
  parameters[role.capability] = 'present';
  const candidates = sensorResources(resources,transport);
  const existing = candidates.find(resource => resource.id === parameters[prefix+'Resource']);
  const available = candidates.filter(resource => !driverResourceOccupants(parameters, resources, resource.id, { prefix }).length);
  const bound = existing || (available.length === 1 ? available[0] : null);
  parameters[prefix+'Resource'] = bound?.id || '';
  if (bound) parameters[prefix+'Bitrate'] = resourceRate(bound, transport);
  return parameters;
}
/** Editing a bound bus rate also updates every driver sharing that same bus. */
export function setDriverCommunicationRate(parameters, prefix, value, resources = []) {
  const role = SENSOR_ROLES.find(role => role.prefix === prefix);
  if (!role || value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw new Error('接口速率必须为正数或留空。');
  if (role.id === 'gate' && isDiscreteGate(parameters)) return parameters;
  const transport = builtinDriverInterfaceForModel(prefix,parameters[prefix+'Model']) || parameters[prefix+'Interface'];
  const bound = sensorResources(resources,transport).find(resource => resource.id === parameters[prefix+'Resource']);
  parameters[prefix+'Bitrate'] = value;
  if (!bound) return parameters;
  const key = ['uart','rs485'].includes(transport) ? 'bitrate' : ['spi','i2c','ssi','biss'].includes(transport) ? 'clockHz' : '';
  if (!key) return parameters;
  bound.settings[key] = value;
  for (const peer of SENSOR_ROLES) {
    if (peer.id === 'gate' && isDiscreteGate(parameters)) continue;
    if (parameters[peer.prefix+'Resource'] === bound.id) parameters[peer.prefix+'Bitrate'] = value;
  }
  return parameters;
}

/** An explicit binding selects an existing compatible port without changing the device preset. */
export function bindBuiltinDriverResource(parameters, prefix, resourceId, resources = []) {
  const role = SENSOR_ROLES.find(role => role.prefix === prefix);
  if (!role || role.id === 'gate' && isDiscreteGate(parameters)) throw new Error('此驱动不支持绑定通信外设。');
  const transport = builtinDriverInterfaceForModel(prefix, parameters[prefix+'Model']) || parameters[prefix+'Interface'];
  const resource = sensorResources(resources, transport).find(resource => resource.id === resourceId);
  if (!resource) throw new Error('请选择已配置且与此驱动兼容的外设。');
  if (driverResourceOccupants(parameters, resources, resource.id, { prefix }).length) throw new Error('此外设已被其他驱动占用，请选择独立外设。');
  parameters[prefix+'Resource'] = resource.id;
  parameters[prefix+'Bitrate'] = resourceRate(resource, transport);
  return resource;
}

const field=(role,key,label,type,extra={})=>({key,label,type,phase:'init',description:`${role.title}的${label}配置。`,required:false,defaultValue:type==='select'?'unselected':type==='text'?'':null,sensorRole:role.id,...extra});
const select=(role,key,label,entries,extra={})=>field(role,key,label,'select',{options:entries,...extra});
export const SENSOR_PARAMS = SENSOR_ROLES.flatMap(role=>{
  const p=role.prefix, gate=role.id==='gate', encoder=!gate&&role.id!=='torque';
  return [
    select(role,role.capability,'使用状态',states,{required:false,defaultValue:'unconfirmed',sensorLayoutTrigger:true}),
    ...(encoder?[
      select(role,p+'Type','编码器类型',options([['unselected','待选择'],['absolute','绝对值编码器'],['incremental','增量式编码器'],['hall','霍尔'],['custom','自定义方案']]),{sensorRequired:true,sensorLayoutTrigger:true}),
      select(role,p+'Vendor','厂商 / 方案',options([['unselected','待选择'],['gongwang','弓望'],['jingang','金刚'],['other','其他 / 自研']]),{sensorLayoutTrigger:true}),
      select(role,p+'HallMode','霍尔方案',options([['unselected','待选择'],['linear','线性霍尔 · sin/cos'],['digital','开关霍尔']]),{when:'hall',sensorRequired:true,sensorLayoutTrigger:true}),
    ]:[]),
    field(role,p+'Model','器件型号','text',{sensorRequired:gate,sensorLayoutTrigger:true,description:'用于记录选型，不参与代码分支；通信行为由下方帧格式配置决定。'}),
    ...(gate?[
      field(role,p+'EnablePin','使能引脚','text',{sensorRequired:true,description:'门极驱动使能信号的 MCU GPIO 引脚；只记录配置，不会操作实际输出。'}),
      select(role,p+'EnableLevel','使能有效电平',options([['unselected','待选择'],['high','高有效'],['low','低有效']]),{hidden:true}),
    ]:[]),
    select(role,p+'Interface','通信方式',interfaces,{sensorRequired:true,sensorLayoutTrigger:true}),
    field(role,p+'Resource','外设接口','text',{sensorRequired:true,sensorLayoutTrigger:true,description:'引用 PCBA 已分配的外设与引脚。'}),
    field(role,p+'Commands','接收命令','command-list',{defaultValue:[],hidden:true}),
    ...(gate?[]:encoder?[
      select(role,p+'AngleDomain','输出角度语义',options([['unselected','待选择'],['mechanical','机械角度'],['electrical','电角度']]),{sensorRequired:true}),
      field(role,role.id==='motor'?'encoderBits':'outputEncoderBits','有效分辨率','integer',{unit:'bit',min:1,max:64,when:'absolute',sensorRequired:true,advanced:true}),
      field(role,p+'CountsPerRev','每圈有效计数','integer',{min:1,when:'incremental',sensorRequired:true,advanced:true}),
    ]:[
      select(role,p+'Unit','接口输出单位',options([['unselected','待选择'],['nm','N·m'],['raw','原始计数 / 电压']]),{sensorRequired:true,sensorLayoutTrigger:true}),
      field(role,p+'RangeNm','额定量程','number',{unit:'N·m',min:Number.MIN_VALUE,sensorRequired:true}),
      field(role,p+'Scale','换算系数','number',{unit:'N·m/原始单位',min:Number.MIN_VALUE,when:'raw_torque',sensorRequired:true}),
    ]),
    ...(gate?[]:[
      select(role,p+'Direction','方向处理',options([['calibration','使用校准记录'],['positive','配置正向'],['negative','配置反向']]),{defaultValue:'calibration',hidden:true}),
      select(role,p+'Timing','更新方式',options([['unselected','待选择'],['fast','跟随电流环控制周期'],['periodic','独立周期'],['event','接收事件驱动']]),{sensorRequired:true,sensorLayoutTrigger:true,advanced:true}),
      field(role,p+'RateHz','更新频率','number',{unit:'Hz',min:Number.MIN_VALUE,when:'periodic',sensorRequired:true,advanced:true}),
    ]),
    field(role,p+'TimeoutUs','数据有效期','number',{unit:'μs',min:Number.MIN_VALUE,sensorRequired:true,advanced:true,description:'超过有效期的反馈不能继续当作新数据使用。'}),
    field(role,p+'Bitrate','接口速率 / 时钟','number',{min:Number.MIN_VALUE,when:'serial',sensorRequired:true,advanced:true,description:'SPI / SSI 等填写时钟 Hz，UART / RS-485 等填写 bit/s。'}),
    ...(encoder?[
      field(role,p+'SinResource','sin 采样通道','text',{when:'linear_hall',sensorRequired:true}),
      field(role,p+'CosResource','cos 采样通道','text',{when:'linear_hall',sensorRequired:true}),
      field(role,p+'AmplitudeMin','有效幅值下限','number',{min:0,when:'linear_hall',advanced:true,description:'使用归一化幅值；偏置与增益由运动校准记录提供。'}),
      field(role,p+'AmplitudeMax','有效幅值上限','number',{min:Number.MIN_VALUE,when:'linear_hall',advanced:true}),
    ]:[]),
  ];
});
// Preserve a legacy independent Hall declaration on import; it stays outside the role list.
SENSOR_PARAMS.push({key:'hallCapability',label:'旧霍尔声明',type:'select',options:states,phase:'init',description:'旧格式迁移记录。',required:false,defaultValue:'unconfirmed',hidden:true});
export function sensorFieldVisible(field,parameters) {
  if(field.hidden)return false;
  const role=SENSOR_ROLES.find(r=>r.id===field.sensorRole);
  if(!role)return true;
  if(field.key===role.capability)return true;
  if(parameters[role.capability]!=='present')return false;
  const p=role.prefix;
  if (field.key === p+'Interface' && builtinDriverInterfaceForModel(p,parameters[p+'Model'])) return false;
  if (role.id === 'gate' && isDiscreteGate(parameters) && ['Interface','Resource','Commands','TimeoutUs','Bitrate'].some(suffix => field.key === p+suffix)) return false;
  if(field.when==='hall')return parameters[p+'Type']==='hall';
  if(field.when==='linear_hall')return parameters[p+'Type']==='hall'&&parameters[p+'HallMode']==='linear';
  if(field.when==='absolute'||field.when==='incremental')return parameters[p+'Type']===field.when;
  if(field.when==='periodic')return parameters[p+'Timing']==='periodic';
  if(field.when==='serial')return ['spi','i2c','uart','rs485','ssi','biss','can'].includes(parameters[p+'Interface']);
  if(field.when==='raw_torque')return parameters[p+'Unit']==='raw';
  return true;
}
export function sensorFieldRequired(field,parameters) { return field.required || Boolean(field.sensorRequired&&sensorFieldVisible(field,parameters)); }
/** 旧协议平铺键后缀：折叠为一条主数据命令后必须全部删除（exactKeys）；provenance 清理复用同一列表。 */
export const LEGACY_PROTOCOL_SUFFIXES=['TransferMode','RequestHex','StartHex','StartupDelayUs','HeaderHex','FooterHex','FrameBytes','DataOffset','DataType','DataBits','ByteOrder','ValueScale','ValueOffset','Checksum','ChecksumStart','StatusOffset','StatusMask','StatusExpected'];
/** 任一旧键存在且命令数组缺主数据命令时折叠一条 data 命令；旧键随后无条件删除；幂等。 */
function foldLegacyProtocolCommands(parameters) {
  for(const role of SENSOR_ROLES) {
    const p=role.prefix,legacy=LEGACY_PROTOCOL_SUFFIXES.map(suffix=>p+suffix);
    const commands=Array.isArray(parameters[p+'Commands'])?parameters[p+'Commands']:null;
    if(legacy.some(key=>Object.hasOwn(parameters,key))&&!(commands||[]).some(command=>command?.purpose==='data')) {
      const pick=suffix=>parameters[p+suffix];
      const mode=pick('TransferMode')==='active_upload'?'active_upload':'request_response';
      parameters[p+'Commands']=[Object.assign(createDriverCommand('data',`${role.id}-data`),{mode,
        requestHex:String(pick(mode==='active_upload'?'StartHex':'RequestHex')??''),periodUs:null,startupDelayUs:pick('StartupDelayUs')??0,
        headerHex:String(pick('HeaderHex')??''),footerHex:String(pick('FooterHex')??''),frameBytes:pick('FrameBytes')??null,dataOffset:pick('DataOffset')??null,
        dataType:pick('DataType')??'unselected',dataBits:pick('DataBits')??null,byteOrder:pick('ByteOrder')??'unselected',valueScale:pick('ValueScale')??null,valueOffset:pick('ValueOffset')??0,
        checksum:pick('Checksum')??'unselected',checksumStart:pick('ChecksumStart')??0,statusOffset:pick('StatusOffset')??null,statusMask:pick('StatusMask')??0,statusExpected:pick('StatusExpected')??0})];
    }
    for(const key of legacy)delete parameters[key];
  }
}
export function migrateSensorParameters(parameters,{hallAngle=false}={}) {
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))return;
  if(!Object.hasOwn(parameters,'motorEncoderType')) {
    if(hallAngle||(parameters.hallCapability==='present'&&parameters.encoderCapability!=='present')) {
      parameters.motorEncoderType='hall';
      parameters.encoderCapability=parameters.hallCapability??'unconfirmed';
    }
  }
  foldLegacyProtocolCommands(parameters);
  for(const field of SENSOR_PARAMS)if(!Object.hasOwn(parameters,field.key))parameters[field.key]=structuredClone(field.defaultValue);
}
export function sensorIssues(parameters) {
  const issues=[];
  const add=(id,level,title,message,key)=>issues.push({id:'sensor-'+id,level,title,message,moduleId:'hw-drivers',paramKey:key});
  for(const role of SENSOR_ROLES) {
    const p=role.prefix;
    issues.push(...sensorCommandIssues(parameters,role));
    if(parameters[role.capability]!=='present')continue;
    const fixedInterface = builtinDriverInterfaceForModel(p,parameters[p+'Model']);
    if (fixedInterface && parameters[p+'Interface'] !== fixedInterface && !(fixedInterface === 'rs485' && parameters[p+'Interface'] === 'uart')) add(p+'model-interface',['',undefined,null,'unselected'].includes(parameters[p+'Interface'])?'pending':'error',`${role.title} · 型号接口待同步`,'重新选择器件型号以同步固定接口；速率和帧格式保持原配置。',p+'Model');
    for(const field of SENSOR_PARAMS.filter(f=>f.sensorRole===role.id&&sensorFieldRequired(f,parameters))) {
      const v=parameters[field.key];
      if(v===null||v===undefined||(typeof v==='string'&&!v.trim())||v==='unselected')add(field.key,'pending',`${role.title} · ${field.label}待填写`,'补充当前传感器方案所需的配置。',field.key);
    }
    if(role.id==='output'&&parameters[p+'AngleDomain']==='electrical')add('output-domain','error','出轴位置需要机械角度','出轴编码器用于输出轴机械位置；电角度不能直接当作出轴位置。',p+'AngleDomain');
    if(parameters[p+'Type']==='hall'&&parameters[p+'HallMode']==='linear') {
      const sin=parameters[p+'SinResource']?.trim(),cos=parameters[p+'CosResource']?.trim();
      if(sin&&cos&&sin.toLowerCase()===cos.toLowerCase())add(p+'channels','error','sin / cos 不能使用同一采样通道','分别绑定两个输入通道。',p+'CosResource');
      const min=parameters[p+'AmplitudeMin'],max=parameters[p+'AmplitudeMax'];
      if(typeof min==='number'&&typeof max==='number'&&min>=max)add(p+'amplitude','error','霍尔幅值范围冲突','有效幅值上限必须大于下限。',p+'AmplitudeMax');
    }
    if(parameters[p+'Timing']==='periodic'&&parameters[p+'RateHz']>0&&parameters[p+'TimeoutUs']>0&&parameters[p+'TimeoutUs']<1e6/parameters[p+'RateHz'])add(p+'freshness','error',`${role.title}有效期短于更新周期`,'提高有效期或调整更新频率。',p+'TimeoutUs');
  }
  return issues;
}
