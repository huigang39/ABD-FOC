import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { newModuleProject } from './support/new-project.mjs';
import { addAlgorithmChild, configuredAlgorithmChildren } from '../web/src/modules/algorithm/children.mjs';
import { legacyConsumerBindings, resetLegacyConsumerBindings } from '../web/src/modules/algorithm/consumers.mjs';
import { legacyObserverBindings, resetLegacyObserverBindings } from '../web/src/modules/algorithm/legacy-bindings.mjs';
import { runtimeConfiguration, renderRuntimeConfiguration } from '../web/src/features/configuration/runtime-config.mjs';
import { getGuide } from '../web/src/features/configuration/guide.mjs';
import { renderGuide } from '../web/src/features/configuration/view.mjs';
import { parameterModuleRoute, resolveParameterModule } from '../web/src/features/configuration/parameters-view.mjs';
import { renderAlgorithmChildren } from '../web/src/modules/algorithm/children-view.mjs';
import { parameterVisible } from '../web/src/modules/shared/visibility.mjs';
import { MODULES } from '../web/src/core/catalog.mjs';

test('fixed functions survive reload and export their contracts without configurable signal routes', () => {
  let project=addAlgorithmChild(newModuleProject(),'foc-observer','motor_pll');
  project=addAlgorithmChild(project,'foc-filter','load_torque_low_pass');
  const pll=configuredAlgorithmChildren(project,'foc-observer').find(child=>child.type==='motor_pll');
  project.instances['foc-observer'].parameters.children.find(child=>child.id===pll.id).parameters.bandwidthHz=120;
  const loaded=parseProject(serializeProject(project)), runtime=runtimeConfiguration(loaded);
  assert.equal(runtime.schemaVersion,3);
  assert.deepEqual(runtime.functions.find(item=>item.functionId==='motor_pll').outputs.map(output=>output.quantity),['motor-angle','motor-speed']);
  assert.equal(runtime.functions.find(item=>item.functionId==='load_torque_low_pass').source,'sensor.torque');
  assert.equal(runtime.entries.find(entry=>entry.childId===pll.id&&entry.key==='bandwidthHz').value,120);
  assert.ok(!runtime.entries.some(entry=>entry.slot==='routing'||entry.type==='signal-reference'));
  assert.ok(!Object.hasOwn(runtime,'signals'));
  assert.ok(!Object.hasOwn(runtime,'processingOrder'));
  for(const id of ['foc-observer','foc-filter']){
    const html=renderAlgorithmChildren(loaded,MODULES.find(module=>module.id===id));
    assert.doesNotMatch(html,/algorithm-routing|algorithm-output-name|data-key="name"|append-processing-node/);
  }
});

test('observer and filter have separate editors, menus and checklists', () => {
  const project=createProject();project.instances['foc-filter'].enabled=true;
  const problem={id:'filter-test-error',level:'error',moduleId:'foc-filter',paramKey:'children',title:'参数检查',message:'待配置参数'};
  const step=getGuide(project,[problem]).steps.find(step=>step.id==='algorithm');
  assert.deepEqual(step.modules,['foc-current','foc-modulation','foc-observer','foc-filter','foc-compensation']);
  assert.ok(step.children.find(child=>child.id==='foc-filter').issues.includes(problem));
  assert.ok(!step.children.find(child=>child.id==='foc-observer').issues.includes(problem));
  const calls=[];
  const html=renderGuide(project,[problem],'algorithm',{selectedModuleId:'foc-filter',parameters:module=>{calls.push(module.id);return renderAlgorithmChildren(project,module);}});
  assert.deepEqual(calls,['foc-filter']);
  assert.match(html,/<h2>滤波器<\/h2>/);
  assert.match(html,/data-tree-module="foc-observer"/);
  assert.match(html,/data-tree-module="foc-filter"/);
  assert.equal(parameterModuleRoute('foc-filter'),'#/parameters/foc?module=foc-filter');
  assert.equal(resolveParameterModule('foc','foc-filter').module.id,'foc-filter');
});

test('control-loop editors hide legacy feedback while runtime metadata retains it for explicit compatibility', () => {
  const project=newModuleProject(), parameters=project.instances['app-motion'].parameters;
  parameters.supportedModes=['position'];parameters.activeMode='position';
  parameters.positionFeedback='motor_reduction';parameters.speedFeedbackSignal='instance:old:output';
  const visible=key=>parameterVisible(project,'app-motion',MODULES.find(module=>module.id==='app-motion').params.find(field=>field.key===key));
  assert.equal(visible('positionFeedback'),false);
  assert.equal(visible('speedFilterHz'),false);
  assert.equal(visible('speedKp'),true);
  assert.equal(visible('positionKd'),true);
  for(const key of ['positionFeedbackSignal','speedFeedbackSignal','torqueFeedbackSignal'])assert.equal(visible(key),false);
  const before=structuredClone(project),runtime=runtimeConfiguration(project),rendered=[];
  renderRuntimeConfiguration(project,field=>{rendered.push(field.key);return '';});
  assert.ok(!rendered.includes('positionFeedback'));
  assert.ok(rendered.includes('speedKp'));
  assert.ok(!rendered.includes('speedFeedbackSignal'));
  assert.equal(runtime.legacyBindings.consumers[0].reference,'instance:old:output');
  assert.equal(runtime.legacyConfiguration.motion.positionFeedback,'motor_reduction');
  assert.deepEqual(project,before);
  assert.equal(legacyConsumerBindings(project).length,1);
  resetLegacyConsumerBindings(project);
  assert.equal(parameters.speedFeedbackSignal,'default');
  assert.equal(parameters.positionFeedback,'motor_reduction');
});

test('old observer publication bindings remain intact until explicitly removed', () => {
  const project=createProject(),parameters=project.instances['foc-observer'].parameters;
  parameters.motorAngleOutput='encoder_tracking_motor.angle';
  const before=structuredClone(project);
  assert.equal(legacyObserverBindings(project)[0].reference,'encoder_tracking_motor.angle');
  assert.deepEqual(project,before);
  resetLegacyObserverBindings(project);
  assert.equal(parameters.motorAngleOutput,'none');
  assert.equal(legacyObserverBindings(project).length,0);
});

test('dynamic motor-speed notch export retains eight multiplier slots and its fixed speed input', () => {
  let project=addAlgorithmChild(newModuleProject(),'foc-observer','motor_pll');
  project=addAlgorithmChild(project,'foc-filter','load_torque_motor_speed_notch');
  const parameters=project.instances['foc-filter'].parameters.children.find(child=>child.type==='load_torque_motor_speed_notch').parameters;
  parameters.multiplier1=1;parameters.multiplier3=3.5;parameters.q=5;
  const loaded=parseProject(serializeProject(project)),runtime=runtimeConfiguration(loaded);
  const definition=runtime.functions.find(item=>item.functionId==='load_torque_motor_speed_notch');
  assert.deepEqual(definition.inputs.map(input=>input.reference),['sensor.torque','motor_pll.speed']);
  assert.equal(definition.frequencyTracking.topology,'series');
  assert.equal(definition.frequencyTracking.maxStages,8);
  assert.equal(definition.frequencyTracking.speedInput,'motorSpeed');
  assert.equal(definition.frequencyTracking.sharedQKey,'q');
  const rows=runtime.entries.filter(entry=>entry.childId==='load_torque_motor_speed_notch');
  assert.equal(rows.filter(entry=>entry.key.startsWith('multiplier')).length,8);
  assert.equal(rows.find(entry=>entry.key==='multiplier3').value,3.5);
  assert.equal(rows.find(entry=>entry.key==='multiplier2').value,null);
  assert.equal(rows.find(entry=>entry.key==='multiplier2').optional,true);
  assert.ok(!rows.some(entry=>entry.key==='frequencyHz'||entry.slot==='routing'));
});
