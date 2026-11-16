import { MODULES } from '../web/src/core/catalog.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { validateProject } from '../web/src/core/model.mjs';
import { getGuide } from '../web/src/features/configuration/guide.mjs';
import { renderGuide } from '../web/src/features/configuration/view.mjs';
import { createLayerInterface } from '../web/src/core/module-contracts.mjs';

function completeContracts(project, moduleId) {
  for (const [role,id] of Object.entries(project.design.moduleContracts[moduleId])) project.design.structures.find(item=>item.id===id).fields = structuredClone(MODULES.find(module=>module.id===moduleId).contracts[role].fields);
}
const progress = (project,id,issues=validateProject(project)) => getGuide(project,issues).steps.flatMap(step=>step.children||[]).find(item=>item.id===id);

test('module checkmarks follow parameters and contracts, and retract immediately after an edit', () => {
  const project=createNeo75hProject();
  assert.equal(progress(project,'hw-platform').state,'todo');
  project.instances['hw-platform'].parameters.coreConfigs.cm4.communicationIrqPriority='high';
  assert.equal(progress(project,'hw-platform').state,'configured');
  project.design.structures.find(s=>s.id===project.design.moduleContracts['hw-platform'].input).fields=[];
  assert.equal(progress(project,'hw-platform').state,'todo');
  completeContracts(project,'hw-platform');
  assert.equal(progress(project,'hw-platform').state,'configured');
  project.instances['hw-platform'].parameters.coreConfigs.cm7.clockHz=null;
  assert.equal(progress(project,'hw-platform').state,'todo');
  project.instances['hw-platform'].parameters.coreConfigs.cm7.clockHz=400000000;
  project.instances['hw-platform'].parameters.coreConfigs.cm4.communicationIrqPriority=16;
  assert.equal(progress(project,'hw-platform').state,'blocked');
  project.instances['hw-platform'].parameters.coreConfigs.cm4.communicationIrqPriority='high';
  assert.equal(progress(project,'hw-platform').state,'configured');
});

test('MCU metadata and PCBA identification contribute to their own modules', () => {
  const p=createNeo75hProject();completeContracts(p,'hw-platform');p.instances['hw-platform'].parameters.coreConfigs.cm4.communicationIrqPriority='high';
  p.target.board='';
  assert.equal(progress(p,'hw-platform').state,'blocked');
  assert(progress(p,'hw-platform').issues.some(issue=>issue.id==='memory-target-mismatch'));
  assert.equal(progress(p,'hw-board').state,'todo');
  p.target.mcu='';
  assert.equal(progress(p,'hw-platform').state,'blocked');
});

test('an optional module is skipped only when disabled and not required by another choice', () => {
  const p=createNeo75hProject();Object.assign(p.instances['foc-observer'],{enabled:false,runtimeEnabled:false});
  assert.equal(progress(p,'foc-observer').state,'disabled');
  p.instances['foc-feedback'].parameters.angleSource='observer';
  assert.equal(progress(p,'foc-observer').state,'blocked');
  p.instances['foc-feedback'].parameters.angleSource='encoder';
  p.instances['foc-observer'].parameters.children=[{id:'chain',type:'encoder_tracking_motor',name:'电机侧编码器跟踪',compiled:true,enabled:true,routing:{source:'sensor.motor_angle'},parameters:{extraction:'pll',pllBandwidthHz:100,speedFilterHz:null}}];
  p.instances['foc-observer'].enabled=true;p.instances['foc-observer'].runtimeEnabled=true;
  assert.equal(progress(p,'foc-observer').state,'todo');
});

test('bad cross-layer connections mark both endpoint modules', () => {
  const p=createNeo75hProject(), link=createLayerInterface('broken-link');
  Object.assign(link,{fromModule:'hw-board',toModule:'foc-feedback',sourceStructure:p.design.moduleContracts['hw-board'].state,targetStructure:p.design.moduleContracts['foc-feedback'].input});
  p.design.layerInterfaces.push(link);
  const guide=getGuide(p,validateProject(p));
  assert.equal(progress(p,'hw-board').state,'blocked');
  assert.equal(guide.steps.find(step=>step.id==='algorithm').state,'blocked');
  assert.ok(guide.steps.find(step=>step.id==='algorithm').issues.some(issue=>issue.designPage==='interfaces'&&issue.itemId===link.id));
});

test('board measurements do not masquerade as configuration work or completion', () => {
  const p=createNeo75hProject();completeContracts(p,'foc-modulation');
  assert.equal(progress(p,'foc-modulation').state,'configured');
  assert(validateProject(p).some(issue=>issue.id==='hardware-verification'));
  assert.equal(getGuide(p,validateProject(p)).steps.find(step=>step.id==='build').state,'todo');
});

test('tree links every module and keeps only the selected module in the editor', () => {
  const p=createNeo75hProject();
  const html=renderGuide(p,validateProject(p),'hardware',{selectedModuleId:'hw-board',parameters:module=>`<div data-parameters="${module.id}"></div>`});
  assert.equal([...html.matchAll(/data-tree-module=/g)].length,16);
  assert.deepEqual([...html.matchAll(/data-guide-module="([^"]+)"/g)].map(match=>match[1]),['hw-board']);
  assert.match(html,/data-state-key="tree-hardware" open/);
  assert.match(html,/下一个模块/);
  assert.match(html,/title="待配置"/);
  assert.ok(html.indexOf('data-tree-module="foc-observer"') < html.indexOf('data-tree-module="foc-compensation"'));
});

test('modules have stable sequence numbers and independently collapsible configuration/data branches', () => {
  const p=createNeo75hProject();
  const html=renderGuide(p,[],'hardware',{selectedModuleId:'hw-board',tab:'data'});
  assert.equal([...html.matchAll(/class="configuration-module-branch"/g)].length,16);
  assert.match(html,/data-state-key="tree-module-hw-board" open/);
  assert.match(html,/data-state-key="tree-module-hw-platform" >/);
  assert.match(html,/<span class="tree-module-number">02<\/span><span class="tree-module-title">外设/);
  assert.match(html,/<span class="module-sequence">02<\/span>/);
  assert.match(html,/href="#\/project\/hardware\?module=hw-board&tab=data" data-tree-tab="data" aria-current="page"/);
  assert.doesNotMatch(html,/tree-group-|class="tree-module-number">\d+\.\d+/);
  assert.deepEqual([...html.matchAll(/data-tree-module="(hw-[^"]+)"/g)].map(match=>match[1]),['hw-platform','hw-board','hw-sensors','hw-safety']);
  const algorithm=renderGuide(p,[],'algorithm',{selectedModuleId:'foc-observer'});
  assert.match(algorithm,/<span class="tree-module-number">03<\/span><span class="tree-module-title">观测器/);
});
