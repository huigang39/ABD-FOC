import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeo75hProject} from '../web/src/profiles/neo75h.mjs';
import {parseProject} from '../web/src/core/model.mjs';
import {MODULES} from '../web/src/core/catalog.mjs';
import {createLayerInterface} from '../web/src/core/module-contracts.mjs';
import {renderModuleInterfaces} from '../web/src/features/configuration/interfaces-view.mjs';
import {renderGuide} from '../web/src/features/configuration/view.mjs';
import {createConfigurationTreeState} from '../web/src/features/configuration/tree-state.mjs';

test('saved automatic structure names lose branding without changing fields or ID-based links',()=>{
  const p=createNeo75hProject();
  for(const module of MODULES)for(const role of ['input','output','state'])p.design.structures.find(s=>s.id===p.design.moduleContracts[module.id][role]).name='Abd'+module.contracts[role].name;
  p.design.structures.find(s=>s.id==='observer-input').name='ObserverInput';
  p.design.structures.find(s=>s.id==='observer-state').name='ObserverState';
  const saved=structuredClone(p.design),loaded=parseProject(JSON.stringify(p));
  assert.deepEqual(loaded.design.moduleContracts,saved.moduleContracts);assert.deepEqual(loaded.design.layerInterfaces,saved.layerInterfaces);
  for(const s of loaded.design.structures){assert.deepEqual(s.fields,saved.structures.find(old=>old.id===s.id).fields);assert(!/^Abd/.test(s.name));}
  const custom=loaded.design.structures.find(s=>s.id===loaded.design.moduleContracts['foc-current'].input);custom.name='CustomCurrentInput';
  assert.equal(parseProject(JSON.stringify(loaded)).design.structures.find(s=>s.id===custom.id).name,custom.name);
});

test('each module has config/data/interface tabs and edits only its own connections',()=>{
  const p=createNeo75hProject(),related=createLayerInterface('related'),other=createLayerInterface('other');
  Object.assign(related,{name:'Board to current',fromModule:'hw-board',toModule:'foc-current',sourceStructure:p.design.moduleContracts['hw-board'].output,targetStructure:p.design.moduleContracts['foc-current'].input});
  Object.assign(other,{name:'Unrelated connection',fromModule:'app-motion',toModule:'app-comms'});p.design.layerInterfaces=[related,other];
  const html=renderGuide(p,[],'algorithm',{selectedModuleId:'foc-current',tab:'interfaces',interfaces:module=>renderModuleInterfaces(p,[],module.id)});
  assert.match(html,/tab=config" >配置<\/a>/);assert.match(html,/tab=data" >数据<\/a>/);assert.match(html,/tab=interfaces" aria-current="page">接口<\/a>/);
  assert.match(html,/Board to current/);assert.doesNotMatch(html,/Unrelated connection/);
  assert.match(html,/data-module="foc-current" data-direction="input"/);assert.match(html,/data-module="foc-current" data-direction="output"/);
  assert.match(html,/data-edit="layer-interface"/);assert.match(html,/来源 · 输出结构/);assert.match(html,/目标 · 输入结构/);
});

function treeFixture() {
  const branches=[];
  const branch=(id,parent=null)=>{const node={dataset:{stateKey:id},open:false,parentElement:parent,closest:()=>node,hasAttribute:key=>key==='data-tree-branch'};branches.push(node);return node;};
  const hardware=branch('tree-hardware'),platform=branch('tree-module-hw-platform',hardware),board=branch('tree-module-hw-board',hardware),algorithm=branch('tree-algorithm'),current=branch('tree-module-foc-current',algorithm);
  const links=[['hw-platform',platform],['hw-board',board],['foc-current',current]].map(([id,node])=>({dataset:{treeModule:id},closest:()=>node}));
  const root={querySelectorAll:selector=>selector==='[data-tree-module]'?links:branches};
  return {root,branches,hardware,platform,board,algorithm,current};
}
test('visiting modules reveals the current path without accumulating open sibling branches',()=>{
  const tree=treeFixture(),state=createConfigurationTreeState();
  state.restore({querySelectorAll:()=>[]});
  state.restore(tree.root,{moduleId:"hw-platform"});
  assert.equal(tree.hardware.open,true);assert.equal(tree.platform.open,true);
  for(const moduleId of ['hw-platform','hw-board','foc-current']){
    state.capture(tree.root);state.restore(tree.root,{moduleId,reveal:true});
    assert.equal(tree.branches.filter(b=>b.open).length,2);
  }
  assert.equal(tree.hardware.open,false);assert.equal(tree.current.open,true);
  tree.algorithm.open=false;state.capture(tree.root);state.restore(tree.root,{moduleId:'foc-current'});
  assert.equal(tree.algorithm.open,false);
  tree.hardware.open=true;state.capture(tree.root);state.restore(tree.root,{moduleId:'foc-current'});
  assert.equal(tree.hardware.open,true);assert.equal(tree.algorithm.open,false);
});
