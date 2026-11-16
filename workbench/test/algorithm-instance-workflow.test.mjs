import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, MODULES } from '../web/src/core/model.mjs';
import { addAlgorithmChild, configuredAlgorithmChildren, updateAlgorithmRouting } from '../web/src/modules/algorithm/children.mjs';
import { updateAlgorithmChild } from '../web/src/modules/algorithm/editing.mjs';
import { fieldReference } from '../web/src/modules/algorithm/signals.mjs';
import { runtimeConfiguration } from '../web/src/features/configuration/runtime-config.mjs';
import { renderGuide } from '../web/src/features/configuration/view.mjs';
import { renderAlgorithmChildren } from '../web/src/modules/algorithm/children-view.mjs';
import { renderAngleDelay } from '../web/src/modules/algorithm/foc-current/corrections-view.mjs';
import { inspectFirmwareSupport } from '../native/firmware.mjs';
import { writeNewProject } from '../native/generator/project.mjs';

const children = (project, moduleId) => configuredAlgorithmChildren(project, moduleId);
function outputField(project, moduleId, name) {
  const structure = project.design.structures.find(item => item.id === project.design.moduleContracts[moduleId].output);
  return fieldReference(structure.id, structure.fields.find(field => field.name === name).id);
}

test('legacy PLL edits preserve separate instance IDs and archive old routes through save/reload', () => {
  let project = addAlgorithmChild(addAlgorithmChild(createProject(), 'foc-observer', 'pll'), 'foc-observer', 'pll');
  const [motor, output] = children(project, 'foc-observer');
  project = updateAlgorithmRouting(project, 'foc-observer', motor.id, 'source', 'sensor.motor_angle');
  project = updateAlgorithmRouting(project, 'foc-observer', output.id, 'source', 'sensor.output_angle');
  project = updateAlgorithmRouting(project, 'foc-observer', motor.id, 'speedOutput', outputField(project, 'foc-observer', 'motor_velocity'));
  project = updateAlgorithmRouting(project, 'foc-observer', output.id, 'speedOutput', outputField(project, 'foc-observer', 'output_velocity'));
  project = updateAlgorithmChild(project, 'foc-observer', motor.id, 'bandwidthHz', 50);
  project = updateAlgorithmChild(project, 'foc-observer', output.id, 'bandwidthHz', 30);
  project = updateAlgorithmChild(project, 'foc-observer', output.id, 'name', '出轴速度');
  const decoded = parseProject(serializeProject(project));
  assert.deepEqual(children(decoded, 'foc-observer'), children(project, 'foc-observer'));
  const runtime = runtimeConfiguration(decoded);
  const entries = runtime.entries.filter(entry => entry.moduleId === 'foc-observer');
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  assert.equal(entries.find(entry => entry.childId === motor.id && entry.key === 'bandwidthHz').value, 50);
  assert.equal(entries.find(entry => entry.childId === output.id && entry.key === 'bandwidthHz').value, 30);
  assert.ok(!entries.some(entry => ['source','angleOutput','speedOutput','outputNames'].includes(entry.key)));
  const archived = runtime.legacyBindings.algorithms.find(entry => entry.childId === output.id);
  assert.deepEqual(archived.routing, children(decoded, 'foc-observer').find(child => child.id === output.id).routing);
});

test('first hardware/current-loop edits include only the corresponding correction and preserve fractional cycles', () => {
  const original = createProject();
  let project = updateAlgorithmChild(original, 'foc-compensation', 'current_calibration', 'captureOnEnable', true);
  assert.equal(children(original, 'foc-compensation').length, 0);
  assert.deepEqual(children(project, 'foc-compensation').map(child => child.type), ['current_calibration']);
  project = updateAlgorithmChild(project, 'foc-compensation', 'angle_delay', 'delayCycles', 1.5);
  project.instances['hw-board'].parameters.pwmHz = 20000;
  project.instances['hw-board'].parameters.currentLoopDivider = 2;
  const decoded = parseProject(serializeProject(project));
  assert.equal(children(decoded, 'foc-compensation').find(child => child.type === 'angle_delay').parameters.delayCycles, 1.5);
  const html = renderAngleDelay(decoded);
  assert.match(html, /data-key="delayCycles"/);
  assert.match(html, /value="1.5"/);
  assert.match(html, /class="field-unit">周期</);
  assert.doesNotMatch(html, /μs|data-key="delayUs"/);
  decoded.instances['foc-compensation'].runtimeEnabled = false;
  const resumed = updateAlgorithmChild(decoded, 'foc-compensation', 'angle_delay', 'delayCycles', 2);
  assert.equal(resumed.instances['foc-compensation'].runtimeEnabled, true);
  assert.equal(children(resumed, 'foc-compensation').find(child => child.type === 'angle_delay').enabled, true);
  assert.equal(children(resumed, 'foc-compensation').find(child => child.type === 'current_calibration').enabled, false);
});

test('filter and observer categories have separate fixed function editors while generation stays unsupported', async () => {
  let project = createProject();
  const render = selectedModuleId => renderGuide(project, [], 'algorithm', {
    selectedModuleId,
    parameters: module => {
      assert.equal(module.id, selectedModuleId);
      return renderAlgorithmChildren(project, module);
    },
  });
  const html = render('foc-filter');
  assert.match(html, /data-guide-module="foc-filter"/);
  assert.match(html, /<h2>滤波器<\/h2>/);
  assert.match(html, /data-type="load_torque_low_pass"/);
  assert.match(html, /data-type="load_torque_motor_speed_notch"/);
  assert.doesNotMatch(html, /data-type="(?:motor_pll|output_pll)"/);
  const observerHtml = render('foc-observer');
  assert.match(observerHtml, /data-type="motor_pll"/);
  assert.match(observerHtml, /data-type="output_pll"/);
  assert.doesNotMatch(observerHtml, /data-type="load_torque_(?:low_pass|motor_speed_notch)"/);
  assert.doesNotMatch(html, /添加此模块后配置参数/);
  project = addAlgorithmChild(project, 'foc-filter', 'load_torque_low_pass');
  const child = children(project, 'foc-filter')[0];
  project = updateAlgorithmChild(project, 'foc-filter', child.id, 'cutoffHz', 100);
  const configuredHtml = render('foc-filter');
  assert.equal(project.instances['foc-observer'].enabled, false);
  assert.match(configuredHtml, new RegExp(`data-algorithm-child="load_torque_low_pass" data-child-id="${child.id}"`));
  assert.match(configuredHtml, /data-key="cutoffHz"/);
  assert.doesNotMatch(configuredHtml, /data-edit="algorithm-routing"|已有输出映射|data-edit="algorithm-output-name"/);
  assert.doesNotMatch(render('foc-observer'), /data-algorithm-child="load_torque_low_pass"/);
  assert.ok(inspectFirmwareSupport(project).issues.some(issue => issue.moduleId === 'foc-filter'));
  await assert.rejects(writeNewProject('/tmp/abd-filter-generation-must-not-write', project), /滤波器.*尚未接入/);
  assert.ok(MODULES.some(module => module.id === 'foc-filter'));
});
