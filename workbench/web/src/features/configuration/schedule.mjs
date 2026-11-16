import { MODULES } from '../../core/catalog.mjs';
import { ENTRYPOINTS, entryById, fieldEntry } from '../../modules/entrypoints.mjs';
import { moduleCore } from '../deployment/execution.mjs';

export function createSchedule() {
  return { tasks: [
    { id:'current', name:'电流环', trigger:'current', frequencyHz:null, priority:0, budgetUs:null, entries:['peripherals.sample','feedback.step','modulation.transform','observer.step','friction.step','control.step','current.step','modulation.update','peripherals.apply'] },
    { id:'control', name:'应用控制', trigger:'control', frequencyHz:null, priority:1, budgetUs:null, entries:['diagnostics.step','state_machine.step','motion.step'] },
    { id:'communication', name:'通信处理', trigger:'periodic', frequencyHz:1000, priority:2, budgetUs:null, entries:['commands.step'] },
    { id:'calibration', name:'校准处理', trigger:'periodic', frequencyHz:1000, priority:3, budgetUs:null, entries:['zeroing.step'] },
    { id:'maintenance', name:'参数存储', trigger:'periodic', frequencyHz:100, priority:4, budgetUs:null, entries:['records.step'] },
  ] };
}
export function checkScheduleShape(schedule) {
  const object = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k=>Object.hasOwn(v,k));
  if (!object(schedule,['tasks']) || !Array.isArray(schedule.tasks) || schedule.tasks.length > 16) throw Error('任务表必须包含不超过 16 个任务。');
  for (const task of schedule.tasks) {
    if (!object(task,['id','name','trigger','frequencyHz','priority','budgetUs','entries']) || !['id','name'].every(k=>typeof task[k]==='string') || !['current','control','periodic'].includes(task.trigger) || !Number.isSafeInteger(task.priority) || !Array.isArray(task.entries) || task.entries.some(id=>typeof id!=='string')) throw Error('任务配置格式不合法。');
    for (const key of ['frequencyHz','budgetUs']) if (task[key] !== null && (typeof task[key] !== 'number' || !Number.isFinite(task[key]))) throw Error('任务周期与预算必须为有限数字。');
  }
  return true;
}
export function taskFrequency(project, task) {
  const board=project.instances['hw-board'].parameters;
  return task.trigger==='current' ? (board.pwmHz>0 && board.currentLoopDivider>0 ? board.pwmHz/board.currentLoopDivider : null) : task.trigger==='control' ? project.instances['app-motion'].parameters.outerHz : task.frequencyHz;
}
export function taskEntries(project, task) { return task.entries.map(entryById).filter(entry=>entry && project.instances[entry.moduleId].enabled); }
export function taskCores(project, task) { return [...new Set(taskEntries(project,task).map(entry=>moduleCore(project,entry.moduleId)).filter(Boolean))]; }
export function effectiveScheduleTasks(project) {
  const tasks=project.design.schedule.tasks;
  if(project.instances['app-runtime'].parameters.schedulingAlgorithm!=='rate_monotonic')return tasks;
  const ordered=tasks.filter(task=>task.trigger!=='current').slice().sort((a,b)=>taskFrequency(project,b)-taskFrequency(project,a)||(a.trigger==='control'?-1:b.trigger==='control'?1:0)||a.id.localeCompare(b.id));
  return tasks.map(task=>({...task,priority:task.trigger==='current'?0:ordered.indexOf(task)+1}));
}
export function scheduledTasks(project) {
  return effectiveScheduleTasks(project).map(task=>({...task, frequencyHz:taskFrequency(project,task), entries:taskEntries(project,task), cores:taskCores(project,task)}));
}
export function schedulerTasks(project) {
  const core=moduleCore(project,'app-runtime');
  return scheduledTasks(project).filter(task=>task.trigger!=='current' && task.entries.length && task.cores.length===1 && task.cores[0]===core).sort((a,b)=>a.priority-b.priority);
}
export function validateSchedule(project) {
  const issues=[], add=(id,level,title,message,moduleId='app-runtime')=>issues.push({id:`schedule-${id}`,level,title,message,moduleId});
  try { checkScheduleShape(project.design.schedule); } catch(error) { add('shape','error','任务表格式不合法',error.message); return issues; }
  const tasks=effectiveScheduleTasks(project), ids=new Set(), locations=new Map(), priorities=new Map();
  for (const task of tasks) {
    if (!task.id.trim() || ids.has(task.id)) add(`id-${task.id}`,'error','任务标识重复或为空','每个任务需要独立标识。');
    ids.add(task.id);
    if (!task.name.trim()) add(`name-${task.id}`,'pending','任务名称待填写','请为任务命名。');
    if (task.priority<0 || task.priority>15 || (task.trigger==='current' ? task.priority!==0 : task.priority===0)) add(`priority-${task.id}`,'error','任务优先级无效','电流环为 0；应用任务使用 1–15，数字越小越先派发。');
    if(task.trigger!=='periodic' && task.frequencyHz!==null) add(`source-${task.id}`,'error','任务周期有重复来源','电流环与应用控制周期使用对应配置，不单独保存频率。');
    const entries=taskEntries(project,task), frequency=taskFrequency(project,task), period=1e6/frequency, cores=taskCores(project,task);
    if (entries.length) {
      if (!(frequency>0) || !Number.isFinite(period)) add(`frequency-${task.id}`,'pending',`${task.name}周期待配置`,'设置有效频率后计算任务周期。');
      else if(task.trigger!=='current' && (!Number.isSafeInteger(period) || period>=0x80000000)) add(`period-${task.id}`,'error',`${task.name}周期不适用当前时基`,'应用时基以整数微秒调度，周期必须在 1 至 2,147,483,647 μs 之间。');
      if(cores.length>1) add(`cores-${task.id}`,'error',`${task.name}跨越多个内核`,'一个顺序任务只能在同一内核执行；请分成独立任务并用快照交接。');
      for(const core of cores) {
        const key=`${core}:${task.priority}`;
        if(priorities.has(key))add(`conflict-${task.id}`,'error','同核任务优先级重复',`${task.name}与${priorities.get(key)}需要不同优先级。`);
        priorities.set(key,task.name);
      }
      if(task.budgetUs!==null && (!(task.budgetUs>0) || task.budgetUs>period)) add(`budget-${task.id}`,'error',`${task.name}执行预算无效`,'预算必须大于零且不能超过控制周期。');
    }
    for(const [index,id] of task.entries.entries()) {
      const entry=entryById(id);
      if(!entry || entry.trigger!=='task') {add(`entry-${id}`,'error','任务含无效调用入口','硬件事件和调度器入口不能作为普通周期任务重复派发。');continue;}
      if(locations.has(id))add(`duplicate-${id}`,'error','调用入口被重复安排',`${entry.title}只能安排在一个任务中。`);
      locations.set(id,{task,index});
      if(project.instances[entry.moduleId].enabled && (entry.moduleId.startsWith('foc-') || entry.moduleId==='hw-board') && task.trigger!=='current')add(`domain-${id}`,'error',`${entry.title}需要跟随电流环`,'采样、反馈、观测与电流环当前使用同一控制周期。',entry.moduleId);
      if(entry.moduleId==='app-motion' && task.trigger!=='control')add('motion-domain','error','运动控制需要应用控制任务','应用控制周期由运动控制频率统一配置。','app-motion');
    }
  }
  for(const trigger of ['current','control']) if(tasks.filter(task=>task.trigger===trigger).length!==1)add(`required-${trigger}`,'error','缺少或重复的控制任务','电流环和应用控制任务各保留一个。');
  for(const entry of ENTRYPOINTS.filter(entry=>entry.trigger==='task' && project.instances[entry.moduleId].enabled))if(!locations.has(entry.id))add(`missing-${entry.id}`,'pending',`${entry.title}未安排运行任务`,'为参与编译的模块指定任务，运行期开启时才能被派发。',entry.moduleId);
  const before=(a,b)=>{const from=locations.get(a),to=locations.get(b);if(from && to && from.task===to.task && from.index>=to.index)add(`order-${a}-${b}`,'error','任务内执行顺序冲突',`${entryById(a).title}必须先于${entryById(b).title}。`);};
  for(const [a,b] of [['peripherals.sample','modulation.transform'],['feedback.step','modulation.transform'],['feedback.step','observer.step'],['modulation.transform','current.step'],['control.step','current.step'],['current.step','modulation.update'],['modulation.update','peripherals.apply']])before(a,b);
  for(const link of project.design.layerInterfaces) {
    if(link.handoff!=='call' || !project.instances[link.fromModule]?.enabled || !project.instances[link.toModule]?.enabled)continue;
    const source=project.design.structures.find(s=>s.id===link.sourceStructure),target=project.design.structures.find(s=>s.id===link.targetStructure);
    for(const map of link.fieldMap) {
      const a=source?.fields.find(f=>f.id===map.sourceField)?.name,b=target?.fields.find(f=>f.id===map.targetField)?.name;
      if(!a||!b)continue;
      const start=locations.get(fieldEntry(link.fromModule,'output',a)),end=locations.get(fieldEntry(link.toModule,'input',b));
      if(!start||!end)continue;
      if(start.task!==end.task)add(`handoff-${link.id}`,'error','跨任务连接需要快照或队列',`${link.name}不能按同周期直接传递。`,link.toModule);
      else before(fieldEntry(link.fromModule,'output',a),fieldEntry(link.toModule,'input',b));
    }
  }
  const control=tasks.find(task=>task.trigger==='control');
  if(control)for(const task of tasks)if(task.trigger==='periodic' && taskEntries(project,task).length && taskCores(project,task).some(core=>taskCores(project,control).includes(core)) && task.priority<=control.priority)add(`control-priority-${task.id}`,'error','应用控制任务应最先派发','同核的其他应用任务应低于应用控制任务优先级。');
  return [...new Map(issues.map(issue=>[issue.id,issue])).values()];
}

export function moveScheduleEntry(schedule, id, destination, offset=0) {
  const source=schedule.tasks.find(task=>task.entries.includes(id)),target=schedule.tasks.find(task=>task.id===destination);
  if(!source||!target)throw Error('任务或调用入口不存在。');
  const index=source.entries.indexOf(id);
  if(source===target){const next=index+offset;if(next>=0&&next<source.entries.length)[source.entries[index],source.entries[next]]=[source.entries[next],source.entries[index]];}
  else {source.entries.splice(index,1);target.entries.push(id);}
}
