import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES} from '../web/src/core/catalog.mjs';
import {createNeo75hProject} from '../web/src/profiles/neo75h.mjs';
import {CONTRACTS as scheduler} from '../web/src/modules/application/app-runtime/contracts.mjs';
import {CONTRACTS as state} from '../web/src/modules/application/app-state/contracts.mjs';
import {getCia402Design} from '../web/src/modules/application/app-state/cia402.mjs';
import {runtimeConfiguration} from '../web/src/features/configuration/runtime-config.mjs';
test('application responsibilities and state parameters are separate',()=>{
 assert.deepEqual(MODULES.filter(m=>m.layer==='app').sort((a,b)=>a.order-b.order).map(m=>m.title),['调度器','状态机','控制环路','通信','校准','备份','异常']);
 const p=createNeo75hProject();assert.equal(p.instances['app-runtime'].parameters.stateMachine,undefined);assert.equal(getCia402Design(p).enabled,true);
 assert.deepEqual(scheduler.input.fields.map(f=>f.name),['now_us']);assert.ok(!scheduler.output.fields.some(f=>f.name==='run_permitted'));
 assert.ok(state.output.fields.some(f=>f.name==='run_permitted'));
 assert.ok(runtimeConfiguration(p).entries.some(e=>e.moduleId==='app-state'));
});
