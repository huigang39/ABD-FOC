import { getMcuCores } from '../hw-platform/targets.mjs';
import { select, choices } from '../../shared/fields.mjs';
import { esc } from '../../../shared/esc.mjs';

export const CORE_EXCEPTION_FIELDS = ['cm7','cm4','rv32'].flatMap(core => [
  select(core+'FaultAction','异常后处理',choices([['halt','关断后保持'],['reset','关断后复位']]),'init','初始化时加载处理策略；先尝试关断输出，再执行所选动作；CPU 异常时软件关断不能替代独立硬件保护。',{defaultValue:'halt',required:false,exceptionCore:core}),
  {key:core+'FaultSnapshot',label:'保存异常快照',type:'boolean',phase:'init',defaultValue:true,required:false,exceptionCore:core,description:'初始化时加载开关，预留 RAM 不随开关变化；先写入预留 RAM，记录内核、异常原因和有效寄存器；重启后再转存日志区，不在异常处理器里直接擦写 FLASH。'},
]);
export function renderCoreExceptions(project, renderField) {
  const cores=getMcuCores(project.target.mcu);
  return cores.map(core=>`<details class="resource-disclosure hardware-resource core-exception-card" data-state-key="core-exceptions-${esc(core.id)}"><summary><strong>${esc(core.label)} 异常</strong></summary><div class="hardware-resource-body"><div class="core-exception-types" aria-label="异常类型">${(core.id==='rv32'?['Trap']:['HardFault','MemManage','BusFault','UsageFault','NMI']).map(type=>`<span class="attribute-tag">${type}</span>`).join('')}</div><div class="profile-form">${CORE_EXCEPTION_FIELDS.filter(field=>field.exceptionCore===core.id).map(renderField).join('')}</div></div></details>`).join('');
}
