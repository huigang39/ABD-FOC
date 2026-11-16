import { esc } from '../../../shared/esc.mjs';
import { icon } from '../../../shared/ui/icons.mjs';
import { selectOptions } from '../../../shared/forms/select-control.mjs';
import { renderIssueMessage } from '../../../shared/ui/issue-message.mjs';
import { SENSOR_ROLES, SENSOR_PARAMS, isDiscreteGate, builtinDriverInterfaceForModel } from './sensors.mjs';
import { sensorResources } from '../hw-board/resources.mjs';
import { customDriverResources } from './custom-drivers.mjs';
import { driverResourceOccupants, driverResourceConflictIssues } from './resource-usage.mjs';

const roleIcons={motor:'target',output:'target',torque:'current',gate:'chip'};
function resourceOptions(candidates,parameters,resources,owner) {
  return [{value:'',label:'选择外设'},...candidates.map(resource=>{
    const occupied=driverResourceOccupants(parameters,resources,resource.id,owner).length>0;
    return {value:resource.id,label:resource.instance+(resource.name&&resource.name!==resource.instance?` · ${resource.name}`:'')+(occupied?'（已占用）':''),...(occupied?{disabled:true,hidden:false}:{})};
  })];
}
function resourceTag(candidates, reference) {
  const bound=candidates.find(resource=>resource.id===reference);
  const label=bound?.instance||'未关联';
  const title=bound?`关联外设：${label}`:'未关联外设';
  return `<span class="attribute-tag driver-resource-tag${bound?'':' is-unbound'}" title="${esc(title)}">${esc(label)}</span>`;
}
function customDrivers(parameters, resources) {
  const conflicts=driverResourceConflictIssues(parameters,resources);
  return (parameters.customDrivers||[]).map(driver=>{
    const candidates=customDriverResources(resources,driver.interface);
    const tag=resourceTag(candidates,driver.resource);
    const selected=candidates.some(resource=>resource.id===driver.resource)?driver.resource:'';
    const owner={customId:driver.id};
    const conflict=selected&&conflicts.find(issue=>issue.itemId===driver.id&&issue.paramKey==='customDrivers');
    const selector=`<div class="form-field"><span class="field-label">外设</span><select class="field-select" data-edit="custom-driver" data-id="${esc(driver.id)}" data-key="resource" aria-label="外设"${conflict?' aria-invalid="true"':''}>${selectOptions(resourceOptions(candidates,parameters,resources,owner),selected)}</select>${conflict?`<span class="field-error">${renderIssueMessage(conflict)}</span>`:''}</div>`;
    return `<section class="sensor-card" data-custom-driver="${esc(driver.id)}"><div class="sensor-card-head">${icon('chip')}<h3 data-live="custom-driver-title-${esc(driver.id)}">${esc(driver.model||driver.name||'其他驱动')}</h3><button type="button" class="button small ghost" data-action="remove-custom-driver" data-id="${esc(driver.id)}" title="移除驱动" aria-label="移除驱动">${icon('trash')}</button>${tag}</div><div class="sensor-fields"><div class="form-field"><span class="field-label">型号</span><input class="field-input" type="text" data-edit="custom-driver" data-id="${esc(driver.id)}" data-key="model" aria-label="型号" value="${esc(driver.model)}" maxlength="120"></div>${selector}</div></section>`;
  }).join('');
}

/** Device presets expose model, configured peripheral and gate enable pin. */
export function renderSensorConfig(parameters = {}, renderField, {resources=[]} = {}) {
  const roles=SENSOR_ROLES.filter(role=>role.id!=='output'||parameters[role.capability]==='present');
  return `<div class="sensor-config"><div class="design-toolbar"><h3>驱动</h3><details class="configuration-more" data-native-menu><summary class="button small hardware-add-toggle" title="添加其他驱动" aria-label="添加其他驱动">${icon('plus')}</summary><div class="configuration-more-body"><button type="button" class="button ghost" data-action="add-custom-driver" data-interface="uart">UART 驱动</button><button type="button" class="button ghost" data-action="add-custom-driver" data-interface="spi">SPI 驱动</button>${parameters.outputEncoderCapability!=='present'?'<button type="button" class="button ghost" data-action="add-output-encoder">出轴角度编码器</button>':''}</div></details></div>${roles.map(role => {
    const p=role.prefix;
    const get=key=>SENSOR_PARAMS.find(field=>field.key===key);
    const fields=[{...get(p+'Model'),label:'型号',description:''}];
    const type=builtinDriverInterfaceForModel(p,parameters[p+'Model'])||parameters[p+'Interface'];
    const discrete=role.id==='gate'&&isDiscreteGate(parameters);
    const candidates=discrete?[]:sensorResources(resources,type);
    const tag=discrete?(parameters.gateDriverEnablePin?`<span class="attribute-tag driver-resource-tag" title="使能引脚">GPIO · ${esc(parameters.gateDriverEnablePin)}</span>`:''):resourceTag(candidates,parameters[p+'Resource']);
    if(!discrete)fields.push({...get(p+'Resource'),label:'外设',type:'select',options:resourceOptions(candidates,parameters,resources,{prefix:p}),description:''});
    if(role.id==='gate')fields.push({...get('gateDriverEnablePin'),label:'使能引脚',description:''});
    return `<section class="sensor-card" data-sensor-role="${esc(role.id)}" aria-label="${esc(role.title)}配置"><div class="sensor-card-head">${icon(roleIcons[role.id])}<h3>${esc(role.title)}</h3>${tag}</div><div class="sensor-fields">${fields.map(renderField).join('')}</div></section>`;
  }).join('')}${customDrivers(parameters,resources)}</div>`;
}
