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

test('NEO board references preserve historical shared USART2 wiring and report both conflicting drivers',()=>{
  const p=createNeo75hProject();
  assert.deepEqual(errors(p).map(issue=>issue.id).sort(),['hardware-motorEncoder-resource-choice','hardware-outputEncoder-resource-choice']);
  assert(errors(p).every(issue=>issue.title==='外设重复占用'&&issue.message.includes('USART2')));
  const sensors=p.instances['hw-drivers'].parameters;
  assert.equal(sensors.motorEncoderResource,sensors.outputEncoderResource);
  assert.equal(hardware(p).filter(r=>r.instance==='USART2').length,1);
  assert.equal(hardware(p).find(r=>r.id==='DRV8353_NFAULT').pins.IO,'PD1');
});
test('ADC current gains are independent and survive import, driver reuse and layer restoration',()=>{
  let p=createNeo75hProject();
  const adcs=hardware(p).filter(resource=>resource.preset==='phase-current');
  assert.deepEqual(adcs.map(resource=>resource.settings.currentGain),[0.025,0.025,0.025]);
  adcs[0].settings.currentGain=0.05;
  adcs[1].settings.currentGain=0.075;
  adcs[2].settings.currentGain=null;
  const gains=project=>hardware(project).filter(resource=>resource.preset==='phase-current').map(resource=>resource.settings.currentGain);
  p=captureDriverHardware(p,p.catalog.activeDriverId);
  const imported=parseProject(serializeProject(p));
  assert.deepEqual(gains(imported),[0.05,0.075,null]);
  assert.deepEqual(gains(applyDriver(imported,p.catalog.activeDriverId)),[0.05,0.075,null]);
  const saved=saveLayerVersion(imported,{layer:'hardware',version:'independent-adc-gains'});
  hardware(saved).find(resource=>resource.id==='ADC1').settings.currentGain=0.1;
  assert.deepEqual(gains(applyLayerVersion(saved,'hardware')),[0.05,0.075,null]);
  assert.deepEqual(gains(p),[0.05,0.075,null]);
});

test('current gain is optional for non-current ADCs but must be positive when configured',()=>{
  const resource=createResource('adc','current-adc');
  assert.equal(resource.settings.currentGain,null);
  for(const instance of ['', 'ADC1']) {
    resource.instance=instance;
    for(const value of [null,undefined,0.025]) {
      resource.settings.currentGain=value;
      if(value===undefined)delete resource.settings.currentGain;
      assert(!resourceIssues('STM32H745IIK6',[resource]).some(issue=>issue.id.includes('currentGain')));
    }
    for(const value of [0,-0.025]) {
      resource.settings.currentGain=value;
      assert(resourceIssues('STM32H745IIK6',[resource]).some(issue=>issue.level==='error'&&issue.id==='pcba-current-adc-currentGain'));
    }
  }
  const p=createNeo75hProject();hardware(p).find(resource=>resource.kind==='adc').settings.currentGain='0.025';
  assert.throws(()=>parseProject(JSON.stringify(p)),/currentGain.*有效数字/);
});

test('legacy board gain is preserved without assuming every ADC measures current',()=>{
  const p=createNeo75hProject(), board=p.instances['hw-board'].parameters;
  board.currentGain=0.05;
  for(const resource of hardware(p).filter(resource=>resource.kind==='adc'))delete resource.settings.currentGain;
  hardware(p).find(resource=>resource.id==='ADC1').name='母线电压';
  const imported=parseProject(serializeProject(p));
  assert.equal(imported.instances['hw-board'].parameters.currentGain,0.05);
  assert(hardware(imported).filter(resource=>resource.kind==='adc').every(resource=>resource.settings.currentGain==null));
  const blank=createProject();
  const removedKeys=['currentTopology','busVoltageV','currentGain'];
  assert(!validateProject(blank).some(issue=>issue.moduleId==='hw-board'&&removedKeys.includes(issue.paramKey)));
});

test('pin selection follows the exact MCU package, rejects conflicts and does not invent unknown chip pinouts',()=>{
  const p=createNeo75hProject(), resource=createResource('spi','spi');
  selectResourceInstance(resource,p.target.mcu,'SPI2');
  assert.equal(resource.pins.SCK,'');
  assert.throws(()=>selectResourceInstance(resource,'HPM5361','SPI2'));
  assert.deepEqual(getMcuResources('STM32H745ZIT6'),[]);
  resource.pins.SCK='PD1';hardware(p).push(resource);
  const issues=resourceIssues(p.target.mcu,hardware(p));
  assert(issues.some(issue=>issue.title==='引脚不支持所选外设'));
  assert(issues.some(issue=>issue.title==='引脚重复分配'));
});
test('the H745 family UI alias uses only the maintained IIK6 package mapping',()=>{
  assert.deepEqual(getMcuResources('STM32H745'),getMcuResources('STM32H745IIK6'));
  assert.deepEqual(getMcuResources('STM32H745ZIT6'),[]);
  const adc=createResource('adc','family-adc');
  selectResourceInstance(adc,'STM32H745','ADC1');
  adc.pins.INP0='PA0_C';
  assert(!resourceIssues('STM32H745',[adc]).some(issue=>issue.id==='pcba-family-adc'||issue.level==='error'));
  const first=getMcuResources('STM32H745');first[0].pins={};
  assert.notDeepEqual(first,getMcuResources('STM32H745'));
});

test('deleting a bound interface and changing its type fail validation without clearing user references',()=>{
  const p=createNeo75hProject();
  hardware(p).splice(hardware(p).findIndex(r=>r.id==='USART2'),1);
  assert.equal(errors(p).filter(issue=>issue.title.includes('PCBA 接口不存在')).length,2);
  assert.equal(p.instances['hw-drivers'].parameters.motorEncoderResource,'USART2');
  const q=createNeo75hProject();hardware(q).find(resource=>resource.id==='USART2').settings.physical='ttl';
  assert(errors(q).some(issue=>issue.title.includes('接口类型不匹配')));
});
test('sensor selectors filter PCBA resources while driver communication rates remain editable',()=>{
  const p=createNeo75hProject(), sensors=p.instances['hw-drivers'].parameters;
  const bound=bindSensorField({key:'motorEncoderResource'},sensors,hardware(p));
  assert.deepEqual(bound.options.map(o=>o.value),['USART2','USART3']);
  hardware(p).find(r=>r.id==='USART2').settings.bitrate=1000000;
  assert(errors(p).some(issue=>issue.title.includes('速率不一致')));
  syncSensorResource(sensors,hardware(p));
  assert.equal(sensors.motorEncoderBitrate,1000000);
  assert.equal(sensors.outputEncoderBitrate,1000000);
  assert.deepEqual(bindSensorField({key:'motorEncoderBitrate',type:'number',label:'波特率'},sensors,hardware(p)),{key:'motorEncoderBitrate',type:'number',label:'波特率'});
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
