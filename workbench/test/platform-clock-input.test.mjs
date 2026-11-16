import test from 'node:test';
import assert from 'node:assert/strict';
import { oscillatorLimits, validateOscillatorClock } from '../web/src/modules/hardware/hw-platform/clocks.mjs';
import { bindHardwareField } from '../web/src/modules/hardware/hw-platform/options.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { validateProject } from '../web/src/core/model.mjs';
import { getGuide } from '../web/src/features/configuration/guide.mjs';

test('input-source limits follow confirmed MCU oscillator specifications rather than CPU speed',()=>{
  for(const [mcu,source,min,max] of [
    ['STM32H745IIK6','external',4e6,48e6],['STM32H745ZI','bypass',4e6,50e6],
    ['STM32G474RE','external',4e6,48e6],['STM32G474RE','bypass',1,48e6],['STM32G474RE','internal',16e6,16e6],
    ...['HPM5361','HPM5331','HPM5321','HPM5301'].flatMap(mcu=>['external','bypass','internal'].map(source=>[mcu,source,24e6,24e6])),
  ]) {
    const limits=oscillatorLimits(mcu,source);assert.equal(limits.min,min);assert.equal(limits.max,max);assert.match(limits.source,/^https:\/\//);
    for(const value of [min,max])assert.deepEqual(validateOscillatorClock(mcu,{clockSource:source,oscillatorHz:value}),[]);
    for(const value of [0,max+1,1e12])assert.equal(validateOscillatorClock(mcu,{clockSource:source,oscillatorHz:value})[0].level,'error');
  }
  assert.match(oscillatorLimits('STM32G474RE','bypass').note,/Range 2.*26 MHz/);
});

test('internal nominal sources are distinct from core frequencies and missing data is left to required-field checks',()=>{
  for(const oscillatorHz of [4e6,64e6])assert.deepEqual(validateOscillatorClock('STM32H745ZI',{clockSource:'internal',oscillatorHz}),[]);
  assert.equal(validateOscillatorClock('STM32H745ZI',{clockSource:'internal',oscillatorHz:400e6})[0].paramKey,'oscillatorHz');
  assert.match(validateOscillatorClock('STM32H745ZI',{clockSource:'internal',oscillatorHz:25e6})[0].message,/标称/);
  assert.deepEqual(validateOscillatorClock('STM32H745ZI',{clockSource:'external',oscillatorHz:null}),[]);
  assert.equal(oscillatorLimits('custom','external').max,undefined);
  for(const oscillatorHz of [-1,0,NaN,Infinity,'25000000'])assert.equal(validateOscillatorClock('custom',{oscillatorHz})[0].level,'error');
  assert.deepEqual(validateOscillatorClock('custom',{oscillatorHz:25000000}),[]);
});

test('rendered input constraints and project validation share the same source-dependent bounds without clamping',()=>{
  const field={key:'oscillatorHz',type:'number',min:1,description:'输入频率'};
  assert.equal(bindHardwareField(field,'STM32H745ZI','hw-platform',{clockSource:'external'}).max,48e6);
  assert.equal(bindHardwareField(field,'STM32H745ZI','hw-platform',{clockSource:'bypass'}).max,50e6);
  assert.equal(field.max,undefined,'render binding does not mutate schema');
  const project=createNeo75hProject(), params=project.instances['hw-platform'].parameters;
  params.oscillatorHz=1e12;const before=structuredClone(project);
  assert(validateProject(project).some(issue=>issue.id==='clock-oscillator-range'&&issue.moduleId==='hw-platform'&&issue.level==='error'));
  assert.notEqual(getGuide(project).steps.find(step=>step.id==='hardware').children.find(module=>module.id==='hw-platform').state,'done');
  assert.deepEqual(project,before,'invalid values remain visible for correction');
});
