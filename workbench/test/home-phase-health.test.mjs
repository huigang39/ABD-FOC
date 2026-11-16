import test from 'node:test';
import assert from 'node:assert/strict';
import {getPhaseHealth} from '../web/src/features/architecture/phase-health.mjs';

const project={id:'project-a'};
const packet={source:'device',connected:true,projectId:'project-a',observedAt:2000,phases:{U:{status:'missing',message:'U 相开路'},V:{status:'ok'},W:{status:'warning',message:'采样异常'}}};
test('fresh explicit per-phase diagnostics identify the affected wire only',()=>{
  assert.deepEqual(getPhaseHealth(project,'u',packet,2100),{state:'error',label:'缺相',message:'U 相开路'});
  assert.equal(getPhaseHealth(project,'v',packet,2100).state,'ok');
  assert.equal(getPhaseHealth(project,'w',packet,2100).state,'warning');
});
test('missing, stale, disconnected or other-project measurements never imply healthy phases',()=>{
  for(const data of [null,{}, {...packet,connected:false},{...packet,projectId:'other'}, {...packet,observedAt:999},{...packet,observedAt:2500},{...packet,source:'configuration'}, {...packet,phases:{U:{current:0}}}]) {
    assert.equal(getPhaseHealth(project,'U',data,2100).state,'unknown');
  }
});
