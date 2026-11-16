import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { RESOURCE_PRESETS, createResource, createPresetResource, checkResourceShape, selectResourceInstance, resourceIssues, canShareResourceInstance, resourceSettingLayout } from '../web/src/modules/hardware/hw-board/resources.mjs';

const mcu = 'STM32H745IIK6';
const adc = (preset, id, pins, settings = {}) => {
  const resource = createPresetResource(preset, id);
  selectResourceInstance(resource, mcu, 'ADC1');
  resource.pins = pins;
  Object.assign(resource.settings, { sampleCycles: 1.5, trigger: 'software' }, settings);
  return resource;
};
const errors = resources => resourceIssues(mcu, resources).filter(issue => issue.level === 'error');

test('common peripheral presets start unbound and retain their identity after renaming and export', () => {
  assert.deepEqual(RESOURCE_PRESETS.filter(preset => preset.common).map(preset => preset.id), ['phase-current','bus-voltage','temperature','pwm']);
  assert.equal(RESOURCE_PRESETS.find(preset => preset.id === 'terminal-voltage').common, false);
  const resources = RESOURCE_PRESETS.map(preset => createPresetResource(preset.id, preset.id));
  for (const resource of resources) {
    assert.equal(resource.instance, '');
    assert.deepEqual(resource.pins, {});
    for (const [key, value] of Object.entries(resource.settings)) {
      if (key === 'mode' && resource.kind === 'pwm') assert.equal(value, 'pwm');
      else assert(value === null || value === '');
    }
    resource.name += ' · 自定义';
  }
  resources[0].settings.currentGain = 0.025;
  assert.equal(resources[1].settings.currentGain, null);
  const project = createProject();
  project.instances['hw-board'].parameters.resources = resources;
  assert.deepEqual(parseProject(serializeProject(project)).instances['hw-board'].parameters.resources, resources);
});

test('legacy resource shapes remain valid and malformed preset metadata is rejected', () => {
  assert.doesNotThrow(() => checkResourceShape([createResource('adc','legacy')]));
  assert.throws(() => createPresetResource('not-a-preset'), /预设/);
  for (const preset of ['pwm', '__proto__', null, {}, '']) {
    const resource = createPresetResource('phase-current', 'bad');
    resource.preset = preset;
    assert.throws(() => checkResourceShape([resource]), /预设/);
  }
  assert.equal(canShareResourceInstance('adc'), true);
  assert.equal(canShareResourceInstance('gpio'), true);
  assert.equal(canShareResourceInstance('uart'), false);
});

test('sampling presets share an ADC on distinct channels with independent channel settings', () => {
  const current = adc('phase-current','current',{ INP0: 'PA0_C' },{ currentGain: 0.025 });
  const bus = adc('bus-voltage','bus',{ INP9: 'PB0' },{ sampleCycles: 8.5 });
  const temperature = adc('temperature','temp',{ INP10: 'PC0' },{ sampleCycles: 16.5 });
  const terminal = adc('terminal-voltage','terminal',{ INP11: 'PC1' },{ sampleCycles: 32.5 });
  const resources = [current,bus,temperature,terminal];
  assert.deepEqual(errors(resources), []);
  assert.equal(current.settings.sampleCycles, 1.5);
  assert.equal(bus.settings.currentGain, null);
});

test('shared ADC groups reject channel reuse, physical pin collisions and conflicting triggers', () => {
  const a = adc('phase-current','a',{ INP10: 'PC0' });
  const b = adc('temperature','b',{ INN10: 'PC1' });
  assert(errors([a,b]).some(issue => issue.id === 'pcba-b-INN10-channel-conflict'));
  b.pins = { INP10: 'PC0' };
  assert(errors([a,b]).some(issue => issue.title === '引脚重复分配'));
  b.pins = { INP11: 'PC1' };
  b.settings.trigger = 'HRTIM1';
  assert(errors([a,b]).some(issue => issue.id === 'pcba-b-shared-trigger'));
  b.settings.trigger = '';
  assert(!errors([a,b]).some(issue => issue.id.includes('shared-trigger')));
  assert(!resourceIssues(mcu,[a,b]).some(issue => issue.id === 'pcba-b-trigger-empty'));
});

test('ADC sharing does not relax duplicate peripheral checks for communication resources', () => {
  const resources = ['a','b'].map(id => {
    const resource = createResource('uart',id);
    selectResourceInstance(resource,mcu,'USART2');
    return resource;
  });
  assert(errors(resources).some(issue => issue.id === 'pcba-b-duplicate'));
});

test('trigger source and legacy current gain stay hidden while their stored values are retained', () => {
  for (const resource of [createResource('adc'), ...RESOURCE_PRESETS.filter(preset => preset.kind === 'adc').map(preset => createPresetResource(preset.id))]) {
    resource.settings.currentGain = 0.025;
    resource.settings.trigger = 'HRTIM1';
    const before = structuredClone(resource);
    const settings = resourceSettingLayout(resource);
    assert(![...settings.primary,...settings.advanced].some(([key]) => ['currentGain','trigger'].includes(key)));
    assert.deepEqual(resource,before);
  }
});
