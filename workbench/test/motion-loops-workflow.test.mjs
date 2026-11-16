import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, MODULES } from '../web/src/core/model.mjs';
import { MOTION_GAIN_KEYS } from '../web/src/modules/application/app-motion/loops.mjs';
import { renderMotionLoops } from '../web/src/modules/application/app-motion/view.mjs';
import { renderGuide } from '../web/src/features/configuration/view.mjs';
import { renderModuleParameters } from '../web/src/features/configuration/parameters-view.mjs';
import { runtimeConfiguration, renderRuntimeConfiguration } from '../web/src/features/configuration/runtime-config.mjs';

const fieldHtml=(field,value,scope,id)=>`<input id="module-${id}-${field.key}" data-scope="${scope}" data-key="${field.key}" value="${value??''}">`;
test('project and standalone control editors expose the same eleven gains in four flat groups', () => {
  const project=createProject();
  const render=module=>module.id==='app-motion'?renderMotionLoops(project,fieldHtml):'';
  for(const html of [renderGuide(project,[],'application',{selectedModuleId:'app-motion',parameters:render}),renderModuleParameters(project,'app','app-motion',{parameters:render})]){
    assert.deepEqual([...html.matchAll(/data-motion-loop="([^"]+)"/g)].map(match=>match[1]),['torque','speed','position','pd']);
    assert.deepEqual([...html.matchAll(/data-key="([^"]+)"/g)].map(match=>match[1]),MOTION_GAIN_KEYS);
    assert.doesNotMatch(html,/高级参数|advanced-app-motion|data-key="(?:supportedModes|activeMode|positionFeedback|outerHz|currentLimitA|profile[^\"]*)"/);
  }
});

test('PID values survive saving and export while legacy settings remain outside editable entries', () => {
  const project=createProject(),parameters=project.instances['app-motion'].parameters;
  parameters.speedKp=0.75;parameters.speedKi=12;parameters.speedKd=0;
  parameters.torqueKp=0.5;parameters.positionKi=0;parameters.pdKd=2;
  parameters.profileVelocityRadS=15;parameters.currentLimitA=3;parameters.outerHz=1000;
  const loaded=parseProject(serializeProject(project)),before=structuredClone(loaded),runtime=runtimeConfiguration(loaded);
  const rows=runtime.entries.filter(entry=>entry.moduleId==='app-motion');
  assert.deepEqual(rows.map(entry=>entry.key),MOTION_GAIN_KEYS);
  for(const key of MOTION_GAIN_KEYS)assert.equal(rows.find(entry=>entry.key===key).value,parameters[key]);
  assert.equal(runtime.legacyConfiguration.motion.profileVelocityRadS,15);
  assert.equal(runtime.legacyConfiguration.motion.currentLimitA,3);
  assert.equal(runtime.legacyConfiguration.motion.outerHz,1000);
  assert.ok(!Object.hasOwn(runtime.legacyConfiguration.motion,'speedKp'));
  const html=renderRuntimeConfiguration(loaded,fieldHtml),section=html.match(/<section class="runtime-motion-loops">([\s\S]*?)<\/section>(?=<details|<h4|<\/section>)/)?.[0]||html;
  for(const key of MOTION_GAIN_KEYS)assert.match(html,new RegExp(`id="runtime-list-module-app-motion-${key}"`));
  assert.equal([...section.matchAll(/data-motion-loop=/g)].length,4);
  assert.doesNotMatch(section,/runtime-config-app-motion|高级参数|data-key="(?:outerHz|speedFilterHz)"/);
  assert.deepEqual(loaded,before);
  assert.equal(MODULES.find(module=>module.id==='app-motion').params.filter(field=>!field.hidden).length,11);
});
