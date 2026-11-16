import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { addAlgorithmChild } from '../web/src/modules/algorithm/children.mjs';
import { renderProcessingChains } from '../web/src/modules/algorithm/processing-view.mjs';

const noRouting=html=>assert.doesNotMatch(html,/data-edit="algorithm-(?:routing|output-name)"|data-key="name"|data-action="(?:append-processing-node|add-processing-preset)"|processing-usage-tag|已有输出映射|结果选择/);

test('the retired combined entry point renders separate fixed categories without free routing controls',()=>{
  const project=createProject(),before=structuredClone(project),html=renderProcessingChains(project);
  assert.match(html,/<h3>观测器<\/h3>/);
  assert.match(html,/<h3>滤波器<\/h3>/);
  for(const type of ['motor_pll','output_pll','load_torque_low_pass','load_torque_motor_speed_notch'])assert.match(html,new RegExp(`data-action="add-algorithm-child"[^>]*data-type="${type}"`));
  noRouting(html);
  assert.deepEqual(project,before);
});

test('compatibility rendering preserves unknown old connections and presents their parameters for replacement',()=>{
  const project=addAlgorithmChild(createProject(),'foc-filter','low_pass');
  const old=project.instances['foc-filter'].parameters.children.find(item=>item.compiled);
  old.routing.source='instance:missing:output';old.outputNames={output:'旧输出'};old.parameters.cutoffHz=12;
  const before=structuredClone(project),html=renderProcessingChains(project,{legacyObserverPrimary:'<input data-old-publication>'});
  assert.match(html,/旧通用配置待替换/);
  assert.match(html,/data-key="cutoffHz"/);
  assert.match(html,new RegExp(`data-action="remove-algorithm-child"[^>]*data-id="${old.id}"`));
  assert.doesNotMatch(html,/data-old-publication/);
  noRouting(html);
  assert.deepEqual(project,before);
});
