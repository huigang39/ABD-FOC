import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { createDriver, getActiveDriver, validateEquipment, checkCatalogShape, applyDriver, captureDriverHardware } from '../web/src/features/equipment/model.mjs';
import { renderEquipment } from '../web/src/features/equipment/view.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';

const keys = ['phaseCurrentScale', 'terminalVoltageScale', 'busVoltageScale'];
const values = { phaseCurrentScale: 0.005, terminalVoltageScale: 0.0025, busVoltageScale: 0.00125 };
const coefficients = driver => Object.fromEntries(keys.map(key => [key, driver[key]]));

test('driver conversion coefficients start unknown and legacy imports do not infer them from V/A gain', () => {
  const driver = createDriver();
  assert.deepEqual(coefficients(driver), Object.fromEntries(keys.map(key => [key, null])));
  const project = createNeo75hProject(), source = getActiveDriver(project);
  for (const key of keys) delete source[key];
  source.hardware['hw-board'].currentGain = 0.025;
  assert.doesNotThrow(() => checkCatalogShape(project.catalog));
  const loaded = parseProject(serializeProject(project));
  assert.deepEqual(coefficients(getActiveDriver(loaded)), Object.fromEntries(keys.map(key => [key, null])));
  assert.equal(getActiveDriver(loaded).hardware['hw-board'].currentGain, 0.025);
});

test('driver coefficients survive save/load, explicit selection and hardware snapshot capture', () => {
  const project = createNeo75hProject(), driver = getActiveDriver(project);
  Object.assign(driver, values);
  const loaded = parseProject(serializeProject(project));
  assert.deepEqual(coefficients(getActiveDriver(loaded)), values);
  const applied = applyDriver(loaded, driver.id);
  assert.deepEqual(coefficients(getActiveDriver(applied)), values);
  const captured = captureDriverHardware(applied, driver.id);
  assert.deepEqual(coefficients(getActiveDriver(captured)), values);
  assert.deepEqual(coefficients(driver), values);
});

test('optional conversion coefficients require finite numeric values and positive magnitudes when filled', () => {
  const project = createProject(), driver = createDriver();
  project.catalog.drivers.push(driver);
  for (const key of keys) {
    for (const value of ['0.01', NaN, Infinity]) {
      driver[key] = value;
      assert.throws(() => checkCatalogShape(project.catalog), /有限数字/);
    }
    for (const value of [0, -0.01]) {
      driver[key] = value;
      assert(validateEquipment(project).some(issue => issue.id === `equipment-range-${driver.id}-${key}` && issue.level === 'error'));
    }
    driver[key] = 0.001;
    assert(!validateEquipment(project).some(issue => issue.id.includes(key)));
    driver[key] = null;
    assert(!validateEquipment(project).some(issue => issue.id.includes(key)));
  }
});

test('driver editor exposes the three ADC pin voltage conversion fields with units and existing edit bindings', () => {
  const project = createProject(), driver = createDriver();
  Object.assign(driver, values);
  project.catalog.drivers.push(driver);
  const html = renderEquipment(project, [], 'drivers', driver.id);
  for (const key of keys) {
    assert.match(html, new RegExp(`data-edit="driver" data-key="${key}"`));
    assert.match(html, new RegExp(`value="${values[key]}"`));
  }
  assert.match(html, /A\/V/);
  assert.match(html, /V\/V/);
  assert.match(html, /ADC 引脚电压 × 系数 = 实际相电流/);
  assert.match(html, /ADC 引脚电压 × 系数 = 实际端电压/);
  assert.match(html, /ADC 引脚电压 × 系数 = 实际母线电压/);
  assert.doesNotMatch(html, /A\/count|V\/count|ADC 原始数值/);
});
