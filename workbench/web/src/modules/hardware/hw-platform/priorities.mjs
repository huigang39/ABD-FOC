import { identifyMcu } from './targets.mjs';
export const INTERRUPT_LEVELS = [
 {value:'emergency',label:'紧急'},{value:'realtime',label:'实时'},
 {value:'high',label:'高'},{value:'normal',label:'普通'},{value:'background',label:'后台'},
];
/** Unshifted NVIC priorities. All implemented bits must be preemption bits. */
export function interruptPriorityMapping(mcu) {
 const family=identifyMcu(mcu);
 if(family?.prefix!=='STM32H745')return null;
 return {controller:'NVIC',priorityBits:4,preemptionBits:4,subpriorityBits:0,
  levels:Object.fromEntries(INTERRUPT_LEVELS.map((level,index)=>[level.value,Math.floor(index*15/4)]))};
}
export function resolveInterruptPriority(mcu,level) {
 const mapping=interruptPriorityMapping(mcu);
 return mapping && Object.hasOwn(mapping.levels,level)?mapping.levels[level]:null;
}
