import {renderFirmwareComponents,firmwareTray} from '../attachments/bundles.mjs';
import { renderPlatformConfiguration } from '../configuration/platform-view.mjs';
import { bindHardwareField, hardwareFieldOptions } from '../../modules/hardware/hw-platform/options.mjs';
import { fieldHelp } from '../../shared/ui/field-help.mjs';
import { bindSensorField, renderResourceEditor, renderTripEditor, renderSensorTransport } from '../configuration/hardware-view.mjs';
import { edit, esc, rid } from '../configuration/view.mjs';
import { issueNoticeButton } from '../../shared/ui/issue-notices.mjs';
import { getAssemblySummary, getDriverHardware, isAssemblyComplete } from './model.mjs';
import { MODULES } from '../../core/catalog.mjs';
import { icon } from '../../shared/ui/icons.mjs';
import { renderSensorConfig } from '../../modules/hardware/hw-sensors/view.mjs';
import { renderAssemblyPerformance } from '../performance/view.mjs';

const groups={assemblies:'关节模组',actuators:'执行器',drivers:'驱动器'};
const assetKinds={assemblies:'assembly',actuators:'actuator',drivers:'driver'};
const addActions={actuators:'add-actuator',drivers:'add-driver',assemblies:'add-assembly'};
const field=(label,key,unit='')=>[label,key,unit];
const motorFields=[field('转子极对数','polePairs'),field('定子槽数','statorSlots'),field('相电阻','resistanceOhm','Ohm'),field('d 轴电感','inductanceDH','H'),field('q 轴电感','inductanceQH','H'),field('永磁磁链','fluxWb','Wb'),field('转矩常数','torqueConstantNmA','N·m/A'),field('额定电流','ratedCurrentA','A'),field('峰值电流','maxCurrentA','A'),field('最高电机转速','maxSpeedRpm','RPM')];
const reducerFields=[field('减速比','ratio'),field('传动效率','efficiency','%'),field('回差','backlashArcmin','arcmin'),field('额定力矩','ratedOutputTorqueNm','N·m'),field('峰值力矩','maxOutputTorqueNm','N·m')];
const driverFields=[field('母线电压','busVoltageV','V'),field('最大相电流','maxCurrentA','A'),field('PWM 频率','pwmHz','Hz'),field('ADC 分辨率','adcBits','bit'),field('ADC 时钟','adcClockHz','Hz'),field('PWM 死区','deadtimeNs','ns'),field('Flash 容量','flashKiB','KiB'),field('擦除粒度','eraseKiB','KiB'),field('固件与升级预留','firmwareReserveKiB','KiB')];
const button=(text,action,id='',child='',disabled=false)=>`<button class="button small" data-action="${action}" data-id="${esc(id)}" data-child="${esc(child)}"${disabled?' disabled':''}>${text}</button>`;
const fmt=(value,unit='')=>typeof value==='number'&&Number.isFinite(value)?`${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}).format(value)} ${unit}`:'待配置';

export function renderEquipment(project,issues,group='assemblies',id='',draft={actuatorId:'',driverId:'',name:''},firmwareState={records:[],loading:true}) {
  if(!groups[group]&&group!=='firmware')group='assemblies';
  const header=equipmentHeader(project,group,firmwareState);
  if(group==='firmware')return header+renderFirmwareComponents(firmwareState,id);
  const list=project.catalog[group];
  const complete=project.catalog.assemblies.filter(item=>isAssemblyComplete(project.catalog,item));
  const selected=list.find(x=>x.id===id)||(group==='assemblies'?complete[0]:null)||list[0];
  const addLabel=group==='assemblies'?'组装关节模组 →':`新建${groups[group]}`;
  if(group==='assemblies'&&id==='new')return `${header}<div class="design-toolbar"><a class="button small navigation-action" href="#/equipment/assemblies">← 返回关节模组</a></div>${assemblyBuilder(project,draft,firmwareState)}`;
  return `${header}
    <div class="design-layout"><aside class="panel performance-history shelf-history"><div class="design-toolbar"><h2>${groups[group]}</h2><span class="muted">${list.length}</span></div><div class="shelf-history-actions">${button(addLabel,addActions[group])}</div><div data-live="equipment-list">${equipmentList(project,group,list,selected)}</div></aside>
    <section class="design-editor" data-equipment-kind="${assetKinds[group]}">${selected?`<div class="design-toolbar"><h2 data-live="equipment-title">${esc(selected.name||`未命名${groups[group]}`)}</h2><span class="asset-kind asset-kind-${assetKinds[group]}">${group==='assemblies'?(isAssemblyComplete(project.catalog,selected)?groups[group]:'待完成搭配'):`${groups[group]}组件`}</span>${button('移除',`remove-${group}`,selected.id)}${button('撤销','undo')}</div>${group==='actuators'?actuatorEditor(selected):group==='drivers'?driverEditor(selected):assemblyEditor(selected,project,issues,firmwareState)}<div data-live="equipment-health">${issueNoticeButton(issues.filter(i=>i.designPage==='equipment'&&(!i.itemId||i.itemId===selected.id)),{label:'查看选型检查'})}</div>`:`<div class="empty-state"><h2>${group==='assemblies'?'第一只关节模组，等你来组装～':`这里还没有${groups[group]}哦 (・ω・)`}</h2><p>${group==='actuators'?'执行器组件记录电机与减速机参数。减速比设为 1 可表示直驱。':group==='drivers'?'驱动器组件记录电气能力、MCU 型号，以及板卡外设和引脚分配。':'先从组件库选择执行器和驱动器，完成搭配后保存为关节模组。'}</p>${button(addLabel,addActions[group])}</div>`}</section></div>`;
}
function equipmentHeader(project,group,firmwareState) {
  const complete=project.catalog.assemblies.filter(item=>isAssemblyComplete(project.catalog,item));
  const tab=key=>`<a class="${key===group?'active':''}" href="#/equipment/${key}"${key===group?' aria-current="page"':''}>${groups[key]}<span>${key==='assemblies'?complete.length:project.catalog[key].length}</span></a>`;
  return `<div class="page-heading"><div><h1>货架</h1><p class="page-description">关节模组由执行器（电机 + 减速机）与驱动器组成。组件可在多个模组中复用。</p></div></div><nav class="equipment-tabs shelf-navigation" aria-label="货架分类"><div class="shelf-nav-group"><span class="shelf-nav-label">产品</span>${tab('assemblies')}</div><div class="shelf-nav-group shelf-components"><span class="shelf-nav-label">组件库</span>${tab('actuators')}${tab('drivers')}<a class="${group==='firmware'?'active':''}" href="#/equipment/firmware">固件<span>${firmwareState.bundles?.length||0}</span></a></div></nav>`;
}
function equipmentList(project,group,list,selected) {
  const item=entry=>{
    const complete=group==='assemblies'&&isAssemblyComplete(project.catalog,entry);
    const actuator=group==='assemblies'&&project.catalog.actuators.find(part=>part.id===entry.actuatorId);
    const driver=group==='assemblies'&&project.catalog.drivers.find(part=>part.id===entry.driverId);
    const details=group==='assemblies'?`<div class="assembly-components"><span class="asset-kind asset-kind-actuator" title="执行器">${esc(actuator?.name||(actuator?'未命名执行器':'执行器待选择'))}</span><span class="asset-kind asset-kind-driver" title="驱动器">${esc(driver?.name||(driver?'未命名驱动器':'驱动器待选择'))}</span></div><small>${!complete?'待完成搭配':entry.id===project.catalog.activeAssemblyId?'当前选型':'已组装'}</small>`:`<small>${group==='actuators'?'电机 + 减速机':esc(entry.mcu)||'MCU 待选择'}</small>`;
    return `<a class="performance-history-item shelf-history-item ${entry===selected?'active':''}" data-part-kind="${assetKinds[group]}" href="#/equipment/${group}/${rid(entry.id)}"><strong>${esc(entry.name||`未命名${groups[group]}`)}</strong>${details}</a>`;
  };
  if(group!=='assemblies')return `<p class="shelf-list-label">${groups[group]}组件 · ${list.length}</p>${list.map(item).join('')}`;
  const complete=list.filter(entry=>isAssemblyComplete(project.catalog,entry));
  const incomplete=list.filter(entry=>!isAssemblyComplete(project.catalog,entry));
  return `<p class="shelf-list-label">已组装 · ${complete.length}</p>${complete.map(item).join('')}${incomplete.length?`<p class="shelf-list-label shelf-pending-label">待完成搭配 · ${incomplete.length}</p>${incomplete.map(item).join('')}`:''}`;
}
function assemblyBuilder(project,draft,firmwareState) {
  const firmware=firmwareState.bundles?.find(item=>item.id===draft.firmwareId);
  const a=project.catalog.actuators.find(x=>x.id===draft.actuatorId);
  const d=project.catalog.drivers.find(x=>x.id===draft.driverId);
  const source=(kind,list,label)=>`<section class="parts-tray" data-part-kind="${kind}"><div class="parts-tray-title"><h3>${label}</h3>${kind==='actuator'?'<span class="parts-kind">电机 + 减速机</span>':''}<a class="button small navigation-action" href="#/equipment/${kind==='actuator'?'actuators':'drivers'}">管理 →</a></div><div class="parts-items">${list.length?list.map(x=>`<article class="part-card ${draft[kind+'Id']===x.id?'selected':''}" draggable="false" data-drag-kind="${kind}" data-id="${esc(x.id)}">${icon('grip','part-grip')}${kind==='actuator'?'<img src="/assets/motor.svg" alt="" width="25" height="25">':icon('chip','driver-icon')}<div><strong>${esc(x.name||label)}</strong><small>${kind==='actuator'?`减速比 ${fmt(x.reducer.ratio)}`:esc(x.mcu||'MCU 待选择')}</small></div><button class="part-select" data-action="pick-part" data-kind="${kind}" data-id="${esc(x.id)}" aria-label="选用${esc(x.name||label)}">选用</button></article>`).join(''):`<a class="parts-empty" href="#/equipment/${kind==='actuator'?'actuators':'drivers'}">先添加${label} →</a>`}</div></section>`;
  const slot=(kind,item,label)=>`<div class="assembly-slot ${item?'filled':''}" data-drop-kind="${kind}" role="group" aria-label="${label}放置区"><span class="slot-label">${label}</span><strong>${item?esc(item.name||label):`拖入${label}`}</strong><span class="slot-detail">${item?(kind==='actuator'?'电机 + 减速机':esc(item.board||'驱动与板级资源')):'也可点击组件右侧的“选用”'}</span>${item?`<button class="slot-clear" data-action="clear-part" data-kind="${kind}" aria-label="移出${label}">${icon('close')}</button>`:''}</div>`;
  return `<section class="assembly-builder" id="assembly-builder" tabindex="-1" aria-label="组装关节模组"><div class="design-toolbar"><div><h2>组装关节模组</h2><p class="design-note">从组件库各选一个执行器和驱动器，拖入中间或点击“选用”完成搭配。</p></div><span class="status-pill">${a&&d?'搭配已完成':'待选择两个组件'}</span></div><div class="assembly-bench">${source('actuator',project.catalog.actuators,'执行器')}<section class="assembly-stage" aria-label="关节模组组装区">${slot('actuator',a,'执行器')}<div class="assembly-coupler" aria-hidden="true"><span></span>${icon('plus')}<span></span></div>${slot('driver',d,'驱动器')}${slot('firmware',firmware,'固件')}<div class="assembly-result">${edit('关节模组名称',draft.name,'assembly-draft','name')}<button class="button primary" data-action="save-joint" ${!a||!d?'disabled':''}>${icon('save')}保存关节模组</button></div></section>${source('driver',project.catalog.drivers,'驱动器')}</div>${firmwareTray(firmwareState,draft)}</section>`;
}
function actuatorEditor(a) {
  return `${edit('执行器名称',a.name,'actuator','name',{id:a.id})}<div class="design-toolbar"><h3>电机参数</h3><span class="asset-kind asset-kind-actuator">电机侧</span></div><div class="profile-form">${motorFields.map(([label,key,unit])=>edit(label,a.motor[key],'actuator',key,{id:a.id,section:'motor',unit,type:['polePairs','statorSlots'].includes(key)?'integer':'number'})).join('')}</div><p class="design-note">电流、磁链和转矩常数应使用一致的相量与峰值 / 有效值约定；参数用于设计记录，应用前需与控制算法定义核对。</p><div class="design-toolbar"><h3>减速机参数</h3><span class="asset-kind asset-kind-actuator">出轴侧</span></div><div class="profile-form">${reducerFields.map(([label,key,unit])=>edit(label,key==='efficiency'&&a.reducer[key]!=null?a.reducer[key]*100:a.reducer[key],'actuator',key,{id:a.id,section:'reducer',unit,type:'number',...(key==='efficiency'?{min:0,max:100,scale:0.01}:{})})).join('')}</div><p class="design-note">减速比 = 电机转速 / 输出轴转速。直驱填 1；电机电角度、转子机械角和输出轴角度分别定义。</p>`;
}
function driverEditor(d) {
  return `<div class="profile-form">${edit('驱动器名称',d.name,'driver','name',{id:d.id})}${edit('MCU 型号',d.mcu,'driver','mcu',{id:d.id})}${edit('PCBA 标识 / 版本',d.board,'driver','board',{id:d.id})}${driverFields.filter(([,key])=>!d.memoryLayout?.banks.length||!['flashKiB','eraseKiB','firmwareReserveKiB'].includes(key)).map(([label,key,unit])=>edit(label,d[key],'driver',key,{id:d.id,unit,type:key==='adcBits'?'integer':'number',choices:hardwareFieldOptions(d.mcu,'hw-board',key)})).join('')}</div>${driverHardwareEditor(d)}`;
}
function assemblyEditor(a,project,issues,firmwareState) {
  const s=getAssemblySummary(project,a.id);
  const complete=isAssemblyComplete(project.catalog,a);
  const active=project.catalog.activeAssemblyId===a.id;
  const applicationIssues=issues.filter(issue=>issue.id==='equipment-active-stale'&&issue.itemId===a.id);
  const choices=(list,value,label)=>[...(!list.some(item=>item.id===value)?[[value,value?`${label}已移除 · 待选择`:`待选择${label}`,true]]:[]),...list.map(item=>[item.id,item.name||`未命名${label}`])];
  return `<div class="profile-form">${edit('关节模组名称',a.name,'assembly','name',{id:a.id})}${edit('执行器',a.actuatorId,'assembly','actuatorId',{id:a.id,choices:choices(project.catalog.actuators,a.actuatorId,'执行器')})}${edit('驱动器',a.driverId,'assembly','driverId',{id:a.id,choices:choices(project.catalog.drivers,a.driverId,'驱动器')})}${edit('固件',a.firmwareId||'','assembly','firmwareId',{id:a.id,choices:[['','未搭配固件'],...(firmwareState.bundles||[]).map(item=>[item.id,item.name+' / '+item.version])]})}</div><div class="assembly-summary" data-live="assembly-summary"><div><span>减速比</span><strong>${fmt(s.ratio)}</strong></div><div><span>估算最高输出转速</span><strong>${fmt(s.outputMaxSpeedRpm,'rpm')}</strong></div><div><span>估算额定输出力矩</span><strong>${fmt(s.outputRatedTorqueNm,'N·m')}</strong></div></div><div class="assembly-links" data-live="assembly-links">${s.actuator?`<a class="asset-kind asset-kind-actuator" href="#/equipment/actuators/${rid(s.actuator.id)}">查看执行器参数 →</a>`:''}${s.driver?`<a class="asset-kind asset-kind-driver" href="#/equipment/drivers/${rid(s.driver.id)}">查看驱动器资源 →</a>`:''}</div><div class="design-toolbar" data-live="assembly-state"><span class="status-pill ${complete&&active&&s.stale?'warning':'neutral'}">${!complete?'待完成搭配':active?(s.stale?'待重新应用':'已应用'):'未应用'}</span>${issueNoticeButton(applicationIssues,{label:'查看应用检查'})}</div><div class="design-toolbar">${button('应用到当前配置','apply-assembly',a.id,'',!complete)}<a class="button" href="#/project/hardware">继续工程 →</a></div><p class="design-note">${complete?'应用将复用驱动器整套硬件配置，并更新电流上限。算法直接读取当前执行器的电机参数；极对数等参数统一在货架中维护。':'选择有效的执行器与驱动器后，此条目才计入关节模组，并可应用到当前配置。'}</p>${renderAssemblyPerformance(project,a.id)}`;
}

function driverHardwareEditor(driver) {
  const hardware=getDriverHardware(driver);
  const duplicate=new Set(driverFields.map(([,key])=>key));
  const fieldsFor=module=>module.params.filter(param=>!param.computed&&!param.hidden&&!duplicate.has(param.key));
  const renderFields=module=>{
    const renderField=param=>param.type==='readout'?`<div class="form-field"><span class="field-label">${esc(param.label)}${fieldHelp(param.description,param.label)}</span><output class="computed-field">${esc(param.displayValue??'—')}</output></div>`:edit(param.label,hardware[module.id][param.key],'driver-hardware',param.key,{id:driver.id,section:module.id,type:param.type,unit:param.unit,phase:param.phase,...(param.options?{choices:param.options.map(option=>[option.value,option.label])}:{}),description:param.description});
    if(module.id==='hw-platform')return renderPlatformConfiguration(driver.mcu,hardware[module.id],fieldsFor(module),renderField,{owner:driver.id});
    return module.id==='hw-sensors'?renderSensorConfig(hardware[module.id],field=>renderField(bindSensorField(field,hardware[module.id],hardware['hw-board'].resources||[])),{renderTransport:role=>renderSensorTransport(hardware[module.id],role,hardware['hw-board'].resources||[],{mcu:driver.mcu,owner:driver.id})}):fieldsFor(module).filter(field=>!field.architectureOnly||field.architectureOnly===hardware['hw-platform'].architecture).map(field=>renderField(bindHardwareField(field,driver.mcu,module.id))).join('')+(module.id==='hw-board'?renderResourceEditor(driver.mcu,hardware[module.id].resources||[],{owner:driver.id}):module.id==='hw-safety'?renderTripEditor(hardware[module.id].tripPaths||[],hardware['hw-board'].resources||[],{owner:driver.id,mcu:driver.mcu}):'');
  };
  return `<div class="design-toolbar"><h3>可复用硬件配置</h3>${button('复用到当前配置','use-driver',driver.id)}</div><p class="design-note">这些配置随驱动器保存，选型后一起带入当前配置。新板卡完成配置后，也可将当前配置的硬件配置存回此驱动器。</p><p class="design-note">Flash 扇区表：${driver.memoryLayout?.banks.length||0} 个区域。复用到项目后，可在内核模块的部署配置中调整，再保存回此驱动器。</p><div class="driver-hardware">${MODULES.filter(module=>module.layer==='hardware'&&fieldsFor(module).length).sort((a,b)=>a.order-b.order).map(module=>`<details class="panel"><summary>${esc(module.title)}</summary><div class="profile-form">${renderFields(module)}</div></details>`).join('')}</div><div class="design-toolbar">${button('用当前硬件配置更新','capture-driver',driver.id)}</div>`;
}
