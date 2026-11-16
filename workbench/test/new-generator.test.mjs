import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODULES} from '../web/src/core/catalog.mjs';
import {newModuleProject} from './support/new-project.mjs';
import {inspectFirmwareSupport,generateFirmware,buildFirmware} from '../native/firmware.mjs';
import {renderDrivers,driverConfigurationIssues} from '../native/generator/drivers.mjs';
import {checkRuntimeLayout} from '../native/generator/contracts.mjs';
import {configurationFingerprint} from '../web/src/core/contracts.mjs';
async function fixture(t){const outputRoot=await mkdtemp(join(tmpdir(),'abd-new-generator-'));t.after(()=>rm(outputRoot,{recursive:true,force:true}));const project=newModuleProject();const job=await generateFirmware({project,outputRoot});return {outputRoot,project,job};}
test('implemented modules own concrete layouts while filters keep their unsupported boundary explicit',()=>{
  const p=newModuleProject();for(const m of MODULES.filter(module=>module.id!=='foc-filter')){assert.deepEqual(checkRuntimeLayout(p,m),[]);for(const role of ['input','output','state'])assert(m.contracts[role].fields.length>0);}
  assert.ok(checkRuntimeLayout(p,MODULES.find(module=>module.id==='foc-filter')).some(message=>message.includes('FilterState')));
  assert.equal(p.instances['foc-filter'].enabled,false);
  const r=inspectFirmwareSupport(p);assert.equal(r.sourceReady,true);assert.equal(r.supported,false);assert(r.integrationIssues.some(i=>i.code==='platform-port'));
  p.design.structures.find(s=>s.id===p.design.moduleContracts['hw-drivers'].input).fields=[];
  assert(inspectFirmwareSupport(p).sourceIssues.some(i=>i.code==='contracts'));assert.equal(inspectFirmwareSupport(p).sourceReady,false);
});
test('new generator emits exactly one C/header pair per included module, no imported runtime or device branches',async t=>{
  const {job,project}=await fixture(t);assert.equal(job.manifest.generatedFiles.length,30);assert.equal(job.manifest.firmwareReady,false);
  assert.equal(job.manifest.projectFingerprint,configurationFingerprint(project));
  for(const m of MODULES.filter(m=>project.instances[m.id].enabled))assert.deepEqual(job.manifest.generatedFiles.filter(f=>f.moduleId===m.id).map(f=>f.kind).sort(),['c','h']);
  for(const f of job.manifest.generatedFiles){const text=await readFile(f.path,'utf8');assert.doesNotMatch(text,/\bg_mc\b|\bstruct mc\b|neofsa|gw_init|kw_init|MC_ENCODER|\b(?:[Aa]bd_|ABD_|Abd[A-Z])/);}
  assert.deepEqual(await readdir(join(job.root,'include')),['math_utils.h']);
  assert.deepEqual((await readdir(job.root)).sort(),['README.txt','build-manifest.json','execution-plan.json','firmware','include','manifest.json','module-contracts.json','project.json','runtime-config.json','tools']);
  await assert.rejects(buildFirmware({project,jobId:job.id,outputRoot:dirname(job.root)}),/可烧录镜像/);
});
test('compiler exclusion removes the module, runtime exclusion retains independently configurable code',async t=>{
  const outputRoot=await mkdtemp(join(tmpdir(),'abd-module-switch-'));t.after(()=>rm(outputRoot,{recursive:true,force:true}));const p=newModuleProject();
  p.instances['foc-observer'].enabled=false;p.instances['foc-observer'].runtimeEnabled=false;p.instances['foc-compensation'].runtimeEnabled=false;
  const job=await generateFirmware({project:p,outputRoot});assert(!job.manifest.generatedFiles.some(f=>f.moduleId==='foc-observer'));
  const header=job.manifest.generatedFiles.find(f=>f.moduleId==='foc-compensation'&&f.kind==='h');assert.match(await readFile(header.path,'utf8'),/FRICTION_RUNTIME_DEFAULT false/);
});
test('device manufacturer and model names do not select or alter generated protocol implementation',()=>{
  const p=newModuleProject(),a=renderDrivers(p);p.instances['hw-drivers'].parameters.motorEncoderVendor='other';p.instances['hw-drivers'].parameters.motorEncoderModel='Arbitrary Encoder';p.instances['hw-drivers'].parameters.torqueSensorModel='My Sensor';
  assert.deepEqual(renderDrivers(p),a);
});
test('discrete gates report their missing adapter instead of demanding stale serial settings',()=>{
  for(const communication of [
    {gateDriverInterface:'unselected',gateDriverResource:'',gateDriverTimeoutUs:null,gateDriverCommands:[]},
    {gateDriverInterface:'spi',gateDriverResource:'old-spi',gateDriverTimeoutUs:500,gateDriverCommands:[{purpose:'data',frameBytes:1,dataOffset:10}]},
  ]) {
    const project=newModuleProject(),parameters=project.instances['hw-drivers'].parameters;
    Object.assign(parameters,communication,{gateDriverCapability:'present',gateDriverModel:'discrete',gateDriverEnablePin:'PE1',gateDriverEnableLevel:'low'});
    const before=structuredClone(parameters),problems=driverConfigurationIssues(parameters);
    assert.deepEqual(problems.map(problem=>problem.paramKey),['gateDriverModel']);
    assert.match(problems[0].message,/分立门极驱动.*适配尚未实现/);
    assert.doesNotMatch(problems[0].message,/数据有效期|主数据指令|串行/);
    assert.throws(()=>renderDrivers(project),/分立门极驱动.*适配尚未实现/);
    const inspection=inspectFirmwareSupport(project);
    assert.equal(inspection.sourceReady,false);
    assert.equal(inspection.supported,false);
    assert(inspection.integrationIssues.some(problem=>problem.code==='platform-port'));
    assert.deepEqual(parameters,before);
    parameters.gateDriverCapability='absent';
    assert.deepEqual(driverConfigurationIssues(parameters),[]);
  }
});

test('generated C runs with address/undefined behavior sanitizers across driver and module scenarios',async t=>{
  const {job}=await fixture(t);const sources=job.manifest.generatedFiles.filter(f=>f.kind==='c').map(f=>f.path);const includes=[join(job.root,'include'),...new Set(sources.map(dirname))];
  for(const name of ['driver-runtime','module-runtime']){
    const output=join(job.root,name);const testSource=fileURLToPath(new URL(`./${name}.c`,import.meta.url));
    execFileSync(process.env.CC||'cc',['-std=c11','-Wall','-Wextra','-Werror','-fno-fast-math','-fsanitize=address,undefined',...includes.flatMap(dir=>['-I',dir]),...sources,testSource,'-lm','-o',output],{encoding:'utf8'});
    assert.match(execFileSync(output,[],{encoding:'utf8'}),/passed/);
  }
});
