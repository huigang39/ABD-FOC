import { numericInputAttributes } from '../../shared/forms/numeric-input.mjs';
import { fieldHelp } from '../../shared/ui/field-help.mjs';
import { hardwareFieldOptions, resourceSettingOptions } from '../../modules/hardware/hw-platform/options.mjs';
import { icon } from '../../shared/ui/icons.mjs';
import { esc } from '../../shared/esc.mjs';
import { selectOptions } from '../../shared/forms/select-control.mjs';
import { isPwmResource, RESOURCE_PRESETS, canShareResourceInstance, RESOURCE_KINDS, getMcuResources, resourceRoute, resourceInstanceOptions, resourceSignalLayout, resourceSettingLayout, sensorResources } from '../../modules/hardware/hw-board/resources.mjs';
import { TRIP_SOURCES, TRIP_ROUTES } from '../../modules/hardware/hw-safety/paths.mjs';
import { driverResourceOccupants } from '../../modules/hardware/hw-drivers/resource-usage.mjs';
import { builtinDriverInterfaceForModel } from '../../modules/hardware/hw-drivers/sensors.mjs';
import { COMMAND_PURPOSES } from '../../modules/hardware/hw-drivers/protocol.mjs';
import { CHILD_TYPES } from '../../modules/algorithm/children.mjs';
import { childParameterVisible } from '../../modules/algorithm/foc-observer/chains.mjs';
import { edit as editAlgorithmField } from './view.mjs';

function field(label,value,{scope,id,key,section='',owner='',role='',type='text',options,unit='',description='',error='',disabled=false}) {
  const attrs=`data-edit="${scope}" data-id="${esc(id)}" data-owner="${esc(owner)}" data-key="${esc(key)}" data-section="${esc(section)}"${role?` data-role="${esc(role)}"`:''} data-value-type="${type}" aria-label="${esc(label)}" ${disabled?'disabled':''} ${error?`aria-invalid="true" title="${esc(error)}"`: ''}`;
  const input=options?`<select class="field-select" ${attrs}>${selectOptions(options,value)}</select>`:`<input class="field-input" ${attrs} ${type==='number'||type==='integer'?numericInputAttributes(value):`type="text" value="${esc(value)}"`} ${type==='integer'?'step="1"':type==='number'?'step="any"':'maxlength="120"'}>`;
  return `<div class="form-field ${error?'hardware-field-invalid':''}"><span class="field-label">${esc(label)}${fieldHelp(description,label)}</span>${unit&&!options?`<div class="field-input-wrap">${input}<span class="field-unit">${esc(unit)}</span></div>`:input}${error?`<p class="field-error">${esc(error)}</p>`:''}</div>`;
}
const remove=(action,id,owner,role='')=>`<button class="button small ghost" data-action="${action}" data-id="${esc(id)}" data-owner="${esc(owner)}"${role?` data-role="${esc(role)}"`:''}>移除</button>`;
const pinLabels = { uart: { TX:'发送', RX:'接收', DE:'发送使能' } };
const presetIcons = { 'phase-current':'current', 'bus-voltage':'voltage', temperature:'temperature', pwm:'pulse', 'terminal-voltage':'voltage' };
export const TEMPERATURE_LOCATIONS = Object.freeze(['逆变器温度', '电机温度 UV 相', '电机温度 VW 相']);
function peripheralTags(resources) {
  const instances=[...new Set(resources.map(resource=>resource.instance?.trim()).filter(instance=>instance&&!['unselected','none'].includes(instance)))];
  return `<span class="hardware-peripheral-tags">${instances.map(instance=>`<span class="attribute-tag">${esc(instance)}</span>`).join('')}</span>`;
}
function presetButton(preset, owner) {
  return `<button type="button" class="button ghost" data-action="add-pcba-resource" data-preset="${preset.id}" data-kind="${preset.kind}" data-owner="${esc(owner)}" title="添加${preset.label}" aria-label="添加${preset.label}">${icon(presetIcons[preset.id])}<span>${preset.label}</span></button>`;
}
function renderCurrentCalibration(child) {
  if (!child) return '';
  const definition=CHILD_TYPES['foc-compensation'].find(type=>type.id==='current_calibration');
  const fields=definition.fields.filter(field=>childParameterVisible(child,field)).map(([key,label,unit,options])=>editAlgorithmField(label,child.parameters[key],'algorithm-child',key,{id:'current_calibration',section:'foc-compensation',type:'number',unit,...options}));
  return `<section class="current-sampling-channel current-calibration-settings" aria-label="电流零偏"><h4>电流零偏</h4><div class="profile-form">${fields.join('')}</div></section>`;
}
export function renderResourceEditor(mcu,resources=[],{owner='',currentTopology='',currentCalibration}={}) {
  const routes=getMcuResources(mcu), kinds=RESOURCE_KINDS.filter(([kind])=>routes.some(route=>route.kind===kind));
  const currents=resources.filter(resource=>resource.preset==='phase-current');
  const temperatures=resources.filter(resource=>resource.preset==='temperature');
  const pinUsers=pin=>resources.flatMap(resource=>Object.entries(resource.pins).filter(([,value])=>value===pin&&pin&&pin!=='none').map(([signal])=>({id:resource.id,signal,name:resource.name||resource.instance})));
  const occupied=(pin,id,signal)=>pinUsers(pin).filter(user=>user.id!==id||user.signal!==signal);
  const renderResource=(resource,{currentIndex=-1,temperatureIndex=-1}={})=>{
    const current=currentIndex>=0, temperature=temperatureIndex>=0;
    const temperatureName=resource.name==='温度采样'||!resource.name?TEMPERATURE_LOCATIONS[0]:resource.name;
    const route=resourceRoute(mcu,resource), preset=RESOURCE_PRESETS.find(item=>item.id===resource.preset);
    const label=RESOURCE_KINDS.find(([kind])=>kind===resource.kind)?.[1]||resource.kind;
    const edit=(title,value,key,config={})=>field(title,value,{scope:'pcba-resource',id:resource.id,owner,key,...config});
    const signals=resourceSignalLayout(mcu,resource), settings=resourceSettingLayout(resource);
    const pinError=signal=>{
      const pin=resource.pins[signal]||'', candidates=route?.pins[signal]||[], conflicts=occupied(pin,resource.id,signal);
      return pin&&pin!=='none'&&!candidates.includes(pin)?'此引脚不支持当前外设信号。':conflicts.length?`引脚已由 ${conflicts.map(user=>user.name+' / '+user.signal).join('、')} 占用。`:'';
    };
    const pinField=(signal,title=pinLabels[resource.kind]?.[signal]||signal)=>edit(title,resource.kind==='adc'&&resource.pins[signal]==='none'?'':resource.pins[signal]||'',signal,{section:'pins',error:pinError(signal),options:[...(resource.kind==='adc'?[]:[['none','不连接']]),...(route?.pins[signal]||[]).map(value=>{const busy=occupied(value,resource.id,signal);return [value,value+(busy.length?'（已占用）':''),busy.length>0];})]});
    const settingField=([key,title,type,extra])=>edit(title,resource.settings[key],key,{section:'settings',type,...(type==='select'?{options:extra}:{unit:extra}),...(resourceSettingOptions(mcu,resource,key)?{options:resourceSettingOptions(mcu,resource,key)}:{})});
    const instance=edit(current||temperature?'ADC':'外设实例',resource.instance,'instance',{error:!canShareResourceInstance(resource.kind)&&resource.instance&&resources.some(other=>other.id!==resource.id&&other.instance===resource.instance)?'此外设实例已被其他资源占用。':'',options:resourceInstanceOptions(mcu,resource).map(route=>{const busy=!canShareResourceInstance(route.kind)&&resources.some(other=>other.id!==resource.id&&other.instance===route.instance);return [route.instance,route.instance+(busy?'（已占用）':''),busy];})});
    if(resource.kind==='adc') {
      const channel=Object.keys(resource.pins).find(key=>/^IN[PN]\d+$/.test(key))||'';
      const channels=Object.keys(route?.pins||{}).filter(key=>/^IN[PN]\d+$/.test(key));
      if(channel&&!channels.includes(channel))channels.unshift(channel);
      const retained=Object.keys(resource.pins).filter(signal=>signal!==channel&&resource.pins[signal]);
      const body=`<div class="profile-form">${temperature?edit('测量位置',temperatureName,'name',{options:TEMPERATURE_LOCATIONS.map(name=>[name,name])}):''}${instance}${edit('ADC 通道',channel,'channel',{options:channels.map(value=>[value,value])})}${channel?pinField(channel,'采样引脚'):edit('采样引脚','','samplingPin',{options:[],disabled:true})}${[...settings.primary,...settings.advanced].map(settingField).join('')}</div>${retained.length?`<div class="hardware-pin-grid">${retained.map(signal=>pinField(signal)).join('')}</div>`:''}`;
      if(current)return `<section class="current-sampling-channel" data-current-channel="${currentIndex+1}"><h4>通道 ${currentIndex+1}</h4>${body}</section>`;
      if(temperature)return `<section class="current-sampling-channel temperature-sampling-channel" data-temperature-channel="${temperatureIndex+1}"><div class="design-toolbar"><h4>${esc(temperatureName)}</h4>${temperatures.length>1?`<button type="button" class="button small ghost hardware-add-toggle" data-action="remove-pcba-resource" data-id="${esc(resource.id)}" data-owner="${esc(owner)}" aria-label="移除${esc(temperatureName)}" title="移除${esc(temperatureName)}">${icon('trash')}</button>`:''}</div>${body}</section>`;
      return `<section class="resource-disclosure hardware-resource"><header class="hardware-resource-heading" data-live="pcba-summary-${esc(owner)}-${esc(resource.id)}">${icon(presetIcons[resource.preset]||'chip')}<strong>${esc(preset?.label||resource.name||resource.instance||label)}</strong>${peripheralTags([resource])}</header><div class="hardware-resource-body">${body}${!preset?.common?`<div class="hardware-resource-footer">${remove('remove-pcba-resource',resource.id,owner)}</div>`:''}</div></section>`;
    }
    const title=preset?.label||resource.name||resource.instance||label;
    const retainedSignals=signals.advanced.filter(signal=>resource.pins[signal]&&resource.pins[signal]!=='none'&&!signals.pairs.some(pair=>pair.complementary===signal));
    const body=`<div class="hardware-resource-body"><div class="profile-form">${instance}</div>
      ${signals.primary.length?`<div class="hardware-pin-grid${signals.pairs.length?' hardware-phase-grid':''}">${signals.primary.map(signal=>{
        const pair=signals.pairs.find(pair=>pair.main===signal);
        if(!pair)return pinField(signal);
        const companion=resource.pins[pair.complementary],error=pinError(pair.complementary);
        return `<div class="hardware-phase-output">${pinField(signal,`${pair.phase} 相主输出`)}${companion&&companion!=='none'&&!error&&(route?.pins[pair.complementary]||[]).length===1?`<div class="hardware-complementary${error?' hardware-field-invalid':''}" data-complementary="${esc(pair.complementary)}"><span>互补 ${esc(pair.complementary)}</span><output>${esc(companion)}</output>${error?`<p class="field-error">${esc(error)}</p>`:''}</div>`:pinField(pair.complementary,`${pair.phase} 相互补输出`)}</div>`;
      }).join('')}</div>`:''}
      ${settings.primary.length||settings.advanced.length?`<div class="profile-form">${[...settings.primary,...settings.advanced].map(settingField).join('')}</div>`:''}
      ${retainedSignals.length?`<div class="hardware-pin-grid">${retainedSignals.map(signal=>pinField(signal)).join('')}</div>`:''}
      ${!preset?.common?`<div class="hardware-resource-footer">${remove('remove-pcba-resource',resource.id,owner)}</div>`:''}</div>`;
    return `<section class="resource-disclosure hardware-resource"><header class="hardware-resource-heading" data-live="pcba-summary-${esc(owner)}-${esc(resource.id)}">${preset?icon(presetIcons[preset.id]):`<span class="hardware-resource-kind">${esc(label)}</span>`}<strong>${esc(title)}</strong>${peripheralTags([resource])}</header>${body}</section>`;
  };
  const currentGroup=currents.length?`<section class="resource-disclosure hardware-resource current-sampling"><header class="hardware-resource-heading">${icon('current')}<strong>相电流采样${currentTopology==='inline'?' · 相线采样':''}</strong>${peripheralTags(currents)}</header><div class="hardware-resource-body"><div class="profile-form">${field('通道数量',currents.length,{scope:'current-channel-count',id:'',key:'count',owner,type:'integer',options:[[1,'1 · 单电阻'],[2,'2 · 双电阻'],[3,'3 · 三电阻']]})}</div>${currents.map((resource,currentIndex)=>renderResource(resource,{currentIndex})).join('')}${renderCurrentCalibration(currentCalibration)}</div></section>`:'';
  const temperatureGroup=temperatures.length?`<section class="resource-disclosure hardware-resource temperature-sampling"><header class="hardware-resource-heading">${icon('temperature')}<strong>温度采样</strong>${peripheralTags(temperatures)}</header><div class="hardware-resource-body"><div class="design-toolbar"><span></span><details class="configuration-more" data-native-menu><summary class="button small hardware-add-toggle" aria-label="添加温度通道" title="添加温度通道">${icon('plus')}</summary><div class="configuration-more-body hardware-add-menu">${TEMPERATURE_LOCATIONS.map(name=>`<button type="button" class="button ghost" data-action="add-pcba-resource" data-preset="temperature" data-kind="adc" data-name="${esc(name)}" data-owner="${esc(owner)}">${icon('temperature')}<span>${esc(name)}</span></button>`).join('')}</div></details></div>${temperatures.map((resource,temperatureIndex)=>renderResource(resource,{temperatureIndex})).join('')}</div></section>`:'';
  return `<section class="hardware-editor" aria-label="PCBA 外设与引脚"><div class="design-toolbar"><h3>外设</h3>${kinds.length?`<details class="configuration-more" data-native-menu><summary class="button small hardware-add-toggle" aria-label="添加其他外设" title="添加其他外设">${icon('plus')}</summary><div class="configuration-more-body hardware-add-menu">${RESOURCE_PRESETS.filter(preset=>!preset.common&&kinds.some(([kind])=>kind===preset.kind)).map(preset=>presetButton(preset,owner)).join('')}<div class="hardware-add-divider" aria-hidden="true"></div>${kinds.map(([kind,label])=>`<button class="button ghost" data-action="add-pcba-resource" data-kind="${kind}" data-owner="${esc(owner)}">${label}</button>`).join('')}</div></details>`:''}</div>
    ${!mcu?'<p class="design-note">先在工程选型中选择已配置 MCU 型号的驱动器。<a href="#/project/actuator">前往选型 →</a></p>':!routes.length?`<p class="design-note">${esc(mcu)} 暂无可用的封装引脚表。</p>`:''}
    ${currentGroup}${resources.filter(resource=>resource.preset!=='phase-current').map(resource=>resource===temperatures[0]?temperatureGroup:resource.preset==='temperature'?'':renderResource(resource)).join('')}
    </section>`;
}

/** A resource reference remains a string in the module contract, but is picked
 * from the board rather than accepting an unrelated peripheral name. */
export function bindSensorField(field,parameters,resources=[],{mcu=''}={}) {
  if(field.key==='gateDriverEnablePin')return {...field,type:'select',label:'使能引脚',options:(getMcuResources(mcu).find(route=>route.kind==='gpio')?.pins.IO||[]).map(value=>({value,label:value}))};
  const match=/^(motorEncoder|outputEncoder|torqueSensor|gateDriver)Resource$/.exec(field.key);
  if(!match)return field;
  const type=builtinDriverInterfaceForModel(match[1],parameters[`${match[1]}Model`])||parameters[`${match[1]}Interface`];
  const candidates=sensorResources(resources,type);
  return {...field,type:'select',label:'外设',options:candidates.map(resource=>{const occupied=driverResourceOccupants(parameters,resources,resource.id,{prefix:match[1]}).length>0;return {value:resource.id,label:`${resource.instance}${resource.name&&resource.name!==resource.instance?' · '+resource.name:''}${occupied?'（已占用）':''}`,disabled:occupied,hidden:false};}),description:'',sensorLayoutTrigger:true};
}

export function renderTripEditor(paths=[],resources=[],{owner='',mcu=''}={}) {
  return `<section class="hardware-editor" aria-label="快速硬件保护"><div class="design-toolbar"><div><h3>异常触发与关断${fieldHelp('锁存输出关断，故障解除后由应用授权复位。电压、温度等常规软件轮询保护在应用层配置；电流环内的软件限值仍属于算法层。','硬件保护')}</h3></div><button class="button small" data-action="add-trip-path" data-owner="${esc(owner)}">添加保护路径</button></div>${paths.length?paths.map((path,index)=>{
    const edit=(label,key,config={})=>field(label,path[key],{scope:'trip-path',id:path.id,owner,key,...config});
    const sources=resources.filter(resource=>resource.kind==='comparator'||resource.kind==='gpio'&&resource.settings.direction==='input');
    const outputs=resources.filter(isPwmResource);
    const options=list=>list.map(resource=>[resource.id,`${resource.name||resource.instance} · ${Object.values(resource.pins).filter(Boolean).join(' / ')||resource.instance}`]);
    const toggle=`<label class="switch-field hardware-path-toggle"><span>启用保护</span><input type="checkbox" data-edit="trip-path" data-id="${esc(path.id)}" data-owner="${esc(owner)}" data-key="compiled" data-value-type="boolean" aria-label="启用保护 ${index+1}" ${path.compiled!==false&&path.enabled!==false?'checked':''}><span class="switch-ui" aria-hidden="true"></span></label>`;
    return `<details class="resource-disclosure hardware-resource algorithm-path-card" data-state-key="hardware-path-${esc(owner)}-${esc(path.id)}"><summary><span class="module-sequence">${String(index+1).padStart(2,'0')}</span><strong>${esc(TRIP_SOURCES.find(([key])=>key===path.source)?.[1]||'保护路径')}</strong>${toggle}</summary>${path.compiled!==false?`<div class="hardware-resource-body"><div class="hardware-trip-flow"><span>${esc(TRIP_SOURCES.find(([id])=>id===path.source)?.[1])}</span><span aria-hidden="true">→</span><strong>${path.route==='break'?'PWM 硬件刹车':'外部中断'}</strong><span aria-hidden="true">→</span><span>锁存关断</span></div><div class="profile-form">${edit('故障来源','source',{options:TRIP_SOURCES})}${edit('输入资源','inputResource',{options:options(sources)})}${edit('关断路径','route',{options:TRIP_ROUTES})}${edit('PWM 关断目标','pwmResource',{options:options(outputs)})}${edit('有效电平','activeLevel',{options:[['low','低有效 / 下降沿'],['high','高有效 / 上升沿']]})}${path.route==='interrupt'?edit('中断优先级','priority',{type:'select',options:hardwareFieldOptions(mcu,'hw-platform','controlIrqPriority')}):edit('硬件滤波周期','filterCycles',{type:'integer'})}</div>${fieldHelp(`${path.route==='break'?'通过已适配的硬件路由直接关断 PWM，不等待软件任务。滤波会增加响应延迟。':'由外部中断立即关断 PWM，不经过任务轮询；响应时间仍受中断屏蔽和抢占影响。'}`, '关断路径')}<div class="hardware-resource-footer"><span class="hardware-latch">故障锁存 · 应用授权复位</span>${remove('remove-trip-path',path.id,owner)}</div></div>`:''}</details>`;
  }).join(''):'<div class="hardware-empty">先在 PCBA 配置故障输入与 PWM，再建立关断路径。支持比较器和外部故障输入。</div>'}</section>`;
}

/** 每条命令独立的发送指令与接收解析；主数据命令产出测量值，状态读取独立成命令。 */
export function renderCommandEditor(role, commands = [], { owner = '' } = {}) {
  const hasData = commands.some(command => command?.purpose === 'data');
  const purposes = [['data','主数据指令'],['status','状态读取命令'],['other','其他指令']];
  const add = purpose => `<button class="button ghost" data-action="add-driver-command" data-role="${esc(role.id)}" data-purpose="${purpose}" data-owner="${esc(owner)}"${purpose==='data'&&hasData?' disabled title="每个通道最多一条主数据指令。"':''}>${purposes.find(([key]) => key === purpose)?.[1]}</button>`;
  return `<section class="hardware-editor" aria-label="${esc(role.title)}接收命令"><div class="design-toolbar"><div><h3>接收命令${fieldHelp('每个串行通道可配置多条命令；每条命令有独立的发送指令与接收帧解析，主数据命令产出测量值。状态与其他命令需在固件引擎更新后生效。','接收命令')}</h3></div><details class="configuration-more" data-native-menu><summary class="button small">添加命令</summary><div class="configuration-more-body">${purposes.map(([purpose]) => add(purpose)).join('')}</div></details></div>
    ${commands.length?commands.map((command,index)=>{
      const edit=(label,key,config={})=>field(label,command[key]??'',{scope:'driver-command',id:command.id,owner,key,role:role.id,...config});
      const purposeLabel=COMMAND_PURPOSES.find(([key])=>key===command.purpose)?.[1]||command.purpose;
      return `<details class="resource-disclosure hardware-resource" data-state-key="driver-command-${esc(owner)}-${esc(command.id)}"><summary><span class="module-sequence">${String(index+1).padStart(2,'0')}</span><strong>${esc(command.name||purposeLabel)}</strong><span class="hardware-resource-meta">${esc(purposeLabel)}</span></summary><div class="hardware-resource-body"><div class="profile-form">
      ${edit('名称','name')}${edit('用途','purpose',{options:COMMAND_PURPOSES,description:'主数据命令产出通道测量值；状态与其他命令按各自周期执行。'})}${edit('通信模式','mode',{options:[['request_response','请求应答'],['active_upload','主动上传']],description:'请求应答按采样时序发送请求；主动上传只在初始化时发送启动指令，之后持续接收。'})}
      ${edit(command.mode==='active_upload'?'启动上传指令':'请求指令','requestHex',{description:command.mode==='active_upload'?'初始化时发送一次的完整十六进制字节；设备上电即上传时可留空。':'每次采样发送的完整十六进制字节，包含协议要求的校验，例如 01 03 00 00。'})}
      ${command.purpose!=='data'?edit('执行周期','periodUs',{type:'integer',unit:'μs',description:'状态与其他命令按此周期轮询执行。'}):''}
      ${edit('启动等待','startupDelayUs',{type:'integer',unit:'μs',description:'初始化后等待指定时间再发送首条指令，等待期间不阻塞其他模块。'})}
      ${edit('接收帧头','headerHex',{description:'固定十六进制帧头，例如 AA 55；无固定帧头可留空。'})}${edit('接收帧尾','footerHex',{description:'固定十六进制帧尾；不含校验字段，没有时留空。'})}
      ${edit('接收帧长','frameBytes',{type:'integer',unit:'byte',description:'完整帧的字节数，包含帧头、数据、校验和帧尾。'})}${edit('数据起始位置','dataOffset',{type:'integer',unit:'byte',description:'从完整接收帧第 0 字节开始计数。'})}
      ${edit('数值格式','dataType',{options:[['unsigned','无符号整数'],['signed','有符号整数'],['float32','IEEE 754 · float32']]})}${edit('数值位宽','dataBits',{type:'integer',options:[8,16,24,32].map(value=>[value,`${value} bit`])})}${edit('字节顺序','byteOrder',{options:[['little','低字节在前'],['big','高字节在前']]})}
      ${edit('数值倍率','valueScale',{type:'number',description:'解析值 × 倍率 + 偏移，得到通道输出值；编码器为 rad，力矩为所选接口输出单位。'})}${edit('数值偏移','valueOffset',{type:'number',description:'协议数值换算偏移，不替代校准或标零记录。'})}
      ${edit('帧校验','checksum',{options:[['none','无'],['xor8','XOR-8'],['sum8','SUM-8'],['crc16_modbus','CRC-16/MODBUS']],description:'校验字段位于固定帧尾之前；MODBUS CRC 低字节在前。'})}
      ${!['unselected','none'].includes(command.checksum)?edit('校验起始位置','checksumStart',{type:'integer',unit:'byte',description:'从第 0 字节计数，校验覆盖到校验字段之前。'}):''}
      ${edit('状态字节位置','statusOffset',{type:'integer',unit:'byte',description:'可选。提取器件状态字节；未设置时不读取。'})}${edit('状态位掩码','statusMask',{type:'integer',description:'状态字节与掩码按位与后应等于期望值，否则此帧无效。0 表示仅记录状态，不据此拒绝数据。'})}${edit('状态期望值','statusExpected',{type:'integer'})}
      </div><div class="hardware-resource-footer">${remove('remove-driver-command',command.id,owner,role.id)}</div></div></details>`;
    }).join(''):'<div class="hardware-empty">尚无接收命令。添加一条主数据指令，配置发送字节与接收帧解析。</div>'}</section>`;
}

/** Edits the actual bound peripheral, not a divergent copy in each driver. */
export function renderSensorTransport(parameters,role,resources,{mcu,owner=''}={}) {
  const resource=sensorResources(resources,parameters[role.prefix+'Interface']).find(item=>item.id===parameters[role.prefix+'Resource']);
  if(!resource||!['spi','uart','i2c'].includes(resource.kind))return '';
  return `<div class="driver-transport"><div class="driver-transport-title"><strong>${esc(resource.instance)}</strong>${fieldHelp('这里直接修改绑定外设的通信参数；其他引用同一接口的驱动同步使用。引脚在外设模块配置。','通信参数')}</div><div class="sensor-fields">${[...resourceSettingLayout(resource).primary,...resourceSettingLayout(resource).advanced].map(([key,label,type,extra])=>field(label,resource.settings[key],{scope:'pcba-resource',id:resource.id,owner,key,section:'settings',type,...(type==='select'?{options:extra}:{unit:extra}),...(resourceSettingOptions(mcu,resource,key)?{options:resourceSettingOptions(mcu,resource,key)}:{})})).join('')}</div></div>`;
}
