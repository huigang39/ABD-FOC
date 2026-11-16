import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { createActuator, createDriver, createJointModule } from '../web/src/features/equipment/model.mjs';
import { PERFORMANCE_LIMITS } from '../web/src/features/performance/model.mjs';
import { createPerformanceController } from '../web/src/features/performance/controller.mjs';

function fixture() {
  let project = createProject(), controller, currentRoute = {}, renderedDraft;
  const events = { routes: [], renders: [], notices: [], commits: [] };
  const assemblies = ['A', 'B'].map(name => {
    const actuator = createActuator(`执行器 ${name}`), driver = createDriver(`驱动器 ${name}`);
    project.catalog.actuators.push(actuator); project.catalog.drivers.push(driver);
    const assembly = createJointModule(project, { name: `关节模组 ${name}`, actuatorId: actuator.id, driverId: driver.id });
    project.catalog.assemblies.push(assembly); return assembly;
  });
  project.catalog.activeAssemblyId = assemblies[0].id;
  const render = formOnly => {
    events.renders.push(Boolean(formOnly));
    renderedDraft = controller.state(currentRoute);
  };
  const visit = hash => {
    const [path, query = ''] = hash.replace(/^#\/?/, '').split('?'), params = new URLSearchParams(query);
    currentRoute = { page: path.split('/')[0], id: path.split('/')[1], assemblyId: params.get('assembly') };
    events.routes.push(hash); render();
  };
  controller = createPerformanceController({
    getProject: () => project,
    commit: next => { events.commits.push(structuredClone(next)); project = next; project.revision++; render(); },
    render, navigate: visit,
    notify: (message, options) => events.notices.push({ message, ...options }),
  });
  const field = (key, value, type = 'text') => controller.edit({ dataset: { performanceField: key }, value: String(value), type });
  const cell = (index, key, value, type = key === 'series' ? 'text' : 'number') => controller.edit({ dataset: { performanceRow: String(index), performanceKey: key }, value: String(value), type });
  const point = (x, torque, series = '') => {
    controller.action('performance-add-row');
    const index = controller.state().samples.length - 1;
    cell(index, controller.state().kind === 'kt' ? 'currentA' : 'speedRpm', x); cell(index, 'torqueNm', torque); cell(index, 'series', series);
  };
  visit(`#/performance?assembly=${encodeURIComponent(assemblies[0].id)}`);
  return { controller, events, assemblies, field, cell, point, visit, render, get project() { return project; }, get renderedDraft() { return renderedDraft; } };
}

test('switching the assembly dropdown from query A to B survives immediate and repeated rendering', () => {
  const h = fixture(), [a, b] = h.assemblies;
  h.point(1, 8, 'A');
  assert.equal(h.controller.state().assemblyId, a.id);
  assert.equal(h.field('assemblyId', b.id), true);
  assert.equal(h.events.routes.at(-1), `#/performance?assembly=${encodeURIComponent(b.id)}`);
  h.point(2, 15, 'B'); h.render(); h.render(true);
  assert.equal(h.controller.state().assemblyId, b.id);
  assert.equal(h.renderedDraft.assemblyId, b.id);
  assert.deepEqual(h.controller.state().samples, [{ currentA: 2, torqueNm: 15, series: 'B' }]);
  h.visit(`#/performance?assembly=${a.id}`);
  assert.deepEqual(h.controller.state().samples, [{ currentA: 1, torqueNm: 8, series: 'A' }]);
});

test('Kt and TN keep independent unsaved tables, names, conditions and CSV text', () => {
  const h = fixture();
  h.field('name', 'Kt 原始表'); h.field('conditions.durationS', '8', 'number'); h.field('csvText', '电流,力矩\n1,8'); h.point(1, 8);
  const kt = structuredClone(h.controller.state());
  h.field('kind', 'tn_curve');
  assert.equal(h.controller.state().kind, 'tn_curve'); assert.deepEqual(h.controller.state().samples, []);
  h.field('name', 'TN 回程'); h.field('conditions.durationS', '12', 'number'); h.field('csvText', '转速,力矩\n200,5'); h.point(200, 5, '回程');
  const tn = structuredClone(h.controller.state());
  h.field('kind', 'kt'); assert.deepEqual(h.controller.state(), kt);
  h.field('kind', 'tn_curve'); assert.deepEqual(h.controller.state(), tn);
  h.field('kind', 'tn_curve'); assert.deepEqual(h.controller.state(), tn);
  assert.equal(h.controller.hasUnsavedDraft(), true);
});

test('assembly and table type jointly identify isolated drafts', () => {
  const h = fixture(), [a, b] = h.assemblies;
  for (const [assembly, kind, value] of [[a, 'kt', 1], [a, 'tn_curve', 100], [b, 'kt', 2], [b, 'tn_curve', 200]]) {
    h.field('assemblyId', assembly.id); h.field('kind', kind); h.point(value, value / 2, assembly.name);
  }
  for (const [assembly, kind, value] of [[b, 'kt', 2], [a, 'tn_curve', 100], [b, 'tn_curve', 200], [a, 'kt', 1]]) {
    h.field('assemblyId', assembly.id); h.field('kind', kind);
    const key = kind === 'kt' ? 'currentA' : 'speedRpm';
    assert.deepEqual(h.controller.state().samples, [{ [key]: value, torqueNm: value / 2, series: assembly.name }]);
    assert.equal(h.controller.state().assemblyId, assembly.id);
  }
  assert.equal(h.project.performance.records.length, 0);
});

test('invalid CSV does not replace manually entered samples or commit project data', () => {
  const h = fixture(); h.point(1, 8, '实测');
  const original = structuredClone(h.controller.state().samples);
  h.field('csvText', 'busCurrentA,torqueNm\n1,9');
  assert.equal(h.controller.action('performance-parse'), true);
  assert.deepEqual(h.controller.state().samples, original);
  assert.equal(h.events.notices.at(-1).level, 'error');
  assert.equal(h.events.commits.length, 0); assert.equal(h.controller.hasUnsavedDraft(), true);
  h.field('csvText', 'currentA,torqueNm,series\n2,15,正向\n1,8,回程');
  h.controller.action('performance-parse');
  assert.deepEqual(h.controller.state().samples, [{ currentA: 2, torqueNm: 15, series: '正向' }, { currentA: 1, torqueNm: 8, series: '回程' }]);
  assert.equal(h.events.notices.at(-1).level, 'success'); assert.equal(h.events.commits.length, 0);
});

test('saving records the selected assembly and measured table, strips temporary CSV and clears its dirty state', () => {
  const h = fixture(), b = h.assemblies[1];
  h.field('assemblyId', b.id); h.field('kind', 'tn_curve'); h.field('name', 'B 的 TN');
  h.field('measuredAt', '2026-11-15T15:30'); h.field('firmwareId', 'release-75h-r4');
  h.field('csvText', 'speedRpm,torqueNm,series\n200,6,回程\n100,7,回程'); h.controller.action('performance-parse');
  assert.equal(h.controller.hasUnsavedDraft(), true);
  const originalSamples = structuredClone(h.controller.state().samples);
  h.controller.action('performance-save');
  assert.equal(h.events.commits.length, 1); assert.equal(h.controller.hasUnsavedDraft(), false);
  const record = h.project.performance.records[0];
  assert.equal(record.assemblyId, b.id); assert.equal(record.snapshot.assembly.driverId, b.driverId);
  assert.equal(record.snapshot.assembly.actuatorId, b.actuatorId); assert.equal(record.kind, 'tn_curve');
  assert.equal(record.firmwareId, 'release-75h-r4'); assert.equal(Object.hasOwn(record, 'csvText'), false);
  assert.deepEqual(record.samples, originalSamples);
  assert.equal(h.events.routes.at(-1), `#/performance/${encodeURIComponent(record.id)}`);
  assert.equal(h.events.notices.at(-1).level, 'success');
});

test('saving one draft leaves another assembly draft dirty and untouched', () => {
  const h = fixture(), [a, b] = h.assemblies;
  h.point(1, 8); const aSamples = structuredClone(h.controller.state().samples);
  h.field('assemblyId', b.id); h.field('measuredAt', '2026-11-15T12:30'); h.point(2, 15);
  h.controller.action('performance-save');
  assert.equal(h.project.performance.records.length, 1); assert.equal(h.controller.hasUnsavedDraft(), true);
  h.field('assemblyId', a.id);
  assert.deepEqual(h.controller.state().samples, aSamples);
  assert.equal(h.controller.state().measuredAt, '');
});

test('empty numeric inputs stay unknown instead of becoming zero, and invalid saves preserve the draft', () => {
  const h = fixture(); h.controller.action('performance-add-row');
  h.cell(0, 'currentA', ''); h.cell(0, 'torqueNm', ' '); h.field('conditions.busVoltageV', '', 'number');
  h.field('measuredAt', '2026-11-15T12:30');
  assert.deepEqual(h.controller.state().samples, [{ currentA: null, torqueNm: null, series: '' }]);
  assert.equal(h.controller.state().conditions.busVoltageV, null);
  h.controller.action('performance-save');
  assert.equal(h.events.commits.length, 0); assert.equal(h.events.notices.at(-1).level, 'error');
  assert.equal(h.controller.hasUnsavedDraft(), true); assert.equal(h.controller.state().samples[0].currentA, null);
  h.cell(0, 'currentA', '0'); h.cell(0, 'torqueNm', '0'); h.controller.action('performance-save');
  assert.equal(h.events.commits.length, 1); assert.equal(h.controller.hasUnsavedDraft(), false);
  assert.deepEqual(h.project.performance.records[0].samples, [{ currentA: 0, torqueNm: 0, series: '' }]);
});

test('unrelated actions and controls do not claim ownership or change performance state', () => {
  const h = fixture(), original = structuredClone(h.controller.state());
  assert.equal(h.controller.action('save'), false);
  assert.equal(h.controller.edit({ dataset: { scope: 'project' }, type: 'text', value: 'project' }), false);
  assert.deepEqual(h.controller.state(), original); assert.equal(h.controller.hasUnsavedDraft(), false);
  assert.equal(h.events.commits.length, 0);
});

test('row additions enforce the per-record limit without dropping existing points', () => {
  const h = fixture();
  h.controller.state().samples = Array.from({ length: PERFORMANCE_LIMITS.samplesPerRecord }, (_, i) => ({ currentA: i, torqueNm: i, series: '' }));
  const before = structuredClone(h.controller.state().samples);
  h.controller.action('performance-add-row');
  assert.deepEqual(h.controller.state().samples, before); assert.equal(h.events.notices.at(-1).level, 'error');
});
