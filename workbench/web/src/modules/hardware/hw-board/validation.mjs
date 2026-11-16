import { customDriverIssues } from '../hw-drivers/custom-drivers.mjs';
import { driverResourceConflictIssues } from '../hw-drivers/resource-usage.mjs';
import { validateCoreConfigs, coreRoles } from '../hw-platform/cores.mjs';
import { resourceIssues, sensorResources, getMcuResources } from './resources.mjs';
import { tripIssues } from '../hw-safety/paths.mjs';
import { SENSOR_ROLES, isDiscreteGate, builtinDriverInterfaceForModel } from '../hw-drivers/sensors.mjs';
import { hardwareFieldOptions } from '../hw-platform/options.mjs';

export function validateHardware(project) {
  const p=project.instances['hw-platform'].parameters;
  const resources=project.instances['hw-board'].parameters.resources||[];
  const paths=project.instances['hw-safety'].parameters.tripPaths||[];
  const sensors=project.instances['hw-drivers'].parameters;
  const owner=project.execution?.assignments?.['hw-safety']||coreRoles(project.target.mcu,project).control;
  const issues=[...customDriverIssues(sensors,resources),...driverResourceConflictIssues(sensors,resources),...resourceIssues(project.target.mcu,resources),...validateCoreConfigs(project.target.mcu,p,project),...tripIssues(paths,resources,{architecture:p.architecture,irqPriorityBits:p.coreConfigs?.[owner]?.irqPriorityBits})];
  const add=(id,level,title,message,moduleId='hw-platform',paramKey='')=>issues.push({id:`hardware-${id}`,level,title,message,moduleId,paramKey});
  for (const [moduleId, keys] of [['hw-board',['adcBits']]]) for (const key of keys) {
    const choices = hardwareFieldOptions(project.target.mcu,moduleId,key), value = project.instances[moduleId]?.parameters?.[key];
    if (choices && value != null && !choices.some(option=>option.value===value)) add(`${key}-choice`,'error','参数超出 MCU 支持范围','请从当前 MCU 提供的选项中选择。',moduleId,key);
  }
  for(const role of SENSOR_ROLES) {
    if(sensors[role.capability]!=='present' || role.id === 'gate' && isDiscreteGate(sensors))continue;
    const key=role.prefix+'Resource', reference=sensors[key], type=builtinDriverInterfaceForModel(role.prefix,sensors[role.prefix+'Model'])||sensors[role.prefix+'Interface'];
    if(!reference)continue; // Existing required-field validation supplies the empty-field issue.
    const resource=resources.find(resource=>resource.id===reference);
    if(!resource)add(`${role.id}-resource`,'error',`${role.title}的 PCBA 接口不存在`,'选择第二步已配置的外设资源。','hw-drivers',key);
    else if(!sensorResources(resources,type).some(resource=>resource.id===reference))add(`${role.id}-interface`,'error',`${role.title}的接口类型不匹配`,'传感器协议与绑定外设、电气接口必须一致。','hw-drivers',key);
    else {
      const rate=resource.settings.bitrate??resource.settings.clockHz;
      if(rate!=null&&sensors[role.prefix+'Bitrate']!=null&&rate!==sensors[role.prefix+'Bitrate'])add(`${role.id}-bitrate`,'error',`${role.title}与 PCBA 接口速率不一致`,'重新选择接口以带入 PCBA 的通信速率。','hw-drivers',key);
    }
  }
  if (sensors.gateDriverCapability === 'present' && sensors.gateDriverEnablePin) {
    const pin = sensors.gateDriverEnablePin;
    const gpioPins = new Set(getMcuResources(project.target.mcu).filter(route => route.kind === 'gpio').flatMap(route => Object.values(route.pins).flat()));
    if (!gpioPins.size) add('gate-enable-pin-map','pending','门极使能引脚映射待确认','当前 MCU 尚无可用的 GPIO 引脚表。','hw-drivers','gateDriverEnablePin');
    else if (!gpioPins.has(pin)) add('gate-enable-pin','error','门极使能引脚不受支持','请从当前 MCU 维护的 GPIO 引脚中选择。','hw-drivers','gateDriverEnablePin');
    const conflicts = resources.filter(resource => Object.values(resource.pins).includes(pin) && !(resource.kind === 'gpio' && resource.settings.direction === 'output' && resource.pins.IO === pin));
    if (conflicts.length) add('gate-enable-pin-conflict','error','门极使能引脚与外设冲突',`${pin} 已用于 ${conflicts.map(resource => resource.name || resource.instance || resource.id).join('、')}；使能信号需要 GPIO 输出。`,'hw-drivers','gateDriverEnablePin');
  }
  return issues;
}

export function syncSensorResource(sensors,resources,prefix) {
  for(const role of SENSOR_ROLES) {
    if(prefix&&role.prefix!==prefix || role.id === 'gate' && isDiscreteGate(sensors))continue;
    const resource=resources.find(resource=>resource.id===sensors[role.prefix+'Resource']);
    if(!resource)continue;
    const settings=resource.settings||{};
    const key=Object.hasOwn(settings,'bitrate')?'bitrate':Object.hasOwn(settings,'clockHz')?'clockHz':'';
    if(key)sensors[role.prefix+'Bitrate']=settings[key]??null;
  }
}
