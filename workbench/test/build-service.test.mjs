import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createBuildService } from '../build-service/service.mjs';
import { createBuildHttpHandler } from '../build-service/http.mjs';
import { deliverFirmware } from '../build-service/delivery.mjs';
import { encodeIntelHex } from '../build-service/intel-hex.mjs';
import { decodeHex } from './support/intel-hex.mjs';
import { publicIssues } from '../build-service/errors.mjs';
import * as realFirmware from '../native/firmware.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { newModuleProject } from './support/new-project.mjs';
import { createPerformanceDraft, createPerformanceRecord } from '../web/src/features/performance/model.mjs';

const authorization = {authenticatedRole:'developer',environment:'development'};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => {let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

// Artificial BIN bytes exercise transport/packaging only; they are not firmware.
async function fixture(t, overrides = {}) {
  const outputRoot=await mkdtemp(join(tmpdir(),'build-service-'));
  t.after(()=>rm(outputRoot,{recursive:true,force:true}));
  const calls=[],records=[],project=newModuleProject();
  const firmware={
    inspectFirmwareSupport:async p=>{calls.push('inspect');assert.equal(p.performance,undefined);return {supported:true,issues:[]};},
    generateFirmware:async({project:p})=>{
      calls.push('generate');const id=randomUUID(),root=join(outputRoot,id);await mkdir(root);
      await writeFile(join(root,'private.c'),'private implementation');
      await writeFile(join(root,'private.elf'),'private symbols');
      return {id,root,manifest:{template:'abd-modular-v1',firmwareReady:false,mcu:p.target.mcu,projectFingerprint:configurationFingerprint(p)}};
    },
    buildFirmware:async({project:p,jobId,onProgress})=>{
      calls.push('compile');onProgress('private compiler /server/source/current.c');
      const root=join(outputRoot,jobId),artifacts=[];
      for(const [core,address] of [['cm7',0x08000000],['cm4',0x08100000]]){
        const bytes=Buffer.from(`fixture-image-${core}`),path=join(root,`${core}.bin`);await writeFile(path,bytes);
        artifacts.push({kind:'bin',core,path,loadAddress:address,size:bytes.length,sha256:hash(bytes)});
      }
      return {status:'built',root,artifacts,manifest:{template:'abd-modular-v1',artifactKind:'firmware',firmwareReady:true,mcu:p.target.mcu,projectFingerprint:configurationFingerprint(p),generatedFiles:[{path:join(root,'private.c')}],privateParameter:'secret'}};
    },
    ...overrides,
  };
  const service=createBuildService({firmware,outputRoot,onPrivateResult:record=>records.push(record)});
  return {service,firmware,project,outputRoot,calls,records};
}

async function httpFixture(t, options={}) {
  const f=await fixture(t,options.firmware),handler=createBuildHttpHandler({service:f.service,authenticate:async req=>req.headers.authorization==='Bearer fixture-token'?(options.authorization || authorization):null});
  const server=createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`http://127.0.0.1:${server.address().port}`;
  return {...f,url,post:(value=f.project,headers={})=>fetch(url+'/v1/build',{method:'POST',headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json',...headers},body:JSON.stringify(value)})};
}

test('one configuration JSON returns a single HEX containing exactly both core images at their Flash addresses',async t=>{
  const f=await httpFixture(t),draft=createPerformanceDraft(f.project);
  draft.measuredAt='2026-11-15T10:00:00+08:00';draft.firmwareId='fixture-only';draft.conditions.notes='bench measurement';
  draft.samples=[{currentA:0,torqueNm:0,series:''}];
  f.project.performance={records:[createPerformanceRecord(f.project,draft)]};
  const before=structuredClone(f.project),response=await f.post();assert.equal(response.status,200);
  assert.deepEqual(f.calls,['inspect','generate','compile']);assert.deepEqual(f.project,before);
  assert.equal(response.headers.get('Content-Type'),'application/octet-stream');
  assert.equal(response.headers.get('X-Firmware-Format'),'intel-hex');
  assert.match(response.headers.get('Content-Disposition'),/\.hex"$/);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),response.headers.get('X-Firmware-SHA256'));
  assert.equal(response.headers.get('X-Configuration-Fingerprint'),configurationFingerprint(f.project));
  const decoded=decodeHex(bytes.toString('ascii'));
  const manifest=f.records[0].delivery;
  assert.equal(manifest.buildId,response.headers.get('X-Build-Id'));assert.equal(manifest.fingerprint,configurationFingerprint(f.project));
  assert.deepEqual(manifest.images.map(i=>[i.core,i.address]),[['cm7',0x08000000],['cm4',0x08100000]]);
  assert.equal(decoded.size,manifest.images.reduce((sum,image)=>sum+image.size,0));
  for(const image of manifest.images){
    const data=Buffer.from(Array.from({length:image.size},(_,offset)=>decoded.get(image.address+offset)));
    assert.equal(image.sha256,hash(data));assert.equal(data.toString(),`fixture-image-${image.core}`);
  }
  assert.equal(manifest.encrypted,false);assert.equal(manifest.signed,false);
  assert.doesNotMatch(bytes.toString(),/private|source|\.elf|\.map|bench measurement|compiler/);
  assert.match(f.records[0].log.join('\n'),/private compiler/);
  assert.equal(f.records[0].status,'built');
  for(const path of ['/session','/jobs','/artifacts','/private.c','/api/firmware/generate'])assert.equal((await fetch(f.url+path)).status,404);
});

test('server rejects invalid configuration without trusting client checks and does not invoke compiler',async t=>{
  const f=await httpFixture(t);f.project.instances['foc-current'].parameters.bandwidthHz=-1;
  const response=await f.post(),body=await response.json();assert.equal(response.status,422);
  assert.equal(body.error.code,'CONFIGURATION_REJECTED');assert(body.issues.some(i=>i.moduleId==='foc-current'));
  assert(!f.calls.includes('generate'));assert(!f.calls.includes('compile'));
  assert.equal(body.fingerprint,configurationFingerprint(f.project));
  const malformed=await f.post({project:f.project});assert.equal(malformed.status,400);
});

test('current real backend reports missing target integration and never disguises module libraries as firmware',async t=>{
  const f=await fixture(t,realFirmware);
  await assert.rejects(f.service.build(f.project,{authorization}),error=>error.code==='CONFIGURATION_REJECTED'&&error.issues.some(i=>i.code==='platform-port'));
  assert.equal(f.records[0].status,'failed');assert.equal(f.records[0].result,undefined);
});

test('compiler diagnostics remain private, stage/request id cross the boundary and the service unlocks',async t=>{
  const f=await httpFixture(t,{firmware:{buildFirmware:async()=>{throw Error('/private/server/secret.c: private generated implementation');}}});
  const response=await f.post(),body=await response.json();assert.equal(response.status,500);
  assert.equal(body.error.stage,'compilation');assert.equal(body.error.code,'BUILD_FAILED');assert.match(body.requestId,/^[\da-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(body),/private|secret\.c|implementation|stack/);
  assert.match(f.records[0].log.join('\n'),/private\/server/);assert.equal(f.service.busy,false);
  assert.equal((await f.post()).status,500);
});

test('production role and encryption policy are server-owned; no plaintext downgrade when encryption is unavailable',async t=>{
  const f=await httpFixture(t,{authorization:{authenticatedRole:'end-user',environment:'production'}});
  let response=await f.post();assert.equal(response.status,403);assert.equal((await response.json()).error.code,'ENCRYPTION_REQUIRED');
  f.project.build.encryptFirmware=true;response=await f.post();assert.equal(response.status,501);assert.equal((await response.json()).error.code,'ENCRYPTION_NOT_IMPLEMENTED');
  assert.deepEqual(f.calls,[]);
});

test('HTTP auth, method, MIME, JSON and request size fail before any generation',async t=>{
  const f=await httpFixture(t);
  assert.equal((await f.post(f.project,{Authorization:'Bearer wrong'})).status,401);
  const get=await fetch(f.url+'/v1/build');assert.equal(get.status,405);assert.equal(get.headers.get('Allow'),'POST');
  assert.equal((await f.post(f.project,{'Content-Type':'text/plain'})).status,415);
  const post=body=>fetch(f.url+'/v1/build',{method:'POST',headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json'},body});
  assert.equal((await post('{broken')).status,400);
  const oversized=await post(JSON.stringify({data:'x'.repeat(2*1024*1024)}));assert.equal(oversized.status,413);
  assert.deepEqual(f.calls,[]);
});

test('concurrent builds receive retry status and immutable snapshot survives changes to caller objects',async t=>{
  const gate=deferred(),entered=deferred();let seen;
  const f=await fixture(t,{inspectFirmwareSupport:async p=>{seen=p;entered.resolve();await gate.promise;return {supported:false,issues:[{level:'error',message:'target incomplete'}]};}});
  const request=f.service.build(f.project,{authorization});await entered.promise;
  const original=f.project.build.optimization;f.project.build.optimization='O3';
  await assert.rejects(f.service.build(f.project,{authorization}),{code:'BUILD_BUSY',status:429});
  assert.equal(seen.build.optimization,original);gate.resolve();await assert.rejects(request,{code:'CONFIGURATION_REJECTED'});
  assert.equal(f.service.busy,false);
});

test('request cancellation between stages stops compilation and releases the build slot',async t=>{
  const abort=new AbortController();const f=await fixture(t,{generateFirmware:async()=>{abort.abort();return {id:'cancelled'};}});
  await assert.rejects(f.service.build(f.project,{authorization,signal:abort.signal}),{code:'REQUEST_CANCELLED'});
  assert(!f.calls.includes('compile'));assert.equal(f.service.busy,false);
});

test('only configuration diagnostics are exposed, with editor paths and bounded fields',()=>{
  const [issue]=publicIssues([{moduleId:'foc-current',paramKey:'bandwidthHz',message:'check bandwidth',source:'/private/current.c',stack:'private',code:'range'}]);
  assert.equal(issue.path,'instances.foc-current.parameters.bandwidthHz');assert(!Object.hasOwn(issue,'source'));assert(!Object.hasOwn(issue,'stack'));
  assert.equal(publicIssues(Array.from({length:250},()=>({message:'x'}))).length,200);
});

test('packaging refuses non-firmware, mismatched targets, corrupt bytes, missing cores and invalid Flash ranges',async t=>{
  const f=await fixture(t);delete f.project.performance;
  const generated=await f.firmware.generateFirmware({project:f.project});
  const result=await f.firmware.buildFirmware({project:f.project,jobId:generated.id,onProgress:()=>{}});
  const args={project:f.project,outputRoot:f.outputRoot,buildId:randomUUID(),fingerprint:configurationFingerprint(f.project)};
  for(const change of [
    r=>{r.manifest.artifactKind='module-library';},r=>{r.manifest.firmwareReady=false;},r=>{r.status='failed';},
    r=>{r.manifest.projectFingerprint='wrong';},r=>{r.manifest.mcu='STM32G474RE';},
    r=>{r.artifacts.pop();},r=>{r.artifacts[1].core='cm7';},r=>{r.artifacts[0].sha256='0'.repeat(64);},r=>{r.artifacts[0].size++;},
    r=>{r.artifacts[0].loadAddress=0x081a0000;},r=>{r.artifacts[0].loadAddress=0x081c0000;},r=>{r.artifacts[0].loadAddress=0x081e0000;},
    r=>{r.artifacts[0].loadAddress=0x20000000;},r=>{r.artifacts[0].loadAddress++;},r=>{r.artifacts[1].loadAddress=r.artifacts[0].loadAddress;},
  ]){const altered=structuredClone(result);change(altered);await assert.rejects(deliverFirmware({...args,result:altered}),{code:'INVALID_FIRMWARE'});}
  const escaped=join(f.outputRoot,'outside.bin');await writeFile(escaped,await readFile(result.artifacts[0].path));
  const link=join(result.root,'escape.bin');await symlink(escaped,link);
  const altered=structuredClone(result);altered.artifacts[0].path=link;
  await assert.rejects(deliverFirmware({...args,result:altered}),{code:'INVALID_FIRMWARE'});
});

test('HEX preserves sparse segments, 64 KiB boundaries and top-of-address-space bytes without filler',()=>{
  const segments=[{address:0x08100000,data:Buffer.from([4,5,6])},{address:0x0800fff8,data:Buffer.from(Array.from({length:24},(_,i)=>i))},{address:0xfffffffe,data:Buffer.from([0x81,0xfe])}];
  const hex=encodeIntelHex(segments).toString('ascii'),memory=decodeHex(hex);
  assert.equal(memory.size,29);
  for(const {address,data} of segments)for(let i=0;i<data.length;i++)assert.equal(memory.get(address+i),data[i]);
  assert.equal(memory.has(0x08010010),false);assert.equal(hex.match(/:00000001FF/g).length,1);
  assert.match(hex,/:020000040800F2/);assert.match(hex,/:020000040801F1/);assert.match(hex,/:020000040810E2/);
  assert.throws(()=>encodeIntelHex([{address:0xffffffff,data:Buffer.from([1,2])}]));
  assert.throws(()=>encodeIntelHex([{address:16,data:Buffer.from([1,2])},{address:17,data:Buffer.from([3])}]));
  assert.throws(()=>encodeIntelHex([]));
});

test('GNU Arm objcopy reads the delivered HEX and recovers both cores at their original addresses',async t=>{
  let prefix;try{prefix=realFirmware.findFirmwareToolchain();}catch{t.skip('GNU Arm toolchain unavailable');return;}
  const f=await fixture(t),{delivery}=await f.service.build(f.project,{authorization});
  const hex=join(f.outputRoot,'combined.hex'),bin=join(f.outputRoot,'combined.bin');await writeFile(hex,delivery.bytes);
  execFileSync(prefix+'objcopy',['-I','ihex','-O','binary',hex,bin]);
  const data=await readFile(bin);
  assert.equal(data.subarray(0,17).toString(),'fixture-image-cm7');
  assert.equal(data.subarray(0x100000).toString(),'fixture-image-cm4');
});
