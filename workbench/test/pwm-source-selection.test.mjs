import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { inspectFirmwareSupport } from '../native/firmware.mjs';
import { renderResourceEditor } from '../web/src/features/configuration/hardware-view.mjs';
import { ensureCommonResources } from '../web/src/modules/hardware/hw-board/resource-defaults.mjs';
import { checkResourceShape, createPresetResource, createResource, resourceInstanceOptions, resourceIssues, resourceRoute, resourceSettingLayout, resourceSignalLayout, selectResourceInstance, selectResourcePin } from '../web/src/modules/hardware/hw-board/resources.mjs';

const mcu = 'STM32H745IIK6';

test('PWM selector offers maintained HRTIM and TIM output routes but excludes basic timers', () => {
  const pwm = createPresetResource('pwm', 'bridge');
  const routes = resourceInstanceOptions(mcu, pwm), instances = routes.map(route => route.instance);
  for (const instance of ['HRTIM1', 'TIM1', 'TIM8', 'TIM2', 'TIM12', 'TIM17']) assert(instances.includes(instance), instance);
  for (const instance of ['TIM6', 'TIM7', 'LPTIM1', 'ADC1']) assert(!instances.includes(instance), instance);
  assert(routes.every(route => Object.entries(route.pins).some(([signal,pins]) => (route.kind === 'pwm' ? /^[A-E][12]$/ : /^CH\d+$/).test(signal) && pins.length)));
  assert.deepEqual(resourceInstanceOptions('UNKNOWN', pwm), []);
  assert(resourceInstanceOptions(mcu, createResource('adc')).every(route => route.kind === 'adc'));
  const html = renderResourceEditor(mcu, [pwm]);
  for (const instance of ['HRTIM1', 'TIM1', 'TIM8']) assert.match(html, new RegExp(`<option value="${instance}"`));
  assert.doesNotMatch(html, /<option value="TIM[67]"/);
});

test('explicit PWM source changes switch the resource kind and clear only incompatible configuration', () => {
  const pwm = createPresetResource('pwm', 'bridge');
  selectResourceInstance(pwm, mcu, 'HRTIM1');
  selectResourcePin(pwm, mcu, 'A1', 'PC6');
  Object.assign(pwm.settings, { alignment: 'center', polarity: 'high' });
  selectResourceInstance(pwm, mcu, 'TIM1');
  assert.equal(pwm.kind, 'timer');
  assert.equal(pwm.preset, 'pwm');
  assert.equal(pwm.id, 'bridge');
  assert.equal(pwm.name, 'PWM');
  assert.deepEqual(pwm.pins, { CH1: '', CH2: '', CH3: '' });
  assert.deepEqual(pwm.settings, { mode: 'pwm', clockHz: null, periodUs: null });
  selectResourcePin(pwm, mcu, 'CH1', 'PA8');
  selectResourcePin(pwm, mcu, 'CH1N', 'PE8');
  Object.assign(pwm.settings, { clockHz: 100000000, periodUs: 50 });
  const configured = structuredClone(pwm);
  selectResourceInstance(pwm, mcu, 'TIM1');
  assert.deepEqual(pwm, configured, 'reselecting the same source preserves saved pins and timing');
  for (const invalid of ['TIM6', 'TIM7', 'ADC1', 'UNKNOWN']) {
    assert.throws(() => selectResourceInstance(pwm, mcu, invalid), /引脚映射/);
    assert.deepEqual(pwm, configured);
  }
  selectResourceInstance(pwm, mcu, 'TIM8');
  assert.deepEqual(pwm.pins, { CH1: '', CH2: '', CH3: '' });
  assert.deepEqual(pwm.settings, configured.settings, 'same-kind timer changes preserve timing');
  assert.equal(resourceSignalLayout(mcu, pwm).pairs.length, 3);
  selectResourceInstance(pwm, mcu, 'HRTIM1');
  assert.equal(pwm.kind, 'pwm');
  assert.deepEqual(pwm.pins, { A1: '', B1: '', C1: '' });
  assert.deepEqual(pwm.settings, { mode: 'pwm', alignment: '', polarity: '' });
  assert.doesNotThrow(() => checkResourceShape([pwm]));
});

test('timers without three bridge pairs expose only their maintained output channels', () => {
  for (const [instance, expected] of [['TIM2', ['CH1','CH2','CH3','CH4']], ['TIM12', ['CH1','CH2']], ['TIM16', ['CH1','CH1N']]]) {
    const pwm = createPresetResource('pwm', instance);
    selectResourceInstance(pwm, mcu, instance);
    const layout = resourceSignalLayout(mcu, pwm), route = resourceRoute(mcu, pwm);
    assert.deepEqual(layout.primary, expected);
    assert.equal(layout.pairs.length, 0);
    assert(layout.primary.every(signal => route.pins[signal].length));
    const html = renderResourceEditor(mcu, [pwm]);
    for (const signal of expected) assert.match(html, new RegExp(`data-key="${signal}"`));
    assert.doesNotMatch(html, /相主输出|data-key="(?:ETR|BKIN)"/);
  }
});

test('PWM hides fixed mode and legacy alignment/polarity without losing saved data or requiring hidden fields', () => {
  const pwm = createPresetResource('pwm', 'bridge');
  selectResourceInstance(pwm, mcu, 'HRTIM1');
  pwm.pins = { A1: 'PC6' };
  pwm.settings = { alignment: 'center', polarity: 'high' };
  const saved = structuredClone(pwm);
  const html = renderResourceEditor(mcu, [pwm]);
  assert.doesNotMatch(html, /data-key="(?:mode|alignment|polarity)"|工作模式|对齐方式|输出有效电平/);
  assert.deepEqual(resourceSettingLayout(pwm), { primary: [], advanced: [] });
  assert.deepEqual(pwm, saved);
  assert.deepEqual(resourceIssues(mcu, [pwm]), []);
  const project = createProject();
  project.instances['hw-board'].parameters.resources = [pwm];
  assert.deepEqual(parseProject(serializeProject(project)).instances['hw-board'].parameters.resources.find(resource => resource.id === pwm.id), saved);
  pwm.settings = {};
  assert.deepEqual(resourceIssues(mcu, [pwm]), []);
  selectResourceInstance(pwm, mcu, 'TIM1');
  assert.doesNotMatch(renderResourceEditor(mcu, [pwm]), /data-key="(?:mode|alignment|polarity)"/);
  assert.deepEqual(resourceSettingLayout(pwm).primary.map(([key]) => key), ['periodUs']);
  const timer = createResource('timer', 'general-purpose');
  selectResourceInstance(timer, mcu, 'TIM1');
  timer.settings.mode = 'pwm';
  assert.match(renderResourceEditor(mcu, [timer]), /data-key="mode"/, 'a generic timer can still change back to capture or base mode');
});

test('timer PWM presets survive import without duplicate defaults or weakening invalid-mode and firmware guards', () => {
  const project = createProject(), board = project.instances['hw-board'].parameters;
  const pwm = board.resources.find(resource => resource.preset === 'pwm');
  selectResourceInstance(pwm, mcu, 'TIM8');
  assert.doesNotThrow(() => checkResourceShape(board.resources));
  const before = structuredClone(board);
  ensureCommonResources(board);
  assert.deepEqual(board, before);
  const restored = parseProject(serializeProject(project)).instances['hw-board'].parameters;
  assert.deepEqual(restored, before);
  assert.equal(restored.resources.filter(resource => resource.preset === 'pwm').length, 1);
  const invalid = structuredClone(pwm);
  invalid.settings.mode = 'capture';
  assert.throws(() => checkResourceShape([invalid]), /预设/);
  invalid.settings.mode = 'pwm';
  invalid.instance = 'TIM6';
  assert(resourceIssues(mcu, [invalid]).some(issue => issue.level === 'error' && issue.id.endsWith('-mode-choice')));
  const support = inspectFirmwareSupport(project);
  assert.equal(support.supported, false);
  for (const code of ['platform-port', 'runtime-assembly', 'storage-port']) assert(support.integrationIssues.some(issue => issue.code === code));
});
