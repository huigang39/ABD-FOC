import { validateCoreConfigs, coreRoles } from '../hw-platform/cores.mjs';
import { resourceIssues, sensorResources } from './resources.mjs';
import { tripIssues } from '../hw-safety/paths.mjs';
import { SENSOR_ROLES } from '../hw-sensors/sensors.mjs';
import { hardwareFieldOptions } from '../hw-platform/options.mjs';

export function validateHardware(project) {
  const p=project.instances['hw-platform'].parameters;
  const resources=project.instances['hw-board'].parameters.resources||[];
  const paths=project.instances['hw-safety'].parameters.tripPaths||[];
  const sensors=project.instances['hw-sensors'].parameters;
  const owner=project.execution?.assignments?.['hw-safety']||coreRoles(project.target.mcu,project).control;
  const issues=[...resourceIssues(project.target.mcu,resources),...validateCoreConfigs(project.target.mcu,p,project),...tripIssues(paths,resources,{architecture:p.architecture,irqPriorityBits:p.coreConfigs?.[owner]?.irqPriorityBits})];
  const add=(id,level,title,message,moduleId='hw-platform',paramKey='')=>issues.push({id:`hardware-${id}`,level,title,message,moduleId,paramKey});
  for (const [moduleId, keys] of [['hw-board',['adcBits']]]) for (const key of keys) {
    const choices = hardwareFieldOptions(project.target.mcu,moduleId,key), value = project.instances[moduleId]?.parameters?.[key];
    if (choices && value != null && !choices.some(option=>option.value===value)) add(`${key}-choice`,'error','参数超出 MCU 支持范围','请从当前 MCU 提供的选项中选择。',moduleId,key);
  }
  for(const role of SENSOR_ROLES) {
    if(sensors[role.capability]!=='present')continue;
    const key=role.prefix+'Resource', reference=sensors[key], type=sensors[role.prefix+'Interface'];
    if(!reference)continue; // Existing required-field validation supplies the empty-field issue.
    const resource=resources.find(resource=>resource.id===reference);
    if(!resource)add(`${role.id}-resource`,'error',`${role.title}的 PCBA 接口不存在`,'选择第二步已配置的外设资源。','hw-sensors',key);
    else if(!sensorResources(resources,type).some(resource=>resource.id===reference))add(`${role.id}-interface`,'error',`${role.title}的接口类型不匹配`,'传感器协议与绑定外设、电气接口必须一致。','hw-sensors',key);
    else {
      const rate=resource.settings.bitrate??resource.settings.clockHz;
      if(rate!=null&&sensors[role.prefix+'Bitrate']!=null&&rate!==sensors[role.prefix+'Bitrate'])add(`${role.id}-bitrate`,'error',`${role.title}与 PCBA 接口速率不一致`,'重新选择接口以带入 PCBA 的通信速率。','hw-sensors',key);
    }
  }
  return issues;
}

export function syncSensorResource(sensors,resources,prefix) {
  for(const role of SENSOR_ROLES) {
    if(prefix&&role.prefix!==prefix)continue;
    const resource=resources.find(resource=>resource.id===sensors[role.prefix+'Resource']);
    if(!resource)continue;
    const rate=resource.settings.bitrate??resource.settings.clockHz;
    if(rate!==undefined)sensors[role.prefix+'Bitrate']=rate;
  }
}
