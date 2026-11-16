import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configurationFingerprint} from '../web/src/core/contracts.mjs';
import {createPerformanceDraft,savePerformanceRecord,removePerformanceRecord} from '../web/src/features/performance/model.mjs';
import {generateFirmware,buildFirmware} from '../native/firmware.mjs';
import {newModuleProject} from './support/new-project.mjs';
function measuredProject(p=newModuleProject()){const draft=createPerformanceDraft(p);Object.assign(draft,{measuredAt:'2026-11-15T12:00:00Z',samples:[{currentA:1,torqueNm:8.2,series:'正向'}]});return savePerformanceRecord(p,draft);}
async function fixture(t,p=newModuleProject()){const outputRoot=await mkdtemp(join(tmpdir(),'abd-fingerprint-'));t.after(()=>rm(outputRoot,{recursive:true,force:true}));return {outputRoot,job:await generateFirmware({project:p,outputRoot})};}
test('generated build spec and manifest share the actual configuration fingerprint',async t=>{
  const p=newModuleProject(),{outputRoot,job}=await fixture(t,p);
  const spec=JSON.parse(await readFile(join(job.root,'build-manifest.json'),'utf8'));
  assert.equal(spec.projectFingerprint,configurationFingerprint(p));assert.equal(job.manifest.projectFingerprint,spec.projectFingerprint);
  const changed=measuredProject(p);changed.revision+=1;changed.updatedAt='2026-11-16T01:00:00Z';
  const next=await generateFirmware({project:changed,outputRoot});assert.equal(next.manifest.projectFingerprint,job.manifest.projectFingerprint);
});
test('measurement edits and metadata do not invalidate generated module code; integration still gates firmware',async t=>{
  const initial=measuredProject(),{outputRoot,job}=await fixture(t,initial);
  const changed=structuredClone(initial);changed.performance.records[0].samples[0].torqueNm=7.8;
  const metadata=structuredClone(initial);metadata.revision+=3;metadata.name='重新命名';
  for(const p of [measuredProject(initial),changed,removePerformanceRecord(initial,initial.performance.records[0].id),metadata]){
    assert.equal(configurationFingerprint(p),job.manifest.projectFingerprint);
    await assert.rejects(buildFirmware({project:p,jobId:job.id,outputRoot}),e=>/可烧录镜像/.test(e.message)&&!/配置在代码生成后已改变/.test(e.message));
  }
});
test('control, component, optimization and deployment changes invalidate generated code',async t=>{
  const p=newModuleProject(),{outputRoot,job}=await fixture(t,p);
  for(const mutate of [n=>n.instances['foc-current'].parameters.bandwidthHz+=100,n=>n.instances['hw-board'].parameters.pwmHz+=1000,n=>n.catalog.actuators[0].motor.polePairs+=1,n=>n.build.moduleOptimizations['foc-current']='O3',n=>n.execution.assignments['foc-current']='cm4']){
    const changed=structuredClone(p);mutate(changed);await assert.rejects(buildFirmware({project:changed,jobId:job.id,outputRoot}),/配置在代码生成后已改变/);
  }
});
