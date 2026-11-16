import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { MODULES, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { createCoreConfigs, coreFields, validateCoreConfigs } from '../web/src/modules/hardware/hw-platform/cores.mjs';
import { syncMcuArchitecture } from '../web/src/features/deployment/mcu.mjs';
import { renderPlatformConfiguration } from '../web/src/features/configuration/platform-view.mjs';
import { applyDriver, captureDriverHardware } from '../web/src/features/equipment/model.mjs';
import { saveLayerVersion, applyLayerVersion } from '../web/src/features/configuration/versions.mjs';
import { inspectFirmwareSupport } from '../native/firmware.mjs';
import { renderArchitectureLayer } from '../web/src/features/architecture/view.mjs';
import { renderGuide } from '../web/src/features/configuration/view.mjs';
const platform=p=>p.instances['hw-platform'].parameters;
const errors=p=>validateCoreConfigs(p.target.mcu,platform(p),p).filter(issue=>issue.level==='error');

test('NEO separates M7/M4 clocks, tick and capabilities, without inventing the EtherCAT IRQ priority',()=>{
  const p=createNeo75hProject(), cores=platform(p).coreConfigs;
  assert.deepEqual(errors(p),[]);
  assert.equal(cores.cm7.clockHz,400000000);assert.equal(cores.cm4.clockHz,200000000);
  assert.equal(cores.cm7.dataCache,'enabled');assert.equal(cores.cm4.dataCache,'disabled');
  assert.equal(cores.cm4.communicationIrqPriority,null);
  assert(validateCoreConfigs(p.target.mcu,platform(p),p).some(issue=>issue.coreId==='cm4'&&issue.coreKey==='communicationIrqPriority'&&issue.level==='pending'));
  cores.cm4.systemTickHz=2000;assert.equal(cores.cm7.systemTickHz,1000);
});
test('per-core validation catches unsupported cache, IRQ range, clock ceiling and the M4 HCLK relation',()=>{
  const p=createNeo75hProject(), cores=platform(p).coreConfigs;
  cores.cm4.dataCache='enabled';cores.cm4.clockHz=300000000;cores.cm7.clockHz=500000000;
  const list=errors(p);
  for(const id of ['core-cm4-cache','core-cm4-clockHz-range','core-cm4-clock-link','core-cm7-clockHz-range'])assert(list.some(issue=>issue.id===id),id);
  cores.cm4.communicationIrqPriority='invalid';
  assert(errors(p).some(issue=>issue.id==='core-format'),'core-format');
});
test('interrupt fields track the module owner and hide unavailable M4 cache controls',()=>{
  const p=createNeo75hProject(), fields=id=>coreFields(p.target.mcu,id,p).map(field=>field.key);
  assert(!fields('cm4').includes('dataCache'));assert(!fields('cm4').includes('controlIrqPriority'));
  assert(fields('cm4').includes('communicationIrqPriority'));assert(!fields('cm7').includes('communicationIrqPriority'));
  p.execution.assignments['app-comms']='cm7';
  assert(fields('cm7').includes('communicationIrqPriority'));assert(!fields('cm4').includes('communicationIrqPriority'));
});
test('core values survive serialization, shelf reuse and hardware version restoration independently',()=>{
  let p=createNeo75hProject();platform(p).coreConfigs.cm4.systemTickHz=2000;
  p=captureDriverHardware(p,p.catalog.activeDriverId);
  const restored=applyDriver(parseProject(serializeProject(p)),p.catalog.activeDriverId);
  assert.deepEqual(platform(restored),platform(p));
  const saved=saveLayerVersion(p,{layer:'hardware',version:'dual-core-dev'});
  platform(saved).coreConfigs.cm4.systemTickHz=4000;
  assert.equal(platform(applyLayerVersion(saved,'hardware')).coreConfigs.cm4.systemTickHz,2000);
  assert.equal(platform(p).coreConfigs.cm4.systemTickHz,2000);
});
test('changing MCU explicitly rebuilds the core set; imported stale or malformed cores remain detectable',()=>{
  const p=createNeo75hProject(), hardware={'hw-platform':platform(p)};
  p.target.mcu='HPM5361';syncMcuArchitecture(p.target,hardware);
  assert(errors(p).some(issue=>issue.id==='core-cm7-target'));
  syncMcuArchitecture(p.target,hardware,{replaceCores:true});
  assert.deepEqual(Object.keys(platform(p).coreConfigs),['rv32']);
  assert(!coreFields('HPM5361','rv32',p).some(field=>['irqPriorityBits','floatAbi'].includes(field.key)));
  const q=createNeo75hProject();platform(q).coreConfigs.cm7.clockHz='400MHz';
  assert.throws(()=>parseProject(JSON.stringify(q)),/有效数值/);
  const missing=createNeo75hProject();delete platform(missing).coreConfigs.cm4;
  assert(validateCoreConfigs(missing.target.mcu,platform(missing),missing).some(issue=>issue.id==='core-cm4-missing'));
});
test('core editor shares controls for project and shelf; removed hardware shortcut strips stay absent',()=>{
  const p=createNeo75hProject(), fields=MODULES.find(m=>m.id==='hw-platform').params.filter(f=>!f.hidden);
  const html=renderPlatformConfiguration(p.target.mcu,platform(p),fields,()=>'',{project:p,owner:'driver'});
  assert.match(html,/data-core="cm7"/);assert.match(html,/data-core="cm4"/);
  assert.match(html,/data-edit="platform-core"[^>]*data-id="driver"[^>]*data-child="cm4"/);
  assert.doesNotMatch(renderGuide(p,[],'hardware'),/class="hardware-stages/);
  assert.doesNotMatch(renderArchitectureLayer('hardware'),/architecture-hardware-stages/);
  assert.deepEqual(Object.keys(createCoreConfigs('STM32G474RE')),['cm4']);
});

test('core editor lays out both cores with all supported controls and no folding or divider classes',()=>{
  const p=createNeo75hProject(), before=structuredClone(p), fields=MODULES.find(m=>m.id==='hw-platform').params.filter(f=>!f.hidden);
  const html=renderPlatformConfiguration(p.target.mcu,platform(p),fields,field=>`<input data-key="${field.key}">`,{project:p});
  for(const id of ['cm7','cm4'])assert.match(html,new RegExp(`<section[^>]*data-core="${id}">`));
  assert.match(html,/<div class="platform-flat">/);
  assert.match(html,/<strong>主核<\/strong>/);
  assert.match(html,/<strong>副核<\/strong>/);
  assert.doesNotMatch(html,/<strong>Cortex-M[47]<\/strong>/);
  assert.match(html,/Arm Cortex-M7/);
  assert.match(html,/Arm Cortex-M4/);
  assert.doesNotMatch(html,/<details|<summary|parameter-advanced|resource-disclosure|hardware-field-group|高级设置/);
  for(const key of ['clockSource','oscillatorHz','clockHz'])assert.match(html,new RegExp(`data-key="${key}"`));
  const m7 = html.split('data-core="cm7"')[1].split('data-core="cm4"')[0];
  for(const key of ['instructionCache','dataCache','controlIrqPriority'])assert.match(m7,new RegExp(`data-key="${key}"`));
  assert.match(html,/data-key="communicationIrqPriority"/);
  for(const key of ['floatAbi','systemTickHz','busClockHz','timerClockHz','flashKiB','eraseKiB','firmwareReserveKiB'])assert.doesNotMatch(html,new RegExp(`data-key="${key}"`));
  assert.doesNotMatch(html,/系统时基|浮点约定|总线与定时器时钟|存储容量/);
  assert.deepEqual(p,before);
});
test('core edits remain blocked for image builds until the new platform port exists',()=>{
  const p=createNeo75hProject();assert.equal(inspectFirmwareSupport(p).supported,false);
  platform(p).coreConfigs.cm4.systemTickHz=2000;
  const support=inspectFirmwareSupport(p);assert.equal(support.supported,false);
  assert(support.issues.some(issue=>issue.code==='platform-port'));
});


test('cache controls are switches with explicit saved enum states and unavailable M4 caches stay absent',()=>{
  const p=createNeo75hProject(), params=platform(p);
  params.coreConfigs.cm7.instructionCache='enabled';
  params.coreConfigs.cm7.dataCache='disabled';
  const before=structuredClone(p);
  const html=renderPlatformConfiguration(p.target.mcu,params,[],()=>'',{project:p,owner:'shelf-driver'});
  const input=key=>html.match(new RegExp(`<input[^>]*data-key="${key}"[^>]*>`))?.[0];
  assert.match(input('instructionCache'),/type="checkbox"/);
  assert.match(input('instructionCache'),/data-id="shelf-driver"[^>]*data-child="cm7"/);
  assert.match(input('instructionCache'),/data-value-type="cache-state" data-cache-state="enabled" aria-checked="true"/);
  assert.match(input('instructionCache'),/\schecked(?:\s|>)/);
  assert.match(input('dataCache'),/data-cache-state="disabled" aria-checked="false"/);
  assert.doesNotMatch(input('dataCache'),/\schecked(?:\s|>)/);
  const m4=html.split('data-core="cm4"')[1];
  assert.doesNotMatch(m4,/data-key="(?:instructionCache|dataCache)"/);
  const loaded=parseProject(serializeProject(p));
  assert.equal(platform(loaded).coreConfigs.cm7.instructionCache,'enabled');
  assert.equal(platform(loaded).coreConfigs.cm7.dataCache,'disabled');
  assert.deepEqual(p,before);
});

test('unknown imported cache states render mixed switches without being stored as disabled',()=>{
  const p=createNeo75hProject(), params=platform(p);
  params.coreConfigs.cm7.instructionCache=null;
  params.coreConfigs.cm7.dataCache='unselected';
  const before=structuredClone(params);
  const html=renderPlatformConfiguration(p.target.mcu,params,[],()=>'',{project:p});
  const cacheInputs=[...html.matchAll(/<input[^>]*data-key="(?:instructionCache|dataCache)"[^>]*>/g)].map(match=>match[0]);
  assert.equal(cacheInputs.length,2);
  for(const input of cacheInputs){
    assert.match(input,/data-cache-state="unconfigured" aria-checked="mixed"/);
    assert.doesNotMatch(input,/\schecked(?:\s|>)/);
  }
  assert.deepEqual(params,before);
  const loaded=parseProject(serializeProject(p));
  assert.equal(platform(loaded).coreConfigs.cm7.instructionCache,null);
  assert.equal(platform(loaded).coreConfigs.cm7.dataCache,'unselected');
});
