import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNeo75hMinimalProject} from '../web/src/profiles/neo75h-minimal.mjs';
import {inspectFirmwareSupport,generateFirmware} from '../native/firmware.mjs';
import {parseProject,serializeProject} from '../web/src/core/model.mjs';

test('minimal NEO selects speed and only direction/electrical offset calibration',()=>{
  const p=parseProject(serializeProject(createNeo75hMinimalProject()));
  assert.deepEqual(inspectFirmwareSupport(p).sourceIssues,[]);
  assert.deepEqual(p.instances['app-calibration'].parameters.procedures,['electrical_zero']);
  assert.deepEqual(p.instances['app-calibration'].parameters.enabledProcedures,['electrical_zero']);
  assert.equal(p.instances['app-motion'].parameters.activeMode,'speed');
  for(const id of ['app-comms','foc-observer','foc-compensation'])assert.equal(p.instances[id].enabled,false);
  for(const key of ['outputEncoderCapability','torqueCapability','gateDriverCapability'])assert.equal(p.instances['hw-drivers'].parameters[key],'absent');
  assert.equal(p.instances['hw-drivers'].parameters.motorEncoderDirection,'calibration');
  assert(Object.values(p.execution.assignments).every(core=>core==='cm7'));
  p.instances['app-calibration'].parameters.procedures.push('motor_encoder_nonlinear');
  assert.equal(inspectFirmwareSupport(p).sourceReady,false);
});
test('generated speed and direction/offset code handles reversal, blockage, invalid feedback and cancel',async t=>{
  const outputRoot=await mkdtemp(join(tmpdir(),'neo-minimal-'));t.after(()=>rm(outputRoot,{recursive:true,force:true}));
  const job=await generateFirmware({project:createNeo75hMinimalProject(),outputRoot});
  const sources=job.manifest.generatedFiles.filter(f=>f.kind==='c'&&['app-motion','app-calibration'].includes(f.moduleId)).map(f=>f.path);
  const includes=[join(job.root,'include'),...sources.map(dirname)];
  const output=join(job.root,process.platform==='win32'?'runtime.exe':'runtime');
  const sanitizer=process.platform==='win32'?[]:['-fsanitize=address,undefined'];
  execFileSync(process.env.CC||(process.platform==='win32'?'gcc':'cc'),['-std=c11','-Wall','-Wextra','-Werror','-fno-fast-math',...sanitizer,...includes.flatMap(p=>['-I',p]),...sources,fileURLToPath(new URL('./neo-minimal-runtime.c',import.meta.url)),'-lm','-o',output],{encoding:'utf8'});
  assert.match(execFileSync(output,[],{encoding:'utf8'}),/minimal speed and calibration passed/);
});
test('target assembly calibrates both encoder directions and runs/reverses speed on a motor plant',async t=>{
  const outputRoot=await mkdtemp(join(tmpdir(),'neo-assembly-'));t.after(()=>rm(outputRoot,{recursive:true,force:true}));
  const job=await generateFirmware({project:createNeo75hMinimalProject(),outputRoot});
  const sources=job.manifest.generatedFiles.filter(f=>f.kind==='c').map(f=>f.path);
  const target=fileURLToPath(new URL('../native/targets/neo-minimal/',import.meta.url));
  const includes=[target,join(job.root,'include'),...sources.map(dirname)];
  const output=join(job.root,process.platform==='win32'?'assembly.exe':'assembly');
  const sanitizer=process.platform==='win32'?[]:['-fsanitize=address,undefined'];
  execFileSync(process.env.CC||(process.platform==='win32'?'gcc':'cc'),['-std=c11','-O2','-Wall','-Wextra','-Werror','-fno-fast-math','-DNEO_HOST_TEST',...sanitizer,...includes.flatMap(p=>['-I',p]),...sources,join(target,'main.c'),fileURLToPath(new URL('./neo-assembly-runtime.c',import.meta.url)),'-lm','-o',output],{encoding:'utf8'});
  for(const direction of ['+','-'])assert.match(execFileSync(output,[direction],{encoding:'utf8'}),/target assembly plant, interlocks and encoder dropout passed/);
});
