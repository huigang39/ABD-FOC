import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { createResource } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { addAlgorithmChild, createAlgorithmChild } from '../web/src/modules/algorithm/children.mjs';
import { instanceSignalReference } from '../web/src/modules/algorithm/signals.mjs';
import { CONSUMER_SIGNALS, consumerSignalChoices, consumerSignalControlValue, applyConsumerSignalSelection, algorithmSignalUsages, legacyConsumerBindings, resetLegacyConsumerBindings, validateSignalConsumers } from '../web/src/modules/algorithm/consumers.mjs';
import { MODULES } from '../web/src/core/catalog.mjs';
import { parameterVisible } from '../web/src/modules/shared/visibility.mjs';
import { runtimeConfiguration } from '../web/src/features/configuration/runtime-config.mjs';
import { MODULE_CODE } from '../native/generator/modules.mjs';
import { inspectFirmwareSupport } from '../native/firmware.mjs';
import { newModuleProject } from './support/new-project.mjs';

const motion = project => project.instances['app-motion'].parameters;
const choices = (project, key) => consumerSignalChoices(project, key).map(([reference]) => reference);
function fixture() {
  const project = createProject(), board = project.instances['hw-board'].parameters, drivers = project.instances['hw-drivers'].parameters;
  for (const [index, prefix, capability, model] of [[1,'motorEncoder','encoderCapability','gongwang'],[2,'outputEncoder','outputEncoderCapability','jingang'],[3,'torqueSensor','torqueCapability','KW']]) {
    const resource = createResource('uart', `serial-${index}`);
    resource.instance = `USART${index}`; resource.settings.physical = 'rs485'; resource.pins.RX = ['PA10','PD6','PD9'][index-1];
    board.resources.push(resource);
    Object.assign(drivers, { [capability]: 'present', [prefix+'Model']: model, [prefix+'Resource']: resource.id });
  }
  Object.assign(drivers, { motorEncoderAngleDomain: 'mechanical', outputEncoderAngleDomain: 'mechanical', torqueSensorUnit: 'nm' });
  Object.assign(motion(project), { supportedModes: ['position','speed','impedance','torque_feedback'], activeMode: 'speed' });
  return project;
}

test('feedback choices include only configured scalar sources in the accepted physical domain', () => {
  const empty = createProject();
  for (const { paramKey } of CONSUMER_SIGNALS.filter(spec => spec.paramKey !== 'positionFeedbackSignal')) assert.deepEqual(consumerSignalChoices(empty, paramKey), [['default','默认反馈']]);
  assert.deepEqual(consumerSignalChoices(empty, 'positionFeedbackSignal'), [['default','默认反馈 · 待选择'], ['default:motor_reduction','电机轴编码器 · 减速换算'], ['default:output_encoder','出轴编码器']]);
  const project = fixture(), before = structuredClone(project);
  assert.deepEqual(choices(project, 'positionFeedbackSignal'), ['default','default:motor_reduction','default:output_encoder','sensor.motor_angle','sensor.output_angle']);
  assert.deepEqual(choices(project, 'speedFeedbackSignal'), ['default','feedback.speed']);
  assert.deepEqual(choices(project, 'torqueFeedbackSignal'), ['default','sensor.torque']);
  assert.deepEqual(project, before);
  project.instances['hw-drivers'].parameters.motorEncoderAngleDomain = 'electrical';
  assert(!choices(project, 'positionFeedbackSignal').includes('sensor.motor_angle'));
  project.instances['hw-drivers'].parameters.torqueSensorUnit = 'raw';
  assert(choices(project, 'torqueFeedbackSignal').includes('sensor.torque'));
});

test('one position control edits legacy default sources and retains custom selections without enabling producers', () => {
  const project = fixture(), parameters = motion(project), before = structuredClone(project.instances['hw-drivers']);
  assert.equal(consumerSignalControlValue(project, 'positionFeedbackSignal'), 'default');
  applyConsumerSignalSelection(project, 'positionFeedbackSignal', 'default:motor_reduction');
  assert.equal(parameters.positionFeedback, 'motor_reduction');
  assert.equal(parameters.positionFeedbackSignal, 'default');
  assert.equal(consumerSignalControlValue(project, 'positionFeedbackSignal'), 'default:motor_reduction');
  assert(!choices(project, 'positionFeedbackSignal').includes('default'));
  applyConsumerSignalSelection(project, 'positionFeedbackSignal', 'sensor.output_angle');
  assert.equal(consumerSignalControlValue(project, 'positionFeedbackSignal'), 'sensor.output_angle');
  assert.equal(parameters.positionFeedback, 'motor_reduction');
  applyConsumerSignalSelection(project, 'positionFeedbackSignal', 'default:output_encoder');
  assert.equal(parameters.positionFeedback, 'output_encoder');
  assert.equal(parameters.positionFeedbackSignal, 'default');
  assert.equal(consumerSignalControlValue(project, 'positionFeedbackSignal'), 'default:output_encoder');
  assert.deepEqual(project.instances['hw-drivers'], before);
  const loaded = parseProject(serializeProject(project));
  assert.equal(consumerSignalControlValue(loaded, 'positionFeedbackSignal'), 'default:output_encoder');
  assert(!validateSignalConsumers(loaded).some(issue => issue.paramKey === 'positionFeedbackSignal'));
});

test('legacy empty defaults display consistently and invalid control choices cannot mutate the project', () => {
  const project = fixture();
  for (const value of ['', null, undefined, 'default']) {
    motion(project).speedFeedbackSignal = value;
    assert.equal(consumerSignalControlValue(project, 'speedFeedbackSignal'), 'default');
    motion(project).positionFeedbackSignal = value;
    motion(project).positionFeedback = 'motor_reduction';
    assert.equal(consumerSignalControlValue(project, 'positionFeedbackSignal'), 'default:motor_reduction');
  }
  const before = structuredClone(project);
  for (const [key, value] of [['unknown','default'], ['speedFeedbackSignal','default:output_encoder'], ['positionFeedbackSignal','default:bad'], ['speedFeedbackSignal','sensor.output_angle']]) {
    assert.throws(() => applyConsumerSignalSelection(project, key, value), /不存在|兼容且可用/);
    assert.deepEqual(project, before);
  }
  motion(project).speedFeedbackSignal = 'instance:removed:speed';
  assert.equal(consumerSignalControlValue(project, 'speedFeedbackSignal'), 'instance:removed:speed');
  assert(choices(project, 'speedFeedbackSignal').includes('instance:removed:speed'));
  applyConsumerSignalSelection(project, 'speedFeedbackSignal', 'default');
  assert.equal(motion(project).speedFeedbackSignal, 'default');
});

test('historical selected processing outputs survive disabled or deleted producers with a replacement notice', () => {
  let project = addAlgorithmChild(fixture(), 'foc-observer', 'pll');
  const pll = project.instances['foc-observer'].parameters.children.at(-1);
  pll.routing.source = 'sensor.output_angle'; pll.outputNames = { speed: '出轴平滑速度' };
  const reference = instanceSignalReference(pll.id, 'speed');
  assert(choices(project, 'speedFeedbackSignal').includes(reference));
  motion(project).speedFeedbackSignal = reference;
  assert.equal(validateSignalConsumers(project)[0].code, 'legacy-consumer-binding');
  assert.equal(algorithmSignalUsages(project, reference)[0].conversion, 'direct');
  pll.enabled = false;
  assert.match(consumerSignalChoices(project, 'speedFeedbackSignal').find(([id]) => id === reference)[1], /待检查/);
  const issue = validateSignalConsumers(project)[0];
  assert.equal(issue.paramKey, 'speedFeedbackSignal');
  assert.equal(issue.level, 'pending');
  assert.equal(issue.title, '旧连接待替换');
  assert.deepEqual(issue.messageParts[2], { type: 'reference', kind: 'signal', label: '出轴平滑速度' });
  project.instances['foc-observer'].parameters.children = [];
  assert.equal(legacyConsumerBindings(project)[0].signalLabel, reference);
  const loaded = parseProject(serializeProject(project));
  assert.equal(motion(loaded).speedFeedbackSignal, reference);
});

test('all saved generic consumer connections require explicit replacement regardless of signal validity', () => {
  const project = fixture();
  Object.assign(motion(project), { positionFeedbackSignal: 'feedback.angle', speedFeedbackSignal: 'sensor.output_angle', torqueFeedbackSignal: 'load_torque.torque' });
  assert.equal(validateSignalConsumers(project).length, 3);
  assert(validateSignalConsumers(project).every(issue => issue.level === 'pending' && issue.code === 'legacy-consumer-binding'));
  motion(project).torqueFeedbackSignal = 'sensor.torque';
  project.instances['hw-drivers'].parameters.torqueSensorUnit = 'raw';
  assert(validateSignalConsumers(project).some(issue => issue.paramKey === 'torqueFeedbackSignal'));
  Object.assign(motion(project), { supportedModes: ['current'], activeMode: 'current' });
  assert.equal(validateSignalConsumers(project).length, 3);
});

test('usage locations distinguish reducer conversion from direct output feedback and do not mutate settings', () => {
  const project = fixture();
  motion(project).speedFeedbackSignal = 'feedback.speed';
  motion(project).positionFeedbackSignal = 'sensor.output_angle';
  const before = structuredClone(project);
  const speed = algorithmSignalUsages(project, 'feedback.speed')[0];
  assert.equal(speed.conversion, 'reducer'); assert.equal(speed.active, true); assert.match(speed.description, /减速比与方向/);
  assert.equal(algorithmSignalUsages(project, 'sensor.output_angle')[0].conversion, 'direct');
  assert.deepEqual(algorithmSignalUsages(project, 'default'), []);
  assert.deepEqual(project, before);
  motion(project).supportedModes = ['current']; motion(project).activeMode = 'current';
  assert.equal(algorithmSignalUsages(project, 'feedback.speed')[0].active, false);
});

test('historical custom references cannot bypass saved hardware dependencies or demand removed position controls', () => {
  const project = fixture();
  Object.assign(motion(project), { positionFeedback: 'output_encoder', positionFeedbackSignal: 'sensor.motor_angle' });
  project.instances['hw-drivers'].parameters.outputEncoderCapability = 'absent';
  assert(validateProject(project).some(issue => issue.moduleId === 'hw-drivers' && issue.paramKey === 'outputEncoderCapability'));
  motion(project).positionFeedbackSignal = 'default';
  assert(validateProject(project).some(issue => issue.moduleId === 'hw-drivers' && issue.paramKey === 'outputEncoderCapability'));
  motion(project).positionFeedback = 'unselected';
  assert(!validateProject(project).some(issue => issue.id === 'position-source'));
});

test('native generation rejects every explicit consumer route even when its mode is not active', () => {
  const project = newModuleProject();
  for (const value of ['default', '', null, undefined]) {
    motion(project).speedFeedbackSignal = value;
    assert.doesNotThrow(() => MODULE_CODE['app-motion'].values(project));
  }
  for (const { paramKey } of CONSUMER_SIGNALS) {
    motion(project)[paramKey] = 'sensor.motor_angle';
    assert.throws(() => MODULE_CODE['app-motion'].values(project), /旧反馈连接待替换/);
    const report = inspectFirmwareSupport(project);
    assert(report.sourceIssues.some(issue => issue.moduleId === 'app-motion' && /旧反馈连接待替换/.test(issue.message)));
    motion(project)[paramKey] = 'default';
  }
});

test('gain-only controls keep old position, filter and signal parameters hidden without discarding stored values', () => {
  const project = fixture(), fields = MODULES.find(module => module.id === 'app-motion').params;
  motion(project).speedFeedbackSignal = 'instance:old:output';
  for (const { paramKey } of CONSUMER_SIGNALS) assert.equal(parameterVisible(project, 'app-motion', fields.find(field => field.key === paramKey)), false);
  assert.equal(parameterVisible(project, 'app-motion', fields.find(field => field.key === 'positionFeedback')), false);
  assert.equal(parameterVisible(project, 'app-motion', fields.find(field => field.key === 'speedFilterHz')), false);
  assert.equal(motion(project).speedFeedbackSignal, 'instance:old:output');
});

test('legacy connection removal is explicit, scoped and preserves fixed settings and all algorithm data', () => {
  const project = fixture();
  Object.assign(motion(project), { positionFeedback: 'output_encoder', positionFeedbackSignal: 'sensor.output_angle', speedFeedbackSignal: 'instance:gone:speed', torqueFeedbackSignal: 'sensor.torque', speedFilterHz: 200 });
  const before = structuredClone(project);
  assert.equal(legacyConsumerBindings(project).length, 3);
  assert.deepEqual(project, before);
  assert.throws(() => resetLegacyConsumerBindings(project, 'invalid'), /不存在/);
  assert.deepEqual(project, before);
  assert.equal(resetLegacyConsumerBindings(project, 'speedFeedbackSignal'), 1);
  assert.equal(motion(project).speedFeedbackSignal, 'default');
  assert.equal(legacyConsumerBindings(project).length, 2);
  assert.equal(resetLegacyConsumerBindings(project), 2);
  assert.equal(resetLegacyConsumerBindings(project), 0);
  for (const { paramKey } of CONSUMER_SIGNALS) before.instances['app-motion'].parameters[paramKey] = 'default';
  assert.deepEqual(project, before);
  assert.deepEqual(validateSignalConsumers(project), []);
});

test('compiled independent compensators cannot pass native inspection through the legacy friction template', () => {
  const project = newModuleProject();
  project.instances['foc-compensation'].enabled = true;
  project.instances['foc-compensation'].parameters.children = [createAlgorithmChild('foc-compensation', 'friction')];
  assert.throws(() => MODULE_CODE['foc-compensation'].values(project), /独立补偿功能尚未接入/);
  assert(inspectFirmwareSupport(project).sourceIssues.some(issue => issue.moduleId === 'foc-compensation' && /独立补偿功能尚未接入/.test(issue.message)));
});

test('fixed PLL and load torque filters remain explicitly unsupported by the native generator', () => {
  for (const [moduleId, type] of [['foc-observer','motor_pll'], ['foc-observer','output_pll'], ['foc-filter','load_torque_low_pass'], ['foc-filter','load_torque_notch']]) {
    const project = addAlgorithmChild(newModuleProject(), moduleId, type);
    const report = inspectFirmwareSupport(project);
    assert.equal(report.sourceReady, false);
    assert(report.sourceIssues.some(issue => issue.moduleId === moduleId && issue.code === 'implementation'), type);
  }
});

test('runtime export retains old consumer references and hidden motion configuration in compatibility metadata', () => {
  const project = fixture();
  Object.assign(motion(project), { positionFeedback: 'output_encoder', positionFeedbackSignal: 'sensor.motor_angle', speedFeedbackSignal: 'instance:old:speed', speedFilterHz: 125 });
  const before = structuredClone(project), runtime = runtimeConfiguration(project);
  assert.deepEqual(runtime.legacyBindings.consumers, legacyConsumerBindings(project));
  assert(!runtime.entries.some(entry => CONSUMER_SIGNALS.some(spec => spec.paramKey === entry.key)));
  assert.equal(runtime.legacyConfiguration.motion.positionFeedback, 'output_encoder');
  assert.equal(runtime.legacyConfiguration.motion.speedFilterHz, 125);
  assert(!runtime.entries.some(entry => entry.id === 'app-motion.positionFeedback' || entry.id === 'app-motion.speedFilterHz'));
  assert.deepEqual(project, before);
  resetLegacyConsumerBindings(project);
  assert.deepEqual(runtimeConfiguration(project).legacyBindings.consumers, []);
  assert.equal(motion(project).positionFeedback, 'output_encoder');
});
