import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreSettings, coreCapabilities, validateCoreConfigs } from '../web/src/modules/hardware/hw-platform/cores.mjs';
import { applyMcuDefaults, syncDerivedClocks, fillMissingAutomaticSettings } from '../web/src/modules/hardware/hw-platform/defaults.mjs';

const platformFor=mcu=>applyMcuDefaults(mcu,{clockSource:'unselected',oscillatorHz:null,flashKiB:1024,busClockHz:null,timerClockHz:null,coreConfigs:{}});
const errors=(mcu,platform)=>validateCoreConfigs(mcu,platform).filter(issue=>issue.level==='error');

test('supported CPU defaults distinguish recommended clocks from capability ceilings and start caches disabled',()=>{
  const cases=[
    ['STM32H745IIK6','cm7',400000000,480000000],['STM32H745IIK6','cm4',200000000,240000000],
    ['STM32G474RE','cm4',150000000,170000000],['HPM5361','rv32',360000000,480000000],
    ['HPM5331','rv32',360000000,480000000],['HPM5321','rv32',360000000,480000000],['HPM5301','rv32',360000000,360000000],
  ];
  for(const [mcu,id,clock,max] of cases) {
    const settings=createCoreSettings(mcu,id);
    assert.equal(settings.clockHz,clock,mcu); assert.equal(coreCapabilities(mcu,id).maxClockHz,max,mcu);
    assert.equal(settings.floatAbi,'hard'); assert.equal(settings.systemTickHz,1000);
    assert.equal(settings.instructionCache,'disabled'); assert.equal(settings.dataCache,'disabled');
    assert.equal(settings.communicationIrqPriority,null,'no communication IRQ priority is invented');
    settings.clockHz=1; assert.equal(createCoreSettings(mcu,id).clockHz,clock,'defaults are detached');
  }
  assert.equal(coreCapabilities('unknown','cm4'),null);
  assert.equal(createCoreSettings('unknown','cm4').clockHz,null);
  assert.equal(createCoreSettings('unknown','cm4').floatAbi,'unselected');
});

test('explicit MCU defaults populate coherent core and shared clocks without guessing the input source',()=>{
  for(const [mcu,bus] of [['STM32H745IIK6',200000000],['STM32G474RE',150000000],['HPM5361',180000000],['HPM5301',180000000]]) {
    const platform=platformFor(mcu);
    assert.equal(platform.busClockHz,bus,mcu);assert.equal(platform.timerClockHz,bus,mcu);
    assert.equal(platform.clockSource,'unselected');assert.equal(platform.oscillatorHz,null);assert.equal(platform.flashKiB,1024);
    assert.deepEqual(errors(mcu,platform),[],mcu);
  }
  const platform=platformFor('STM32H745IIK6');platform.clockSource='bypass';platform.oscillatorHz=25000000;
  applyMcuDefaults('unknown',platform);
  assert.deepEqual(platform.coreConfigs,{});assert.equal(platform.busClockHz,null);assert.equal(platform.timerClockHz,null);
  assert.equal(platform.clockSource,'bypass');assert.equal(platform.oscillatorHz,25000000);
});

test('H745 clock edits derive valid AHB clocks and leave impossible M4 requests visible to validation',()=>{
  const mcu='STM32H745IIK6',platform=platformFor(mcu);
  platform.coreConfigs.cm7.clockHz=480000000;
  syncDerivedClocks(mcu,platform,{editedCoreId:'cm7'});
  assert.equal(platform.coreConfigs.cm4.clockHz,240000000);assert.equal(platform.busClockHz,240000000);assert.equal(platform.timerClockHz,240000000);
  platform.coreConfigs.cm4.clockHz=120000000;
  syncDerivedClocks(mcu,platform,{editedCoreId:'cm4'});
  assert.equal(platform.busClockHz,120000000);assert.equal(platform.timerClockHz,120000000);assert.deepEqual(errors(mcu,platform),[]);
  platform.coreConfigs.cm4.clockHz=160000000;
  syncDerivedClocks(mcu,platform,{editedCoreId:'cm4'});
  assert.equal(platform.coreConfigs.cm4.clockHz,160000000,'an unsupported /3 request is not silently rounded');
  assert.equal(platform.busClockHz,null);assert.equal(platform.timerClockHz,null);
  assert(errors(mcu,platform).some(issue=>issue.id==='core-cm4-clock-divider'&&issue.coreKey==='clockHz'));
  platform.coreConfigs.cm4.clockHz=7500000;
  syncDerivedClocks(mcu,platform,{editedCoreId:'cm4'});
  assert.equal(platform.busClockHz,7500000);assert.deepEqual(errors(mcu,platform),[],'legal /64 is retained');
});

test('G474 follows its core and HPM bus dividers keep AHB at or below 200 MHz',()=>{
  const g4=platformFor('STM32G474RE');g4.coreConfigs.cm4.clockHz=120000000;
  syncDerivedClocks('STM32G474RE',g4,{editedCoreId:'cm4'});
  assert.equal(g4.busClockHz,120000000);assert.equal(g4.timerClockHz,120000000);
  const hpm=platformFor('HPM5361');
  for(const [clock,bus] of [[480000000,160000000],[400000000,200000000],[360000000,180000000],[100000000,100000000]]) {
    hpm.coreConfigs.rv32.clockHz=clock;syncDerivedClocks('HPM5361',hpm,{editedCoreId:'rv32'});
    assert.equal(hpm.busClockHz,bus);assert.equal(hpm.timerClockHz,bus);assert.deepEqual(errors('HPM5361',hpm),[]);
  }
  const lower=platformFor('HPM5301');lower.coreConfigs.rv32.clockHz=480000000;
  syncDerivedClocks('HPM5301',lower,{editedCoreId:'rv32'});
  assert.equal(lower.coreConfigs.rv32.clockHz,480000000);assert.equal(lower.busClockHz,null);
  assert(errors('HPM5301',lower).some(issue=>issue.id==='core-rv32-clockHz-range'));
});

test('only empty automatic settings are migrated; explicit ABI, tick, clocks and invalid values survive',()=>{
  const mcu='STM32H745IIK6',platform=platformFor(mcu),core=platform.coreConfigs.cm7;
  core.floatAbi='unselected';core.systemTickHz=null;platform.busClockHz=null;platform.timerClockHz=null;
  fillMissingAutomaticSettings(mcu,platform);
  assert.equal(core.floatAbi,'hard');assert.equal(core.systemTickHz,1000);assert.equal(platform.busClockHz,200000000);assert.equal(platform.timerClockHz,200000000);
  Object.assign(core,{floatAbi:'softfp',systemTickHz:2000});platform.timerClockHz=100000000;
  const before=structuredClone(platform);fillMissingAutomaticSettings(mcu,platform);assert.deepEqual(platform,before);
  Object.assign(core,{floatAbi:'invalid',systemTickHz:0});platform.busClockHz=-1;
  const invalid=structuredClone(platform);fillMissingAutomaticSettings(mcu,platform);assert.deepEqual(platform,invalid);
  assert(errors(mcu,platform).some(issue=>issue.id==='core-format'));
  core.floatAbi='hard';assert(errors(mcu,platform).some(issue=>issue.id==='core-cm7-systemTickHz-range'));
});

test('empty shared clocks require valid core frequencies and missing cores are not fabricated',()=>{
  const mcu='STM32H745IIK6',platform=platformFor(mcu);
  platform.coreConfigs.cm7.clockHz=null;platform.busClockHz=null;platform.timerClockHz=null;
  fillMissingAutomaticSettings(mcu,platform);assert.equal(platform.busClockHz,null);assert.equal(platform.timerClockHz,null);
  platform.coreConfigs={};fillMissingAutomaticSettings(mcu,platform);assert.deepEqual(platform.coreConfigs,{});
  const unknown={coreConfigs:{other:{systemTickHz:null,floatAbi:'unselected'}},busClockHz:null,timerClockHz:null};
  const before=structuredClone(unknown);fillMissingAutomaticSettings('unknown',unknown);assert.deepEqual(unknown,before);
  const hpm=platformFor('HPM5361');hpm.busClockHz=120000000;hpm.timerClockHz=null;
  fillMissingAutomaticSettings('HPM5361',hpm);assert.equal(hpm.busClockHz,120000000);assert.equal(hpm.timerClockHz,120000000,'preserve the legal explicit /3 bus');
});

test('hidden automatic fields retain their existing required-value and range validation',()=>{
  const mcu='STM32H745IIK6',platform=platformFor(mcu);
  platform.coreConfigs.cm7.systemTickHz=null;platform.coreConfigs.cm7.floatAbi='unselected';
  const issues=validateCoreConfigs(mcu,platform);
  assert(issues.some(issue=>issue.coreKey==='systemTickHz'&&issue.level==='pending'));
  assert(issues.some(issue=>issue.coreKey==='floatAbi'&&issue.level==='pending'));
  platform.coreConfigs.cm7.systemTickHz=-1;
  assert(errors(mcu,platform).some(issue=>issue.coreKey==='systemTickHz'));
});
