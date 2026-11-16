import { createMemoryPlan, createMemoryBank, createMemorySector, generateUniformSectors, checkMemoryPlanShape } from './flash.mjs';
import { createExecutionPlan, applyExecutionPreset, checkExecutionShape } from './execution.mjs';

const requireTarget = project => { if(!project.target?.mcu?.trim())throw new Error('请先选择 MCU。'); };
const bankFor = (project,id) => {const bank=project.memory.layout.banks.find(item=>item.id===id);if(!bank)throw new Error('Flash 区域已不存在。');return bank;};
function check(project) { checkMemoryPlanShape(project.memory); checkExecutionShape(project.execution); return project; }
function copy(project) {const next=structuredClone(project);next.memory??=createMemoryPlan();next.execution??=createExecutionPlan();return next;}

export function deploymentAction(project, action, {id='',child='',value=null}={}) {
  if(action==='execution-preset')return applyExecutionPreset(project);
  const next=copy(project);
  if(action==='execution-reset')next.execution=createExecutionPlan();
  else if(action==='execution-rebind') {requireTarget(next);next.execution.mcu=next.target.mcu;}
  else if(action==='memory-rebind') {requireTarget(next);Object.assign(next.memory.layout,{mcu:next.target.mcu,board:next.target.board});}
  else if(action==='memory-add-bank') {
    requireTarget(next);
    if(next.memory.layout.banks.length>=64)throw new Error('最多配置 64 个 Flash 区域。');
    if(!next.memory.layout.banks.length)Object.assign(next.memory.layout,{mcu:next.target.mcu,board:next.target.board});
    next.memory.layout.banks.push(createMemoryBank());
  } else if(action==='memory-remove-bank') {bankFor(next,id);next.memory.layout.banks=next.memory.layout.banks.filter(item=>item.id!==id);}
  else if(action==='memory-add-sector') {
    const bank=bankFor(next,id);if(bank.sectors.length>=4096)throw new Error('每个 Flash 区域最多配置 4096 个扇区。');
    const sector=createMemorySector();sector.name=`扇区 ${bank.sectors.length}`;bank.sectors.push(sector);
  } else if(action==='memory-remove-sector') {
    const bank=bankFor(next,id);bank.sectors=bank.sectors.filter(item=>item.id!==child);
  } else if(action==='memory-generate-sectors') {
    const bank=bankFor(next,id);bank.sectors=generateUniformSectors(bank,value);
  } else throw new Error('未知部署操作。');
  return check(next);
}

export function deploymentEdit(project, scope, {id='',child='',key=''}={}, value) {
  const next=copy(project);
  let target,allowed;
  if(scope==='memory-bank') {target=bankFor(next,id);allowed=['name','baseAddress','sizeKiB','executable'];}
  else if(scope==='memory-sector') {target=bankFor(next,id).sectors.find(item=>item.id===child);allowed=['name','offsetKiB','sizeKiB','reserved'];}
  else if(scope==='memory-placement') {
    if(!Object.hasOwn(next.memory.placements,id))throw new Error('分区用途不存在。');
    target=next.memory.placements[id];allowed=['bankId','budgetKiB'];
    if(target&&key==='bankId'&&target.bankId!==value)target.sectorIds=[];
  } else if(scope==='memory-assignment') {
    if(!Object.hasOwn(next.memory.placements,id))throw new Error('分区用途不存在。');
    target=next.memory.placements[id];
    if(!target)throw new Error('分区用途不存在。');
    if(value) {
      const bank=bankFor(next,target.bankId),sector=bank.sectors.find(item=>item.id===child);
      if(!sector)throw new Error('扇区不存在。');
      if(sector.reserved)throw new Error('保留扇区不能分配。');
      if(Object.entries(next.memory.placements).some(([region,placement])=>region!==id&&placement.bankId===bank.id&&placement.sectorIds.includes(child)))throw new Error('此扇区已分配给其他用途。');
      if(!target.sectorIds.includes(child))target.sectorIds.push(child);
    } else target.sectorIds=target.sectorIds.filter(sectorId=>sectorId!==child);
    return check(next);
  } else if(scope==='execution') {target=next.execution;allowed=['bootCore'];}
  else if(scope==='execution-module') {
    if(!Object.hasOwn(next.execution.assignments,id))throw new Error('模块不存在。');
    next.execution.assignments[id]=value;
    if(!next.execution.mcu)next.execution.mcu=next.target.mcu;
    return check(next);
  } else if(scope==='execution-ipc') {target=next.execution.ipc;allowed=['transport','notification','cachePolicy','sharedAddress','sharedSizeKiB'];}
  if(!target||!allowed?.includes(key))throw new Error('部署配置项不存在。');
  target[key]=value;
  if(scope.startsWith('execution')&&!next.execution.mcu)next.execution.mcu=next.target.mcu;
  return check(next);
}

export function parseAddress(value) {
  const text=String(value).trim();
  if(!text)return null;
  if(!/^(0x[0-9a-f]+|[0-9]+)$/i.test(text))throw new Error('请输入十六进制（0x 开头）或十进制地址。');
  const result=Number(text);
  if(!Number.isSafeInteger(result)||result<0)throw new Error('地址必须是有效的非负整数。');
  return result;
}
