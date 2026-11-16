import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { fixedAlgorithmChildren } from '../web/src/modules/algorithm/children.mjs';
import { renderResourceEditor } from '../web/src/features/configuration/hardware-view.mjs';

const mcu = 'STM32H745IIK6';
const calibration = project => fixedAlgorithmChildren(project, 'foc-compensation').find(child => child.type === 'current_calibration');
const resources = project => project.instances['hw-board'].parameters.resources;

test('current sampling displays the existing calibration fields without creating or enabling a child during rendering', () => {
  const project = createProject(), child = calibration(project), before = structuredClone([project, child]);
  const html = renderResourceEditor(mcu, resources(project), { currentCalibration: child });
  assert.equal((html.match(/class="current-sampling-channel current-calibration-settings"/g) || []).length, 1);
  assert(html.indexOf('current-sampling-channel current-calibration-settings') > html.indexOf('data-current-channel="3"'));
  assert(html.indexOf('current-sampling-channel current-calibration-settings') < html.indexOf('<strong>母线电压采样</strong>'));
  assert.match(html, /aria-label="电流零偏"><h4>电流零偏<\/h4><div class="profile-form">/);
  for (const key of ['captureOnEnable','sampleIntervalUs','settlingMs','durationMs','pwmEnabled']) {
    assert.match(html, new RegExp(`data-edit="algorithm-child" data-key="${key}" data-id="current_calibration" data-child="" data-section="foc-compensation"`));
  }
  assert.doesNotMatch(html, /data-key="pwmDutyPercent"|data-edit="algorithm-routing"|data-key="(?:compiled|enabled)"/);
  assert.equal((html.match(/data-edit="algorithm-child"/g) || []).length, 5);
  assert.deepEqual([project, child], before);
});

test('saved calibration values remain editable through the existing child event path and conditional PWM duty', () => {
  const project = createProject(), child = calibration(project);
  Object.assign(child.parameters, { captureOnEnable: true, sampleIntervalUs: 50, settlingMs: 10, durationMs: 100, pwmEnabled: true, pwmDutyPercent: 50 });
  child.id = 'legacy-saved-id';
  const before = structuredClone(child);
  const html = renderResourceEditor(mcu, resources(project), { currentCalibration: child });
  assert.match(html, /data-key="captureOnEnable"[^>]*checked/);
  assert.match(html, /data-key="pwmEnabled"[^>]*checked/);
  assert.match(html, /data-key="pwmDutyPercent"[^>]*min="0"[^>]*max="100"/);
  assert.equal((html.match(/data-edit="algorithm-child"/g) || []).length, 6);
  assert.doesNotMatch(html, /data-id="legacy-saved-id"|data-action="add-algorithm-child"|<details[^>]*current-calibration/);
  assert.deepEqual(child, before);
});

test('standalone peripheral rendering remains independent when calibration context is absent', () => {
  const project = createProject(), before = structuredClone(project);
  assert.doesNotMatch(renderResourceEditor(mcu, resources(project)), /current-calibration-settings|data-edit="algorithm-child"/);
  assert.doesNotMatch(renderResourceEditor(mcu, [], { currentCalibration: calibration(project) }), /current-calibration-settings/);
  assert.deepEqual(project, before);
});
