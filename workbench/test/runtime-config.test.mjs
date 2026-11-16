import test from 'node:test';
import assert from 'node:assert/strict';
import { newModuleProject } from './support/new-project.mjs';
import { runtimeConfiguration, renderRuntimeConfiguration } from '../web/src/features/configuration/runtime-config.mjs';
test('runtime list follows compiled modules and exposes only configurable values', () => {
  const project = newModuleProject();
  project.instances['foc-observer'].enabled = false;
  project.instances['foc-compensation'].runtimeEnabled = false;
  const catalog = runtimeConfiguration(project);
  assert(!catalog.entries.some(e => e.moduleId === 'foc-observer'));
  assert.equal(catalog.entries.find(e => e.id === 'foc-compensation.runtimeEnabled').value, false);
  assert(!catalog.entries.some(e => e.id === 'foc-current.runtimeEnabled' || e.key === 'kpD'));
  assert.equal(catalog.entries.find(e => e.id === 'foc-current.decoupling').apply, 'control-boundary');
  assert.equal(catalog.entries.find(e => e.key === 'bandwidthHz').apply, 'control-boundary');
  assert.equal(catalog.entries.find(e => e.id === 'hw-board.pwmHz').apply, 'reinitialize');
  assert.equal(new Set(catalog.entries.map(e => e.id)).size, catalog.entries.length);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(catalog)));
});
test('list edits reuse module fields and runtime actions', () => {
  const project = newModuleProject();
  const html = renderRuntimeConfiguration(project, (field,value,scope,id) => `<input id="module-${id}-${field.key}" data-scope="${scope}">`);
  assert.match(html, /data-action="toggle-runtime"/);
  assert.match(html, /id="runtime-list-module-foc-current-bandwidthHz"/);
  assert.match(html, /data-action="export-runtime-config"/);
});
