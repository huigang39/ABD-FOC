import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject } from '../web/src/core/model.mjs';
import { createDriver } from '../web/src/features/equipment/model.mjs';
import { renderEquipment } from '../web/src/features/equipment/view.mjs';
import { edit } from '../web/src/features/configuration/view.mjs';
import { getModelOptions, modelSelect, optionGroupFor } from '../web/src/shared/forms/model-options.mjs';

const decode = value => value.replace(/&(quot|#39|lt|gt|amp);/g, (_, entity) => ({ quot: '"', '#39': "'", lt: '<', gt: '>', amp: '&' }[entity]));
const options = html => [...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([, attrs, label]) => ({ value: decode(attrs.match(/\bvalue="([^"]*)"/)?.[1] ?? ''), label: decode(label), selected: /\bselected\b/.test(attrs), disabled: /\bdisabled\b/.test(attrs), hidden: /\bhidden\b/.test(attrs) }));

test('maintained model lists retain known planning choices and cannot be edited at runtime', () => {
  assert.deepEqual(getModelOptions('mcu'), [{ value: 'STM32H745IIK6', label: 'STM32H745IIK6' }]);
  assert.deepEqual(getModelOptions('board'), [{ value: 'NEO', label: 'NEO' }]);
  assert.deepEqual(getModelOptions('torque').map(option => option.label), ['坤维', '星汇', '蓝点', '三木禾']);
  assert.deepEqual(getModelOptions('gateDriver'), [{ value: 'DRV8353S', label: 'DRV8353' }, { value: 'discrete', label: '分立驱动' }]);
  assert.throws(() => getModelOptions('gateDriver').push({ value: 'new', label: 'new' }), TypeError);
  assert.throws(() => getModelOptions('board').push({ value: 'new', label: 'new' }), TypeError);
  assert.throws(() => { getModelOptions('board')[0].value = 'new'; }, TypeError);
  for (const group of ['other', '__proto__', null]) assert.throws(() => getModelOptions(group), /未知型号分组/);
});

test('driver MCU uses the fixed model select with no editor', () => {
  const project = createProject(), driver = createDriver();
  Object.assign(driver, { mcu: 'STM32H745IIK6', board: 'NEO' });
  Object.assign(driver.hardware['hw-drivers'], { encoderCapability: 'present', outputEncoderCapability: 'present', torqueCapability: 'present', gateDriverCapability: 'present', motorEncoderModel: 'MC_ENCODER_GW_OUTER', outputEncoderModel: 'MC_ENCODER_GW_INNER', torqueSensorModel: 'MC_TOR_SENSOR_KW', gateDriverModel: 'DRV8353S' });
  project.catalog.drivers.push(driver);
  const html = renderEquipment(project, [], 'drivers', driver.id);
  for (const [scope, key, group] of [['driver', 'mcu', 'mcu']]) {
    const matches = [...html.matchAll(/<(input|select)\b([^>]*)>/g)].filter(([, , attrs]) => attrs.includes(`data-edit="${scope}"`) && attrs.includes(`data-key="${key}"`));
    assert.equal(matches.length, 1, key);
    assert.equal(matches[0][1], 'select');
    assert.ok(matches[0][2].includes(`data-option-group="${group}"`));
    assert.equal(optionGroupFor(scope, key), group);
  }
  assert.doesNotMatch(html, /edit-options|编辑选项|option-editor/);
  assert.equal(optionGroupFor('driver', 'name'), '');
  assert.equal(optionGroupFor('module', 'gateDriverModel'), 'gateDriver');
});

test('an unknown current value is preserved and escaped but cannot become a selectable option', () => {
  const value = '  custom "><img src=x onerror=alert(1)> & \' value  ';
  for (const html of [modelSelect('mcu', value), edit('编码器', value, 'module', 'motorEncoderModel')]) {
    assert.deepEqual(options(html).filter(option => option.selected), [{ value, label: `${value} · 待适配`, selected: true, disabled: true, hidden: true }]);
    assert.doesNotMatch(html, /<img|<input|edit-options/);
  }
});

test('MCU choice keeps its package mapping and preserves existing family-only values', () => {
  for (const value of ['', 'STM32H745IIK6', 'STM32H745', 'STM32G474']) {
    const items = options(modelSelect('mcu', value));
    assert.deepEqual(items.filter(item => !item.disabled).map(({ value, label }) => ({ value, label })), [{ value: 'STM32H745IIK6', label: 'STM32H745IIK6' }]);
    assert.equal(items.find(item => item.selected).value, value);
    if (value === 'STM32H745') assert.equal(items.find(item => item.selected).label, 'STM32H745');
  }
});

test('project-selected custom models never leak into other fields or the maintained options', () => {
  const project = createProject(), driver = createDriver();
  project.target.mcu = 'PROJECT_ONLY_MCU';
  driver.mcu = 'DRIVER_ONLY_MCU';
  project.catalog.drivers.push(driver);
  const before = structuredClone(project);
  renderEquipment(project, [], 'drivers', driver.id);
  const list = options(edit('MCU', '', 'target', 'mcu')).map(option => option.value);
  assert.ok(!list.includes(project.target.mcu));
  assert.ok(!list.includes(driver.mcu));
  assert.deepEqual(project, before);
});

test('model selection never reads, clears or writes the former browser option library', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let access = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { access++; throw new Error('option storage must not be accessed'); } });
  try {
    const module = await import('../web/src/shared/forms/model-options.mjs?isolated');
    assert.ok(module.modelSelect('mcu', 'STM32H745IIK6').includes('STM32H745IIK6'));
    assert.equal(access, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
});

test('driver brands display Chinese names while legacy selections retain their wire-independent values', () => {
  assert.deepEqual(getModelOptions('encoder').map(option => option.label), ['弓望','金刚']);
  for (const [group,value,label] of [['encoder','MC_ENCODER_GW_INNER','弓望'],['encoder','GW 外圈','弓望'],['encoder','GW 内圈','弓望'],['torque','KW','坤维'],['torque','XH','星汇'],['torque','LD','蓝点'],['torque','SMH','三木禾'],['gateDriver','DRV8353','DRV8353']]) {
    const selected=options(modelSelect(group,value)).find(option=>option.selected);
    assert.equal(selected.value,value);
    assert.equal(selected.label,label);
    assert.equal(selected.disabled,true);
  }
});

test('the application has no option editor dialog or event handlers', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../web/src/app.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="option-editor"|id="option-add-form"/);
  assert.doesNotMatch(app, /optionEditorContext|edit-options|remove-option|option-add-form|optionCatalog/);
});
