import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, getDerived, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { captureDriverHardware, applyDriver } from '../web/src/features/equipment/model.mjs';
import { saveLayerVersion, applyLayerVersion } from '../web/src/features/configuration/versions.mjs';
import { getGuide } from '../web/src/features/configuration/guide.mjs';

test('four hardware modules own their complete parameter sets and their own three contracts',()=>{
  const p=createNeo75hProject(), modules=MODULES.filter(m=>m.layer==='hardware');
  assert.deepEqual(modules.map(m=>[m.id,m.title]),[['hw-platform','内核'],['hw-board','外设'],['hw-drivers','驱动'],['hw-safety','异常']]);
  const ids=new Set(modules.flatMap(m=>Object.values(p.design.moduleContracts[m.id])));
  assert.equal(ids.size,12);
  assert.equal(p.instances['hw-platform'].parameters.coreConfigs.cm7.clockHz,400000000);
  assert.equal(p.instances['hw-platform'].parameters.flashKiB,2048);
  assert.equal(p.instances['hw-board'].parameters.pwmHz,20000);
  assert.equal(p.instances['hw-board'].parameters.currentTopology,'three_shunt');
  assert.equal(p.instances['hw-board'].parameters.resources.length,12);
  assert.equal(getGuide(p).steps.find(s=>s.id==='hardware').children.length,3);
});
test('a detailed Flash plan does not bypass shared clock validation or core configuration progress',()=>{
  const p=createNeo75hProject();p.instances['hw-platform'].parameters.oscillatorHz=null;
  assert(p.memory.layout.banks.length);
  assert(validateProject(p).some(i=>i.id==='missing-hw-platform-oscillatorHz'));
  const module=getGuide(p).steps.find(s=>s.id==='hardware').children.find(m=>m.id==='hw-platform');
  assert.equal(module.state,'todo');
});
test('combined peripheral and core parameters survive shelf reuse, export and layer version restoration',()=>{
  let p=createNeo75hProject();
  Object.assign(p.instances['hw-board'].parameters,{pwmHz:24000,currentLoopDivider:2,busVoltageV:36});
  Object.assign(p.instances['hw-platform'].parameters,{oscillatorHz:24000000,firmwareReserveKiB:768});
  p=captureDriverHardware(p,p.catalog.activeDriverId);
  const roundtrip=applyDriver(parseProject(serializeProject(p)),p.catalog.activeDriverId);
  for(const id of ['hw-platform','hw-board'])assert.deepEqual(roundtrip.instances[id].parameters,p.instances[id].parameters);
  assert.equal(getDerived(roundtrip).fastHz,12000);
  const saved=saveLayerVersion(p,{layer:'hardware',version:'four-module-layout'});
  saved.instances['hw-board'].parameters.pwmHz=30000;saved.instances['hw-platform'].parameters.firmwareReserveKiB=1024;
  const restored=applyLayerVersion(saved,'hardware');
  for(const id of ['hw-platform','hw-board'])assert.deepEqual(restored.instances[id].parameters,p.instances[id].parameters);
});
