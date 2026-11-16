import { numericInputAttributes } from '../../shared/forms/numeric-input.mjs';
import { fieldHelp } from '../../shared/ui/field-help.mjs';
import { hardwareFieldOptions, resourceSettingOptions } from '../../modules/hardware/hw-platform/options.mjs';
import { esc } from '../../shared/esc.mjs';
import { selectOptions } from '../../shared/forms/select-control.mjs';
import { isPwmResource, RESOURCE_KINDS, getMcuResources, resourceRoute, resourceFields, sensorResources } from '../../modules/hardware/hw-board/resources.mjs';
import { TRIP_SOURCES, TRIP_ROUTES } from '../../modules/hardware/hw-safety/paths.mjs';

function field(label,value,{scope,id,key,section='',owner='',type='text',options,unit='',description='',error=''}) {
  const attrs=`data-edit="${scope}" data-id="${esc(id)}" data-owner="${esc(owner)}" data-key="${esc(key)}" data-section="${esc(section)}" data-value-type="${type}" aria-label="${esc(label)}" ${error?`aria-invalid="true" title="${esc(error)}"`: ''}`;
  const input=options?`<select class="field-select" ${attrs}>${selectOptions(options,value)}</select>`:`<input class="field-input" ${attrs} ${type==='number'||type==='integer'?numericInputAttributes(value):`type="text" value="${esc(value)}"`} ${type==='integer'?'step="1"':type==='number'?'step="any"':'maxlength="120"'}>`;
  return `<div class="form-field ${error?'hardware-field-invalid':''}"><span class="field-label">${esc(label)}${fieldHelp(description,label)}</span>${unit&&!options?`<div class="field-input-wrap">${input}<span class="field-unit">${esc(unit)}</span></div>`:input}${error?`<p class="field-error">${esc(error)}</p>`:''}</div>`;
}
const remove=(action,id,owner)=>`<button class="button small ghost" data-action="${action}" data-id="${esc(id)}" data-owner="${esc(owner)}">移除</button>`;
export function renderResourceEditor(mcu,resources=[],{owner=''}={}) {
  const routes=getMcuResources(mcu), kinds=RESOURCE_KINDS.filter(([kind])=>routes.some(route=>route.kind===kind));
  const pinUsers=pin=>resources.flatMap(resource=>Object.entries(resource.pins).filter(([,value])=>value===pin&&pin&&pin!=='none').map(([signal])=>({id:resource.id,signal,name:resource.name||resource.instance})));
  const occupied=(pin,id,signal)=>pinUsers(pin).filter(user=>user.id!==id||user.signal!==signal);
  return `<section class="hardware-editor" aria-label="PCBA 外设与引脚"><div class="design-toolbar"><div><h3>外设资源${fieldHelp('选择外设实例，再分配信号和引脚。传感器与保护模块引用这里的资源。引脚列表仅提供当前 MCU 已维护的映射。','外设资源')}</h3></div>${kinds.length?`<details class="configuration-more" data-native-menu><summary class="button small">添加外设</summary><div class="configuration-more-body hardware-add-menu">${kinds.map(([kind,label])=>`<button class="button ghost" data-action="add-pcba-resource" data-kind="${kind}" data-owner="${esc(owner)}">${label}</button>`).join('')}</div></details>`:''}</div>
    ${!routes.length?'<p class="design-note">当前 MCU 尚未维护封装与引脚映射。完成平台适配后，这里会提供对应的外设和可用引脚。</p>':''}
    ${resources.length?resources.map(resource=>{
      const route=resourceRoute(mcu,resource), label=RESOURCE_KINDS.find(([kind])=>kind===resource.kind)?.[1]||resource.kind;
      const edit=(title,value,key,config={})=>field(title,value,{scope:'pcba-resource',id:resource.id,owner,key,...config});
      const signals=[...new Set([...Object.keys(route?.pins||{}),...Object.keys(resource.pins)])];
      return `<details class="resource-disclosure hardware-resource" data-state-key="pcba-${esc(owner)}-${esc(resource.id)}" ${!resource.instance?'open':''}><summary data-live="pcba-summary-${esc(owner)}-${esc(resource.id)}"><span class="hardware-resource-kind">${esc(label)}</span><strong>${esc(resource.name||resource.instance||'新外设')}</strong><span class="hardware-resource-meta">${Object.values(resource.pins).filter(Boolean).map(esc).join(' · ')||'分配引脚'}</span></summary><div class="hardware-resource-body"><div class="profile-form">${edit('资源名称',resource.name,'name')}${edit('外设实例',resource.instance,'instance',{error:resource.kind!=='gpio'&&resource.instance&&resources.some(other=>other.id!==resource.id&&other.instance===resource.instance)?'此外设实例已被其他资源占用。':'',options:routes.filter(route=>route.kind===resource.kind).map(route=>{const busy=route.kind!=='gpio'&&resources.some(other=>other.id!==resource.id&&other.instance===route.instance);return [route.instance,route.instance+(busy?'（已占用）':''),busy];})})}</div>
      ${signals.length?`<div class="hardware-pin-grid">${signals.map(signal=>{
        const pin=resource.pins[signal]||'', candidates=route?.pins[signal]||[];
        const conflicts=occupied(pin,resource.id,signal);
        const error=pin&&pin!=='none'&&!candidates.includes(pin)?'此引脚不支持当前外设信号。':conflicts.length?`引脚已由 ${conflicts.map(user=>user.name+' / '+user.signal).join('、')} 占用。`:'';
        return edit(signal,pin,signal,{section:'pins',error,options:[['none','不连接'],...candidates.map(value=>{const busy=occupied(value,resource.id,signal);return [value,value+(busy.length?'（已占用）':''),busy.length>0];})]});
      }).join('')}</div>`:''}
      <div class="profile-form">${resourceFields(resource.kind).filter(([key])=>key!=='initialLevel'||resource.settings.direction==='output').map(([key,title,type,extra])=>edit(title,resource.settings[key],key,{section:'settings',type,...(type==='select'?{options:extra}:{unit:extra}),...(resourceSettingOptions(mcu,resource,key)?{options:resourceSettingOptions(mcu,resource,key)}:{})})).join('')}</div>${['pwm','adc'].includes(resource.kind)?`<a class="button small navigation-action" href="#/project/hardware?module=hw-board&tab=config">配置采样与 PWM →</a>`:''}<div class="hardware-resource-footer">${remove('remove-pcba-resource',resource.id,owner)}</div></div></details>`;
    }).join(''):'<div class="hardware-empty">按 PCBA 原理图添加外设，同一通信接口可供多个传感器引用。</div>'}
    </section>`;
}

/** A resource reference remains a string in the module contract, but is picked
 * from the board rather than accepting an unrelated peripheral name. */
export function bindSensorField(field,parameters,resources=[]) {
  const rateMatch=/^(motorEncoder|outputEncoder|torqueSensor)Bitrate$/.exec(field.key);
  if(rateMatch){const r=resources.find(resource=>resource.id===parameters[rateMatch[1]+'Resource']);return {...field,type:'readout',displayValue:r?(r.settings.bitrate??r.settings.clockHz??'—'):'—',description:'通信速率由绑定的外设统一配置。'};}
  const match=/^(motorEncoder|outputEncoder|torqueSensor)Resource$/.exec(field.key);
  if(!match)return field;
  const candidates=sensorResources(resources,parameters[`${match[1]}Interface`]);
  return {...field,type:'select',label:'外设接口',options:candidates.map(resource=>({value:resource.id,label:`${resource.name||resource.instance} · ${resource.instance}${resource.kind==='uart'&&resource.settings.physical==='rs485'?' / RS-485':''}`})),description:candidates.length?'引用第二步已配置的外设与引脚。':'先在外设模块添加并配置对应接口。',sensorLayoutTrigger:true};
}

export function renderTripEditor(paths=[],resources=[],{owner='',mcu=''}={}) {
  return `<section class="hardware-editor" aria-label="快速硬件保护"><div class="design-toolbar"><div><h3>异常触发与关断${fieldHelp('锁存输出关断，故障解除后由应用授权复位。电压、温度等常规软件轮询保护在应用层配置；电流环内的软件限值仍属于算法层。','硬件保护')}</h3></div><button class="button small" data-action="add-trip-path" data-owner="${esc(owner)}">添加保护路径</button></div>${paths.length?paths.map((path,index)=>{
    const edit=(label,key,config={})=>field(label,path[key],{scope:'trip-path',id:path.id,owner,key,...config});
    const sources=resources.filter(resource=>resource.kind==='comparator'||resource.kind==='gpio'&&resource.settings.direction==='input');
    const outputs=resources.filter(isPwmResource);
    const options=list=>list.map(resource=>[resource.id,`${resource.name||resource.instance} · ${Object.values(resource.pins).filter(Boolean).join(' / ')||resource.instance}`]);
    const toggle=(key,label)=>`<label class="switch-field parameter-phase-switch" data-phase="${key==='compiled'?'compile':'runtime'}"><input type="checkbox" data-edit="trip-path" data-id="${esc(path.id)}" data-owner="${esc(owner)}" data-key="${key}" data-value-type="boolean" aria-label="${label}" ${path[key]!==false?'checked':''}><span class="switch-ui" data-phase-label="${label}" aria-hidden="true"></span></label>`;
    return `<details class="resource-disclosure hardware-resource algorithm-path-card" data-state-key="hardware-path-${esc(owner)}-${esc(path.id)}"><summary><span class="module-sequence">${String(index+1).padStart(2,'0')}</span><strong>${esc(TRIP_SOURCES.find(([key])=>key===path.source)?.[1]||'保护路径')}</strong><span class="algorithm-path-switches">${path.compiled!==false?toggle('enabled','运行期'):'<span></span>'}${toggle('compiled','编译期')}</span></summary>${path.compiled!==false?`<div class="hardware-resource-body"><div class="hardware-trip-flow"><span>${esc(TRIP_SOURCES.find(([id])=>id===path.source)?.[1])}</span><span aria-hidden="true">→</span><strong>${path.route==='break'?'PWM 硬件刹车':'外部中断'}</strong><span aria-hidden="true">→</span><span>锁存关断</span></div><div class="profile-form">${edit('故障来源','source',{options:TRIP_SOURCES})}${edit('输入资源','inputResource',{options:options(sources)})}${edit('关断路径','route',{options:TRIP_ROUTES})}${edit('PWM 关断目标','pwmResource',{options:options(outputs)})}${edit('有效电平','activeLevel',{options:[['low','低有效 / 下降沿'],['high','高有效 / 上升沿']]})}${path.route==='interrupt'?edit('中断优先级','priority',{type:'select',options:hardwareFieldOptions(mcu,'hw-platform','controlIrqPriority')}):edit('硬件滤波周期','filterCycles',{type:'integer'})}</div>${fieldHelp(`${path.route==='break'?'通过已适配的硬件路由直接关断 PWM，不等待软件任务。滤波会增加响应延迟。':'由外部中断立即关断 PWM，不经过任务轮询；响应时间仍受中断屏蔽和抢占影响。'}`, '关断路径')}<div class="hardware-resource-footer"><span class="hardware-latch">故障锁存 · 应用授权复位</span>${remove('remove-trip-path',path.id,owner)}</div></div>`:''}</details>`;
  }).join(''):'<div class="hardware-empty">先在 PCBA 配置故障输入与 PWM，再建立关断路径。支持比较器和外部故障输入。</div>'}</section>`;
}

/** Edits the actual bound peripheral, not a divergent copy in each driver. */
export function renderSensorTransport(parameters,role,resources,{mcu,owner=''}={}) {
  const resource=sensorResources(resources,parameters[role.prefix+'Interface']).find(item=>item.id===parameters[role.prefix+'Resource']);
  if(!resource||!['spi','uart','i2c'].includes(resource.kind))return '';
  return `<div class="driver-transport"><div class="driver-transport-title"><strong>${esc(resource.instance)}</strong>${fieldHelp('这里直接修改绑定外设的通信参数；其他引用同一接口的驱动同步使用。引脚在外设模块配置。','通信参数')}</div><div class="sensor-fields">${resourceFields(resource.kind).map(([key,label,type,extra])=>field(label,resource.settings[key],{scope:'pcba-resource',id:resource.id,owner,key,section:'settings',type,...(type==='select'?{options:extra}:{unit:extra}),...(resourceSettingOptions(mcu,resource,key)?{options:resourceSettingOptions(mcu,resource,key)}:{})})).join('')}</div></div>`;
}
