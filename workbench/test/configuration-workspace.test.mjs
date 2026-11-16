import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { createActuator, createDriver, createBinding, getActiveActuator, getActiveDriver, getAssemblySummary, assetFingerprint, validateEquipment } from '../web/src/features/equipment/model.mjs';
import { createPerformanceDraft, savePerformanceRecord } from '../web/src/features/performance/model.mjs';
import { getCurrentLoopDesign } from '../web/src/modules/algorithm/foc-current/design.mjs';
import { renderExtras as renderFeedback } from '../web/src/modules/algorithm/foc-feedback/view.mjs';
import { inspectFirmwareSupport } from '../native/firmware.mjs';
import { getConfigurationSelection, selectConfigurationActuator, selectConfigurationDriver, beginCustomHardware, applyImportedConfiguration, exportConfiguration } from '../web/src/features/configuration/workspace.mjs';

function recorded() {
  const source = createNeo75hProject('KW'), draft = createPerformanceDraft(source);
  draft.measuredAt = '2026-11-15T12:00:00Z'; draft.samples = [{ currentA: 1, torqueNm: 8, series: '正向' }];
  return savePerformanceRecord(source, draft);
}
function motor(name = '新执行器') {
  const actuator = createActuator(name);
  Object.assign(actuator.motor, { polePairs: 11, resistanceOhm: 0.2, inductanceDH: 0.0003, inductanceQH: 0.0004, maxCurrentA: 8 });
  return actuator;
}
const sizes = project => ['actuators', 'drivers', 'assemblies'].map(key => project.catalog[key].length);

test('actuator selection is independently saveable and feeds bandwidth and electrical-angle parameters without a joint assembly', () => {
  const current = createProject(), actuator = motor(); current.catalog.actuators.push(actuator);
  current.instances['foc-current'].parameters.bandwidthHz = 500;
  current.instances['hw-board'].parameters.pwmHz = 20000;
  current.instances['hw-board'].parameters.currentLoopDivider = 1;
  const before = structuredClone(current), selected = selectConfigurationActuator(current, actuator.id);
  assert.deepEqual(current, before); assert.equal(selected.catalog.activeActuatorId, actuator.id);
  assert.equal(selected.catalog.activeAssemblyId, ''); assert.equal(selected.catalog.assemblies.length, 0);
  assert.equal(getActiveActuator(selected).id, actuator.id); assert.equal(getAssemblySummary(selected).actuator.id, actuator.id);
  const design = getCurrentLoopDesign(selected);
  assert.equal(design.actuator.id, actuator.id); assert.equal(design.gains.kpD, 2 * Math.PI * 500 * actuator.motor.inductanceDH);
  assert.match(renderFeedback({ project: selected, escape: String }), /极对数 11/);
  assert.equal(parseProject(serializeProject(selected)).catalog.activeActuatorId, actuator.id);
  assert.equal(validateProject(selected).some(issue => issue.id === 'equipment-actuator-selection'), false);
  const view = getConfigurationSelection(selected); view.actuator.motor.polePairs = 99;
  assert.equal(getActiveActuator(selected).motor.polePairs, 11);
});

test('driver reuse retains the selected actuator, copies hardware and does not overwrite algorithm or application settings', () => {
  let current = createProject(); const actuator = motor(), source = createNeo75hProject('KW'), driver = source.catalog.drivers[0];
  current.catalog.actuators.push(actuator); current.catalog.drivers.push(structuredClone(driver));
  current = selectConfigurationActuator(current, actuator.id);
  current.instances['foc-current'].parameters.bandwidthHz = 321;
  current.instances['app-motion'].parameters.outerHz = 333;
  const before = structuredClone(current), selected = selectConfigurationDriver(current, driver.id);
  assert.deepEqual(current, before); assert.equal(selected.catalog.activeActuatorId, actuator.id);
  assert.equal(selected.catalog.activeDriverId, driver.id); assert.equal(selected.catalog.activeAssemblyId, '');
  assert.equal(selected.catalog.assemblies.length, 0); assert.equal(getConfigurationSelection(selected).hardwareMode, 'reuse');
  assert.deepEqual(selected.target, source.target); assert.deepEqual(selected.memory.layout, driver.memoryLayout);
  assert.equal(selected.instances['hw-board'].parameters.pwmHz, driver.pwmHz);
  assert.equal(selected.instances['foc-current'].parameters.bandwidthHz, 321); assert.equal(selected.instances['app-motion'].parameters.outerHz, 333);
});

test('changing independent selection leaves saved combinations and measurement snapshots untouched', () => {
  const current = recorded(), actuator = motor('备选执行器'); current.catalog.actuators.push(actuator);
  const originalAssembly = structuredClone(current.catalog.assemblies[0]), history = structuredClone(current.performance);
  const selected = selectConfigurationActuator(current, actuator.id);
  assert.equal(selected.catalog.activeAssemblyId, ''); assert.equal(selected.catalog.activeActuatorId, actuator.id);
  assert.equal(selected.catalog.activeDriverId, current.catalog.activeDriverId);
  assert.deepEqual(selected.catalog.assemblies[0], originalAssembly); assert.deepEqual(selected.performance, history);
  assert.equal(getCurrentLoopDesign(selected).actuator.id, actuator.id);
});

test('custom hardware keeps editable hardware and actuator selection, without modifying shelf drivers', () => {
  const current = recorded(), before = structuredClone(current), next = beginCustomHardware(current);
  assert.deepEqual(current, before); assert.equal(next.catalog.activeDriverId, ''); assert.equal(next.catalog.activeAssemblyId, '');
  assert.equal(next.catalog.activeActuatorId, current.catalog.activeActuatorId);
  assert.equal(getConfigurationSelection(next).hardwareMode, 'custom'); assert.equal(getActiveDriver(next), null);
  assert.deepEqual(next.target, current.target); assert.deepEqual(next.instances, current.instances); assert.deepEqual(next.memory, current.memory);
  assert.deepEqual(next.catalog.drivers, current.catalog.drivers); assert.deepEqual(next.catalog.assemblies, current.catalog.assemblies);
  assert.deepEqual(next.performance, current.performance);
});

test('missing selection IDs fail without changing shelf, control configuration or measurement data', () => {
  const current = recorded(), before = structuredClone(current);
  assert.throws(() => selectConfigurationActuator(current, 'missing'), /执行器/);
  assert.throws(() => selectConfigurationDriver(current, 'missing'), /驱动器/);
  assert.deepEqual(current, before);
});

test('importing a blank configuration preserves global shelf/history and the console identity', () => {
  const current = recorded(), incoming = createProject(), before = structuredClone(current), source = structuredClone(incoming);
  incoming.name = '空白控制配置'; incoming.instances['foc-current'].parameters.bandwidthHz = 123;
  const next = applyImportedConfiguration(current, incoming);
  assert.deepEqual(current, before); assert.equal(incoming.id, source.id);
  assert.equal(next.id, current.id); assert.equal(next.revision, current.revision); assert.equal(next.updatedAt, current.updatedAt);
  assert.equal(next.name, incoming.name); assert.equal(next.instances['foc-current'].parameters.bandwidthHz, 123);
  for (const key of ['actuators', 'drivers', 'assemblies']) assert.deepEqual(next.catalog[key], current.catalog[key]);
  assert.deepEqual(next.performance, current.performance);
  assert.equal(next.catalog.activeActuatorId, ''); assert.equal(next.catalog.activeDriverId, ''); assert.equal(next.catalog.activeAssemblyId, '');
  assert.deepEqual(parseProject(serializeProject(next)).performance, current.performance);
});

test('configuration imports add new assets but never import or replace measurement history', () => {
  const current = recorded(), incoming = recorded();
  incoming.performance.records[0].name = '不属于当前控制台的测试记录';
  const next = applyImportedConfiguration(current, incoming);
  assert.deepEqual(sizes(next), [2, 2, 2]); assert.deepEqual(next.performance, current.performance);
  assert.equal(next.catalog.activeAssemblyId, incoming.catalog.activeAssemblyId);
  assert.equal(getActiveActuator(next).id, incoming.catalog.activeActuatorId);
  assert.equal(getActiveDriver(next).id, incoming.catalog.activeDriverId);
  assert.equal(getAssemblySummary(next).stale, false);
});

test('same-ID identical assets are reused and repeated import is idempotent', () => {
  const current = recorded(), incoming = parseProject(exportConfiguration(current)), before = structuredClone(current);
  const next = applyImportedConfiguration(current, incoming), twice = applyImportedConfiguration(next, incoming);
  assert.deepEqual(current, before); assert.deepEqual(sizes(next), sizes(current));
  assert.deepEqual(twice, next); assert.deepEqual(next.performance, current.performance);
});

test('conflicting component and assembly IDs create copies and remap the entire selected pair', () => {
  const current = recorded(), original = structuredClone(current), incoming = parseProject(exportConfiguration(current));
  incoming.catalog.actuators[0].motor.polePairs += 1;
  incoming.catalog.drivers[0].deadtimeNs += 100;
  incoming.catalog.drivers[0].hardware['hw-board'].deadtimeNs = incoming.catalog.drivers[0].deadtimeNs;
  incoming.catalog.appliedFingerprint = assetFingerprint(incoming.catalog, incoming.catalog.activeAssemblyId);
  const next = applyImportedConfiguration(current, incoming), selection = getConfigurationSelection(next);
  assert.deepEqual(current, original); assert.deepEqual(sizes(next), [2, 2, 2]);
  assert.notEqual(selection.actuator.id, incoming.catalog.actuators[0].id); assert.notEqual(selection.driver.id, incoming.catalog.drivers[0].id);
  assert.notEqual(selection.assembly.id, incoming.catalog.assemblies[0].id);
  assert.equal(selection.assembly.actuatorId, selection.actuator.id); assert.equal(selection.assembly.driverId, selection.driver.id);
  assert.equal(next.catalog.activeActuatorId, selection.actuator.id); assert.equal(next.catalog.activeDriverId, selection.driver.id);
  assert.equal(selection.actuator.motor.polePairs, incoming.catalog.actuators[0].motor.polePairs);
  assert.equal(selection.driver.deadtimeNs, incoming.catalog.drivers[0].deadtimeNs);
  assert.deepEqual(next.catalog.actuators[0], original.catalog.actuators[0]); assert.deepEqual(next.catalog.drivers[0], original.catalog.drivers[0]);
  assert.deepEqual(next.catalog.assemblies[0], original.catalog.assemblies[0]); assert.deepEqual(next.performance, original.performance);
  assert.equal(getAssemblySummary(next).stale, false);
  assert.notEqual(next.catalog.appliedFingerprint, incoming.catalog.appliedFingerprint);
  assert.deepEqual(applyImportedConfiguration(next, incoming), next);
});

test('copy allocation skips occupied IDs and preserves a prior copy for repeat imports', () => {
  const current = recorded(), incoming = parseProject(exportConfiguration(current)), originalId = incoming.catalog.activeActuatorId;
  current.catalog.actuators.push({ ...structuredClone(current.catalog.actuators[0]), id: `${originalId}-import-2`, name: '独立条目' });
  incoming.catalog.actuators[0].motor.polePairs += 1;
  const next = applyImportedConfiguration(current, incoming);
  assert.equal(next.catalog.activeActuatorId, `${originalId}-import-3`);
  assert.deepEqual(sizes(applyImportedConfiguration(next, incoming)), sizes(next));
  assert.equal(next.catalog.actuators.find(item => item.id === `${originalId}-import-2`).name, '独立条目');
});

test('invalid schema, selected references and assembly references reject the whole import without mutations', () => {
  const current = recorded(), before = structuredClone(current);
  for (const mutate of [
    input => { input.unexpected = true; },
    input => { input.catalog.activeActuatorId = 'missing'; },
    input => { input.catalog.activeDriverId = 'missing'; },
    input => { input.catalog.activeAssemblyId = 'missing'; },
    input => { input.catalog.assemblies[0].actuatorId = 'missing'; },
    input => { input.catalog.actuators[0].motor.polePairs = Infinity; },
    input => { input.catalog.actuators.push(structuredClone(input.catalog.actuators[0])); },
    input => { const other = motor(); input.catalog.actuators.push(other); input.catalog.activeActuatorId = other.id; },
  ]) {
    const incoming = parseProject(exportConfiguration(current)); mutate(incoming); const inputBefore = structuredClone(incoming);
    assert.throws(() => applyImportedConfiguration(current, incoming));
    assert.deepEqual(current, before); assert.deepEqual(incoming, inputBefore);
  }
});

test('portable configuration contains only the selected asset closure and no global performance history', () => {
  const current = recorded(); current.catalog.actuators.push(motor('不相关执行器')); current.catalog.drivers.push(createDriver('不相关驱动器'));
  const before = structuredClone(current), exported = parseProject(exportConfiguration(current));
  assert.deepEqual(current, before); assert.deepEqual(sizes(exported), [1, 1, 1]); assert.deepEqual(exported.performance.records, []);
  assert.equal(getActiveActuator(exported).id, current.catalog.activeActuatorId); assert.equal(getActiveDriver(exported).id, current.catalog.activeDriverId);
  assert.deepEqual(exported.instances, current.instances); assert.deepEqual(exported.design, current.design); assert.deepEqual(exported.build, current.build);
  assert.equal(configurationFingerprint(exported), configurationFingerprint(current));
  const selected = selectConfigurationActuator(current, current.catalog.actuators[1].id), independent = parseProject(exportConfiguration(selected));
  assert.deepEqual(sizes(independent), [1, 1, 0]); assert.equal(independent.catalog.activeAssemblyId, '');
  const custom = parseProject(exportConfiguration(beginCustomHardware(selected)));
  assert.deepEqual(sizes(custom), [1, 0, 0]); assert.deepEqual(custom.target, selected.target); assert.deepEqual(custom.instances, selected.instances);
});

test('the selected asset footprint ignores global shelf additions, removals, edits and order', () => {
  const current = recorded(), fingerprint = configurationFingerprint(current);
  const unused = motor('货架草稿'), driver = createDriver('货架草稿'); current.catalog.actuators.push(unused); current.catalog.drivers.push(driver);
  unused.motor.polePairs = 19; driver.adcBits = 10; current.catalog.actuators.reverse();
  current.catalog.appliedFingerprint = 'display bookkeeping';
  assert.equal(configurationFingerprint(current), fingerprint);
  current.catalog.drivers.pop(); assert.equal(configurationFingerprint(current), fingerprint);
  for (const mutate of [
    next => { getActiveActuator(next).motor.polePairs += 1; },
    next => { getActiveDriver(next).deadtimeNs += 1; },
    next => { next.instances['foc-current'].parameters.bandwidthHz += 1; },
    next => { next.catalog.activeActuatorId = unused.id; next.catalog.activeAssemblyId = ''; },
  ]) {
    const changed = structuredClone(current); mutate(changed); assert.notEqual(configurationFingerprint(changed), fingerprint);
  }
});

test('unselected shelf mistakes remain visible to the shelf but do not block active configuration validation', () => {
  const current = createNeo75hProject('KW'), driver = createDriver('未完成的其他驱动器');
  driver.adcBits = -1; driver.bindings.push({ ...createBinding(), signal: 'x', pin: 'PA0', peripheral: 'ADC1' }, { ...createBinding(), signal: 'x', pin: 'PA0', peripheral: 'ADC1' });
  current.catalog.drivers.push(driver);
  assert.ok(validateEquipment(current).some(issue => issue.itemId === driver.id && issue.level === 'error'));
  assert.equal(validateProject(current).some(issue => issue.itemId === driver.id && issue.level === 'error'), false);
  assert.equal(inspectFirmwareSupport(current).sourceIssues.some(issue => issue.code==='validation'),false);
  getActiveDriver(current).adcBits = -1;
  assert.ok(validateProject(current).some(issue => issue.itemId === current.catalog.activeDriverId && issue.level === 'error'));
});

test('native motor parameters use independent actuator selection even without a saved assembly', () => {
  const current = createNeo75hProject('KW'), actuator = structuredClone(current.catalog.actuators[0]);
  actuator.id = 'independent-current-actuator'; actuator.motor.polePairs = 13; current.catalog.actuators.push(actuator);
  current.catalog.activeActuatorId = actuator.id; current.catalog.activeAssemblyId = ''; current.catalog.appliedFingerprint = '';
  assert.equal(getCurrentLoopDesign(current).actuator.id, actuator.id);
  const report = inspectFirmwareSupport(current);
  assert.equal(Number(report.parameters['foc-feedback.pole_pairs']), 13);
  assert.equal(report.issues.some(issue=>issue.code==='assembly'),false);
});

test('NEO custom hardware followed by driver reuse retains its explicit source limit and native support', () => {
  const current = createNeo75hProject('KW'), driverId = current.catalog.activeDriverId;
  const configuredLimit = current.instances['app-motion'].parameters.currentLimitA;
  assert.ok(configuredLimit > 0); assert.equal(getActiveDriver(current).maxCurrentA, null);
  const before = structuredClone(current), next = selectConfigurationDriver(beginCustomHardware(current), driverId);
  assert.deepEqual(current, before);
  assert.equal(next.instances['app-motion'].parameters.currentLimitA, configuredLimit);
  assert.equal(next.catalog.activeActuatorId, current.catalog.activeActuatorId);
  assert.ok(validateProject(next).some(issue => issue.id === 'equipment-current-unknown' && issue.level === 'pending'));
  assert.equal(inspectFirmwareSupport(next).sourceIssues.some(issue=>issue.code==='validation'),false);
});

test('unknown actuator and driver current boundaries preserve user values while known bounds only tighten', () => {
  let current = createProject(); const actuator = motor(), driver = createDriver('额定值待核对');
  actuator.motor.maxCurrentA = null;
  current.catalog.actuators.push(actuator); current.catalog.drivers.push(driver);
  current.instances['app-motion'].parameters.currentLimitA = 5;
  current = selectConfigurationActuator(current, actuator.id);
  assert.equal(current.instances['app-motion'].parameters.currentLimitA, 5);
  current = selectConfigurationDriver(current, driver.id);
  assert.equal(current.instances['app-motion'].parameters.currentLimitA, 5);
  assert.ok(validateProject(current).some(issue => issue.id === 'equipment-current-unknown' && issue.level === 'pending'));
  getActiveDriver(current).maxCurrentA = 3;
  current = selectConfigurationDriver(current, driver.id);
  assert.equal(current.instances['app-motion'].parameters.currentLimitA, 3);
  getActiveActuator(current).motor.maxCurrentA = 2;
  current = selectConfigurationActuator(current, actuator.id);
  assert.equal(current.instances['app-motion'].parameters.currentLimitA, 2);
  getActiveActuator(current).motor.maxCurrentA = 10; getActiveDriver(current).maxCurrentA = 8;
  assert.equal(selectConfigurationActuator(selectConfigurationDriver(current, driver.id), actuator.id).instances['app-motion'].parameters.currentLimitA, 2);
  current.instances['app-motion'].parameters.currentLimitA = null;
  assert.equal(selectConfigurationActuator(selectConfigurationDriver(current, driver.id), actuator.id).instances['app-motion'].parameters.currentLimitA, null);
});
