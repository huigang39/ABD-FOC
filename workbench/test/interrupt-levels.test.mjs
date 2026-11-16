import test from 'node:test';
import assert from 'node:assert/strict';
import {INTERRUPT_LEVELS,interruptPriorityMapping,resolveInterruptPriority} from '../web/src/modules/hardware/hw-platform/priorities.mjs';
import {createCoreConfigs,checkCoreConfigShape,coreFields} from '../web/src/modules/hardware/hw-platform/cores.mjs';
import {createTripPath,checkTripShape} from '../web/src/modules/hardware/hw-safety/paths.mjs';
test('logical priority levels map to distinct H745 NVIC priorities',()=>{
 const values=INTERRUPT_LEVELS.map(level=>resolveInterruptPriority('STM32H745IIK6',level.value));
 assert.deepEqual(values,[0,3,7,11,15]);
 assert.equal(interruptPriorityMapping('STM32H745').subpriorityBits,0);
 assert.equal(resolveInterruptPriority('HPM5361','realtime'),null);
 assert.equal(resolveInterruptPriority('STM32H745','invalid'),null);
});
test('core and fault input defaults use named levels',()=>{
 const configs=createCoreConfigs('STM32H745');
 checkCoreConfigShape(configs);
 assert.equal(configs.cm7.controlIrqPriority,'realtime');
 assert.equal(configs.cm4.communicationIrqPriority,null);
 const path=createTripPath();assert.equal(path.priority,'emergency');checkTripShape([path]);
 path.priority=2;assert.throws(()=>checkTripShape([path]));
});
