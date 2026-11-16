import { interruptPriorityMapping, resolveInterruptPriority } from '../../web/src/modules/hardware/hw-platform/priorities.mjs';
import { runtimeConfiguration } from '../../web/src/features/configuration/runtime-config.mjs';
import { moduleEntries } from '../../web/src/modules/entrypoints.mjs';
import { scheduledTasks, schedulerTasks, periodMicroseconds } from '../../web/src/features/configuration/schedule.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MODULES} from '../../web/src/core/catalog.mjs';
import {MODULE_CODE} from './modules.mjs';
import {moduleStructures,renderStructure} from './contracts.mjs';
import {renderDrivers} from './drivers.mjs';
import {configurationFingerprint} from '../../web/src/core/contracts.mjs';
const LAYER={hardware:'hardware',foc:'algorithm',app:'application'};
const integerKeys=new Set(['task_count','period_us','reference_timeout_us','timeout_us','sample_count']);
function cValue(value,integer=false){
  if(Array.isArray(value))return `{${value.map(v=>cValue(v,integer)).join(',')}}`;
  if(typeof value==='boolean')return String(value);
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('生成参数必须为有限数值。');
  if(integer){if(!Number.isSafeInteger(value)||value<0||value>=0x80000000)throw Error('生成的周期或计数超出有效范围。');return `${value}u`;}
  if(!Number.isFinite(Math.fround(value)))throw Error('生成参数超出 float 范围。');
  const text=String(value);return (/[.eE]/.test(text)?text:text+'.0')+'f';
}
export function moduleConfig(project,moduleId){const info=MODULE_CODE[moduleId];const values=info.values?.(project)||{};return Object.entries(values).map(([key,value])=>`.${key}=${cValue(value,integerKeys.has(key))}`).join(',');}
export async function writeNewProject(root,project){
  for(const id of ['foc-observer','foc-compensation'])if(project.instances[id]?.enabled&&project.instances[id].parameters.children?.some(child=>child.compiled))throw Error('独立算法子模块尚未接入生成器。');
  if(project.instances['foc-filter']?.enabled)throw Error('滤波器独立实例与数据连接尚未接入固件生成。');
  const files=[],units=[],contracts=[];
  for(const module of MODULES){
    const instance=project.instances[module.id];if(!instance.enabled)continue;
    const info=MODULE_CODE[module.id],layer=LAYER[module.layer],folder=join(root,'firmware',layer,info.name);
    await mkdir(folder,{recursive:true});
    let header,source;
    if(module.id==='hw-drivers')({header,source}=renderDrivers(project));
    else {
      const guard=`${info.name.toUpperCase()}_H`;
      header=`#ifndef ${guard}\n#define ${guard}\n#include <stdbool.h>\n#include <stdint.h>\n${moduleStructures(project,module.id).map(renderStructure).join('\n')}`;
      if(module.id==='foc-lifecycle')header+='\nuint32_t control_current_faults(const float measured[2], const float reference[2], bool feedback_valid, float dt, float voltage_limit, float current_limit, uint32_t now_us, uint32_t reference_time_us, uint32_t timeout_us);\nuint32_t control_numeric_fault(float value);\n';
      if(info.config)header+=`\ntypedef struct { ${info.config} } ${info.base}Config;\nextern const ${info.base}Config ${info.name}_config;\n`;
      for(const entry of moduleEntries(module.id).filter(entry=>entry.symbol!==`${info.name}_step`))header+=`\nvoid ${entry.symbol}(const ${info.base}Input *input, ${info.base}Output *output, ${info.base}State *state);\n`;
      header+=`\nvoid ${info.name}_step(const ${info.base}Input *input, ${info.base}Output *output, ${info.base}State *state);\n#endif\n`;
      source=await readFile(new URL(`./modules/${info.name}.c`,import.meta.url),'utf8');
      const config=moduleConfig(project,module.id);
      if(info.config)source+=`\nconst ${info.base}Config ${info.name}_config = {${config}};\n`;
    }
    for(const entry of moduleEntries(module.id)) {
      const comment=`/**\n * @brief ${entry.title}。${entry.description}\n * @param input 本次调用的只读输入快照。\n * @param output 本次调用更新的输出结果。\n * @param state 跨调用保留的模块状态，由所属执行任务管理。\n */\n`;
      header=header.replace(`void ${entry.symbol}(`,comment+`void ${entry.symbol}(`);
    }
    header=header.replace(/(#endif\n)$/,`#define ${info.name.toUpperCase()}_RUNTIME_DEFAULT ${instance.runtimeEnabled?'true':'false'}\n$1`);
    for(const [kind,content] of [['c',source],['h',header]]){
      const path=join(folder,`${info.name}.${kind}`);await writeFile(path,content);
      files.push({moduleId:module.id,title:module.title,layer,core:project.execution.assignments[module.id],kind,path,primary:true,parameterCount:module.params.length});
    }
    units.push({moduleId:module.id,source:`firmware/${layer}/${info.name}/${info.name}.c`,core:project.execution.assignments[module.id],optimization:project.build.moduleOptimizations[module.id]||project.build.optimization});
    contracts.push({moduleId:module.id,structures:moduleStructures(project,module.id)});
  }
  await mkdir(join(root,'include'),{recursive:true});await mkdir(join(root,'tools'),{recursive:true});
  await writeFile(join(root,'include/math_utils.h'),await readFile(new URL('./modules/math_utils.h',import.meta.url)));
  await writeFile(join(root,'tools/compile.py'),await readFile(new URL('./compile.py',import.meta.url)));
  await writeFile(join(root,'execution-plan.json'),JSON.stringify({firmwareReady:false,interruptPriorities:{mapping:interruptPriorityMapping(project.target.mcu),cores:Object.fromEntries(Object.entries(project.instances['hw-platform'].parameters.coreConfigs).map(([id,config])=>[id,{control:resolveInterruptPriority(project.target.mcu,config.controlIrqPriority),communication:resolveInterruptPriority(project.target.mcu,config.communicationIrqPriority)}]))},tasks:scheduledTasks(project),scheduler: {moduleId:'app-runtime',tasks:schedulerTasks(project).map((task,index)=>({id:task.id,releaseBit:index,periodUs:periodMicroseconds(task.frequencyHz)}))},interfaces:project.design.layerInterfaces},null,2));
  await writeFile(join(root,'runtime-config.json'),JSON.stringify(runtimeConfiguration(project),null,2));
  await writeFile(join(root,'module-contracts.json'),JSON.stringify(contracts,null,2));
  await writeFile(join(root,'build-manifest.json'),JSON.stringify({schemaVersion:1,artifactKind:'module-library',firmwareReady:false,projectFingerprint:configurationFingerprint(project),mcu:project.target.mcu,modules:units,coreConfigs:project.instances['hw-platform'].parameters.coreConfigs,compiler:project.build.compiler,version:project.build.version,lto:project.build.lto,optimization:project.build.optimization},null,2));
  await writeFile(join(root,'README.txt'),'ABD-FOC 模块源码\n\n由配置与各模块实现直接生成。每个启用模块一个 .c/.h，输入、输出、状态由 module-contracts.json 的定义生成。\n\n编译模块库：python3 tools/compile.py --prefix /path/to/arm-none-eabi-\n\n模块库不包含 MCU 启动、PCBA 外设初始化、跨核交接和 EtherCAT 协议栈，不能作为可烧录固件。完整镜像构建必须通过平台适配检查。\n');
  return files;
}
