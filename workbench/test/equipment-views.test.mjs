import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { createActuator, createAssembly, createCatalog, createDriver } from '../web/src/features/equipment/model.mjs';
import { renderEquipment } from '../web/src/features/equipment/view.mjs';

function fixture() {
  const project = createProject();
  const actuator = createActuator('执行器 A <75>');
  const driver = createDriver('驱动器 D & 24');
  const complete = { ...createAssembly('完整搭配'), actuatorId: actuator.id, driverId: driver.id };
  const empty = createAssembly('待选择组件');
  const missing = { ...createAssembly('缺少驱动器'), actuatorId: actuator.id, driverId: 'removed-driver' };
  project.catalog = {
    ...createCatalog(),
    actuators: [actuator, createActuator('执行器 B')],
    drivers: [driver, createDriver('驱动器 E')],
    assemblies: [empty, complete, missing],
  };
  return { project, actuator, driver, complete, empty, missing };
}

const navigation = html => html.match(/<nav class="equipment-tabs[^]*?<\/nav>/)?.[0] || '';
const equipmentList = html => html.match(/<div data-live="equipment-list">([^]*?)<\/aside>/)?.[1] || '';
const editor = html => html.slice(html.indexOf('<section class="design-editor"'));
const select = (html, key) => [...html.matchAll(/<select\b[^]*?<\/select>/g)].map(match => match[0]).find(markup => markup.includes('data-edit="assembly"') && markup.includes(`data-key="${key}"`));
const actionButton = (html, action) => [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(markup => markup.includes(`data-action="${action}"`));

test('shelf counts only complete joint modules and separates reusable components', () => {
  const { project } = fixture();
  const html = renderEquipment(project, []);
  const nav = navigation(html);
  assert.match(nav, /产品<\/span>[^]*?href="#\/equipment\/assemblies"[^>]*>关节模组<span>1<\/span>/);
  assert.match(nav, /组件库<\/span>[^]*?href="#\/equipment\/actuators"[^>]*>执行器<span>2<\/span>[^]*?href="#\/equipment\/drivers"[^>]*>驱动器<span>2<\/span>/);
  assert.match(equipmentList(html), /已组装 · 1/);
  assert.match(equipmentList(html), /待完成搭配 · 2/);
  assert.match(editor(html), /data-live="equipment-title">完整搭配<\/h2>/);
  assert.match(html, /data-action="add-assembly"[^>]*>组装关节模组 →<\/button>/);
  assert.doesNotMatch(html, />新建关节模组<\/button>/);
  assert.match(renderEquipment(project, [], 'assemblies', 'new'), /id="assembly-builder" tabindex="-1"/);
});

test('saved module list identifies both actual components with separate colors and retains incomplete entries', () => {
  const { project, complete, empty, missing } = fixture();
  project.catalog.activeAssemblyId = complete.id;
  const list = equipmentList(renderEquipment(project, []));
  assert.match(list, /class="asset-kind asset-kind-actuator" title="执行器">执行器 A &lt;75&gt;<\/span>/);
  assert.match(list, /class="asset-kind asset-kind-driver" title="驱动器">驱动器 D &amp; 24<\/span>/);
  assert.match(list, /当前选型/);
  for (const assembly of [complete, empty, missing]) {
    assert.ok(list.includes(`href="#/equipment/assemblies/${assembly.id}"`), `${assembly.name} remains editable`);
  }
  assert.ok(list.indexOf('完整搭配') < list.indexOf('待选择组件'));
  assert.match(list, /驱动器待选择/);
  assert.doesNotMatch(list, /执行器 A <75>/);
});

test('editing a complete module keeps both component choices required', () => {
  const { project, complete, actuator, driver } = fixture();
  const html = renderEquipment(project, [], 'assemblies', complete.id);
  for (const [key, component] of [['actuatorId', actuator], ['driverId', driver]]) {
    const control = select(html, key);
    assert.ok(control);
    assert.doesNotMatch(control, /<option value=""/);
    assert.ok(control.includes(`<option value="${component.id}" selected>`));
  }
  assert.doesNotMatch(actionButton(html, 'apply-assembly'), /\bdisabled\b/);
});

test('missing or empty component references stay visible and cannot be applied', () => {
  const { project, missing, empty } = fixture();
  const before = structuredClone(project);
  project.catalog.activeAssemblyId = missing.id;
  const missingHtml = renderEquipment(project, [], 'assemblies', missing.id);
  assert.match(select(missingHtml, 'driverId'), /<option value="removed-driver" selected disabled hidden>驱动器已移除 · 待选择<\/option>/);
  assert.match(editor(missingHtml), /data-live="assembly-state"[^]*?待完成搭配/);
  assert.doesNotMatch(editor(missingHtml), />已应用<\/span>/);
  assert.match(actionButton(missingHtml, 'apply-assembly'), /\bdisabled\b/);
  const emptyHtml = renderEquipment(project, [], 'assemblies', empty.id);
  assert.match(select(emptyHtml, 'actuatorId'), /<option value="" selected hidden disabled>—<\/option>/);
  assert.match(select(emptyHtml, 'driverId'), /<option value="" selected hidden disabled>—<\/option>/);
  assert.match(actionButton(emptyHtml, 'apply-assembly'), /\bdisabled\b/);
  assert.deepEqual(project.catalog.assemblies, before.catalog.assemblies);
});

test('assembly draft can be saved only after selecting two existing components', () => {
  const { project, actuator, driver } = fixture();
  for (const draft of [
    { name: '', actuatorId: '', driverId: '' },
    { name: '', actuatorId: actuator.id, driverId: '' },
    { name: '', actuatorId: actuator.id, driverId: 'removed-driver' },
    { name: '', actuatorId: 'removed-actuator', driverId: driver.id },
  ]) {
    assert.match(actionButton(renderEquipment(project, [], 'assemblies', 'new', draft), 'save-joint'), /\bdisabled\b/);
  }
  const completeDraft = { name: '新模组', actuatorId: actuator.id, driverId: driver.id };
  assert.doesNotMatch(actionButton(renderEquipment(project, [], 'assemblies', 'new', completeDraft), 'save-joint'), /\bdisabled\b/);
});

test('component libraries remain usable without creating joint modules', () => {
  const { project, actuator, driver } = fixture();
  project.catalog.assemblies = [];
  for (const [group, selected, label] of [['actuators', actuator, '执行器'], ['drivers', driver, '驱动器']]) {
    const html = renderEquipment(project, [], group, selected.id);
    assert.match(navigation(html), /href="#\/equipment\/assemblies"[^>]*>关节模组<span>0<\/span>/);
    assert.ok(equipmentList(html).includes(`${label}组件 · 2`));
    assert.doesNotMatch(html, /data-action="save-joint"/);
    assert.match(html, new RegExp(`>${label}组件<\\/span>`));
  }
});
