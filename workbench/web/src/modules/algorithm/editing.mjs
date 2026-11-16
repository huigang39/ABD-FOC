import { addAlgorithmChild, fixedAlgorithmChildren, checkAlgorithmChildren } from './children.mjs';

/** Edits use stable instance IDs. Opening an editor never includes a function. */
export function updateAlgorithmChild(project, moduleId, childId, key, value) {
  let next = structuredClone(project);
  const correction = moduleId === 'foc-compensation' && ['current_calibration', 'angle_delay'].includes(childId);
  let child = fixedAlgorithmChildren(next, moduleId).find(item => item.id === childId);
  if (!child) throw Error('算法实例不存在。');
  if (!['compiled', 'enabled', 'name'].includes(key) && !Object.hasOwn(child.parameters, key)) throw Error('算法参数不存在。');
  if (correction && !child.compiled) next = addAlgorithmChild(next, moduleId, childId);
  const children = fixedAlgorithmChildren(next, moduleId);
  child = children.find(item => item.id === childId);
  if (correction && !['compiled', 'enabled'].includes(key)) {
    const instance = next.instances[moduleId];
    if (!instance.enabled || !instance.runtimeEnabled) for (const other of children) other.enabled = false;
    child.compiled = true;
    child.enabled = true;
    instance.enabled = true;
    instance.runtimeEnabled = true;
  }
  if (['compiled', 'enabled'].includes(key)) {
    child[key] = value === true;
    if (key === 'compiled' && !child.compiled) child.enabled = false;
  } else if (key === 'name') child.name = String(value).slice(0, 120);
  else if (Object.hasOwn(child.parameters, key)) child.parameters[key] = value;
  else throw Error('算法参数不存在。');
  if (child.type === 'angle_delay' && key === 'delayCycles') child.parameters.delayUs = null;
  next.instances[moduleId].parameters.children = children;
  return next;
}

/** Empty names restore the derived display name; the signal identity never changes. */
export function updateAlgorithmOutputName(project,moduleId,childId,port,value) {
 if(typeof value!=='string'||value.length>120)throw Error('输出名称应是不超过 120 个字符的文本。');
 const next=structuredClone(project),children=fixedAlgorithmChildren(next,moduleId),child=children.find(item=>item.id===childId);
 if(!child)throw Error('算法实例不存在。');
 child.outputNames={...child.outputNames,[port]:value};
 checkAlgorithmChildren(children,moduleId);
 next.instances[moduleId].parameters.children=children;
 return next;
}
