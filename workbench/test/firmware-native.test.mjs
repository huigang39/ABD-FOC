import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { inspectFirmwareSupport, buildFirmware } from '../native/firmware.mjs';
import { parseProject } from '../web/src/core/model.mjs';
import { newModuleProject } from './support/new-project.mjs';
import { getActiveActuator } from '../web/src/features/equipment/model.mjs';

test('NEO configuration stays importable but incomplete new implementations cannot produce firmware', () => {
  const p=parseProject(readFileSync(new URL('../projects/NEO_75_H_GW_KW.json',import.meta.url),'utf8'));
  const report=inspectFirmwareSupport(p);
  assert.equal(report.supported,false); assert.equal(report.sourceReady,false);
  assert(report.sourceIssues.some(i=>i.code==='implementation'));
  for(const code of ['platform-port','runtime-assembly','storage-port','transport-port'])assert(report.integrationIssues.some(i=>i.code===code));
});
test('RAM/FLASH choices remain blocked until linker and startup adapters exist', () => {
  const p=newModuleProject();
  p.memory.ram={mcu:p.target.mcu,banks:[],placements:[]};
  const report=inspectFirmwareSupport(p);
  assert.equal(report.supported,false);
  assert(report.integrationIssues.some(i=>i.code==='platform-port'));
  assert(report.integrationIssues.some(i=>i.code==='storage-port'));
});
test('device variants contain byte descriptors, not imported source profiles', () => {
  for(const variant of ['KW','LD','SMH']) {
    const report=inspectFirmwareSupport(createNeo75hProject(variant));
    assert.equal(report.profile,`NEO_75_H_GW_${variant}`);
    assert.equal(report.template,'abd-modular-v1');
    assert.equal(Object.hasOwn(report,'sourceProfile'),false);
    assert.equal(Object.hasOwn(report,'sourceRoot'),false);
  }
});
test('current bandwidth and actuator parameters drive the new C config', () => {
  const p=newModuleProject();p.instances['foc-current'].parameters.bandwidthHz=800;
  const a=getActiveActuator(p);a.motor.polePairs=13;
  const report=inspectFirmwareSupport(p);
  assert.deepEqual(report.sourceIssues,[]);
  assert.equal(Object.hasOwn(p.instances['foc-feedback'].parameters,'polePairs'),false);
  assert.equal(report.parameters['foc-feedback.pole_pairs'],13);
  assert.deepEqual(report.parameters['foc-current.kp'],[2*Math.PI*800*a.motor.inductanceDH,2*Math.PI*800*a.motor.inductanceQH]);
  assert.equal(report.parameters['foc-current.ki'],2*Math.PI*800*a.motor.resistanceOhm);
});
test('structure descriptions do not change runtime layout but fields, units and ownership do', () => {
  const p=newModuleProject();for(const s of p.design.structures)s.description='用户备注 α/β';
  const before=structuredClone(p);assert.deepEqual(inspectFirmwareSupport(p).sourceIssues,[]);assert.deepEqual(p,before);
  for(const mutate of [s=>s.fields[0].type='f64',s=>s.fields[0].name+='_changed',s=>s.fields[0].count+=1,s=>s.fields[0].unit='unexpected',s=>s.owner='hw-board']) {
    const changed=structuredClone(p);mutate(changed.design.structures.find(s=>s.id===changed.design.moduleContracts['hw-drivers'].input));
    assert(inspectFirmwareSupport(changed).sourceIssues.some(i=>i.code==='contracts'));
  }
});
test('invalid control and incomplete XH wire values are explicitly rejected', () => {
  const p=newModuleProject();p.instances['foc-current'].parameters.bandwidthHz=0;
  assert(inspectFirmwareSupport(p).sourceIssues.some(i=>i.code==='validation'));
  const xh=inspectFirmwareSupport(createNeo75hProject('XH'));
  assert(xh.sourceIssues.some(i=>i.code==='driver-config'&&i.path.startsWith('hw-drivers.torqueSensor')));
});
test('unsupported control functions never use an old code fallback', () => {
  for(const [id,key,value] of [['app-state','stateMachine','cia402'],['app-motion','supportedModes',['position']]]) {
    const p=newModuleProject();p.instances[id].parameters[key]=value;
    const report=inspectFirmwareSupport(p);assert.equal(report.sourceReady,false);
    assert(report.sourceIssues.some(i=>i.code==='implementation'&&i.path===id));
  }
  const calibration=newModuleProject();calibration.instances['app-calibration'].enabled=calibration.instances['app-calibration'].runtimeEnabled=true;
  calibration.instances['app-calibration'].parameters.procedures=['friction'];
  assert(inspectFirmwareSupport(calibration).sourceIssues.some(i=>i.code==='implementation'&&i.path==='app-calibration'));
  const observer=newModuleProject();observer.instances['foc-observer'].enabled=observer.instances['foc-observer'].runtimeEnabled=true;
  assert(inspectFirmwareSupport(observer).sourceIssues.some(i=>i.code==='implementation'&&i.path==='foc-observer'));
  const stale=newModuleProject();stale.instances['app-runtime'].parameters.stateMachine='cia402';
  assert(inspectFirmwareSupport(stale).sourceIssues.some(i=>i.code==='validation'));
});
test('build job identifiers cannot escape the generated directory',async()=>{
  await assert.rejects(buildFirmware({jobId:'../other'}),/标识无效/);
});
