import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { createNeo75hProject, neo75hParameterOwner } from '../web/src/profiles/neo75h.mjs';
import { applyDriver, captureDriverHardware } from '../web/src/features/equipment/model.mjs';
import { saveLayerVersion, applyLayerVersion } from '../web/src/features/configuration/versions.mjs';
import { createResource, selectResourceInstance, resourceIssues, getMcuResources } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { validateHardware, syncSensorResource } from '../web/src/modules/hardware/hw-board/validation.mjs';
import { createTripPath, tripIssues } from '../web/src/modules/hardware/hw-safety/paths.mjs';
import { bindSensorField, renderResourceEditor, renderTripEditor } from '../web/src/features/configuration/hardware-view.mjs';
import { inspectFirmwareSupport } from '../native/firmware.mjs';
const hardware=p=>p.instances['hw-board'].parameters.resources;
const errors=p=>validateHardware(p).filter(issue=>issue.level==='error');

test('NEO board resource references resolve and preserve the two encoders sharing USART2',()=>{
  const p=createNeo75hProject();
  assert.deepEqual(errors(p),[]);
  const sensors=p.instances['hw-sensors'].parameters;
  assert.equal(sensors.motorEncoderResource,sensors.outputEncoderResource);
  assert.equal(hardware(p).filter(r=>r.instance==='USART2').length,1);
  assert.equal(hardware(p).find(r=>r.id==='DRV8353_NFAULT').pins.IO,'PD1');
});
test('pin selection follows the exact MCU package, rejects conflicts and does not invent unknown chip pinouts',()=>{
  const p=createNeo75hProject(), resource=createResource('spi','spi');
  selectResourceInstance(resource,p.target.mcu,'SPI2');
  assert.equal(resource.pins.SCK,'');
  assert.throws(()=>selectResourceInstance(resource,'HPM5361','SPI2'));
  assert.deepEqual(getMcuResources('STM32H745'),[]);
  resource.pins.SCK='PD1';hardware(p).push(resource);
  const issues=resourceIssues(p.target.mcu,hardware(p));
  assert(issues.some(issue=>issue.title==='引脚不支持所选外设'));
  assert(issues.some(issue=>issue.title==='引脚重复分配'));
});
test('deleting a bound interface and changing its type fail validation without clearing user references',()=>{
  const p=createNeo75hProject();
  hardware(p).splice(hardware(p).findIndex(r=>r.id==='USART2'),1);
  assert.equal(errors(p).filter(issue=>issue.title.includes('PCBA 接口不存在')).length,2);
  assert.equal(p.instances['hw-sensors'].parameters.motorEncoderResource,'USART2');
  const q=createNeo75hProject();q.instances['hw-sensors'].parameters.motorEncoderInterface='spi';
  assert(errors(q).some(issue=>issue.title.includes('接口类型不匹配')));
});
test('sensor selectors filter PCBA resources and communication rate has one editable owner',()=>{
  const p=createNeo75hProject(), sensors=p.instances['hw-sensors'].parameters;
  const bound=bindSensorField({key:'motorEncoderResource'},sensors,hardware(p));
  assert.deepEqual(bound.options.map(o=>o.value),['USART2','USART3']);
  hardware(p).find(r=>r.id==='USART2').settings.bitrate=1000000;
  assert(errors(p).some(issue=>issue.title.includes('速率不一致')));
  syncSensorResource(sensors,hardware(p));
  assert.equal(sensors.motorEncoderBitrate,1000000);
  assert.equal(sensors.outputEncoderBitrate,1000000);
  assert.equal(bindSensorField({key:'motorEncoderBitrate'},sensors,hardware(p)).type,'readout');
});
test('hardware resources and protection paths survive export, shelf reuse and layer snapshots independently',()=>{
  let p=createNeo75hProject();
  p.instances['hw-safety'].parameters.tripPaths=[{...createTripPath('nfault'),inputResource:'DRV8353_NFAULT',pwmResource:'HRTIM1'}];
  p=captureDriverHardware(p,p.catalog.activeDriverId);
  const imported=parseProject(serializeProject(p));
  assert.deepEqual(hardware(imported),hardware(p));
  const applied=applyDriver(imported,p.catalog.activeDriverId);
  assert.deepEqual(applied.instances['hw-safety'].parameters.tripPaths,p.instances['hw-safety'].parameters.tripPaths);
  const saved=saveLayerVersion(p,{layer:'hardware',version:'board-dev'});
  hardware(saved)[0].pins.A1='';
  const restored=applyLayerVersion(saved,'hardware');
  assert.equal(hardware(restored)[0].pins.A1,'PC6');
  assert.equal(hardware(p)[0].pins.A1,'PC6');
});
test('nFAULT must be low active and latched; interrupt path never claims autonomous hardware shutdown',()=>{
  const p=createNeo75hProject(), path={...createTripPath('nfault'),inputResource:'DRV8353_NFAULT',pwmResource:'HRTIM1'};
  assert(tripIssues([path],hardware(p)).some(i=>i.id.endsWith('-latency')));
  assert.match(renderTripEditor([path],hardware(p)),/受中断屏蔽和抢占影响/);
  path.activeLevel='high';path.latch=false;
  const issues=tripIssues([path],hardware(p));
  assert(issues.some(i=>i.level==='error'&&i.id.endsWith('-polarity')));
  assert(issues.some(i=>i.level==='error'&&i.id.endsWith('-latch')));
});
test('a planned trip route cannot pass build support while the NEO EXTI handler has no shutdown implementation',()=>{
  const p=createNeo75hProject();
  p.instances['hw-safety'].parameters.tripPaths=[{...createTripPath('nfault'),inputResource:'DRV8353_NFAULT',pwmResource:'HRTIM1'}];
  const result=inspectFirmwareSupport(p);
  assert.equal(result.supported,false);
  assert(result.issues.some(issue=>issue.code==='platform-port'));
});
test('import rejects malformed nested pin/protection parameters and editors escape user names',()=>{
  const p=createNeo75hProject();hardware(p)[0].pins.A1={bad:'pin'};
  assert.throws(()=>parseProject(JSON.stringify(p)),/引脚/);
  const q=createNeo75hProject();hardware(q)[0].name='<img src=x onerror=bad>';
  assert.doesNotMatch(renderResourceEditor(q.target.mcu,hardware(q)),/<img/);
});
test('software voltage polling belongs to application protection; ARM-only fields do not apply to RISC-V',()=>{
  assert.equal(neo75hParameterOwner('hw.volt_sample.bus_volt_max'),'app-safety');
  const p=createProject();p.target={mcu:'HPM5361',vendor:'hpmicro',board:'NEO'};p.instances['hw-platform'].parameters.architecture='riscv';
  assert(!validateProject(p).some(issue=>issue.id==='missing-hw-platform-floatAbi'));
});
