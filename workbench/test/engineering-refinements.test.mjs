import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeo75hProject} from '../web/src/profiles/neo75h.mjs';
import {parseProject} from '../web/src/core/model.mjs';
import {MODULES} from '../web/src/core/catalog.mjs';
import {createLayerInterface} from '../web/src/core/module-contracts.mjs';
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

test('legacy module interface routes show parameters without exposing or mutating stored connections',()=>{
  const p=createNeo75hProject(),related=createLayerInterface('related'),other=createLayerInterface('other');
  Object.assign(related,{name:'Board to current',fromModule:'hw-board',toModule:'foc-current',sourceStructure:p.design.moduleContracts['hw-board'].output,targetStructure:p.design.moduleContracts['foc-current'].input});
  Object.assign(other,{name:'Unrelated connection',fromModule:'app-motion',toModule:'app-comms'});p.design.layerInterfaces=[related,other];
  const before=structuredClone(p.design);
  const html=renderGuide(p,[],'algorithm',{selectedModuleId:'foc-current',tab:'interfaces',parameters:module=>`<div data-parameters="${module.id}"></div>`,interfaces:()=>assert.fail('module interfaces should no longer render')});
  assert.match(html,/data-parameters="foc-current"/);
  assert.doesNotMatch(html,/configuration-module-tabs|tab=data|tab=interfaces|data-edit="layer-interface"|Board to current|Unrelated connection/);
  assert.deepEqual(p.design,before);
});

function treeFixture() {
  const branches=[];
  const branch=(id,parent=null)=>{const node={dataset:{stateKey:id},open:false,parentElement:parent,closest:()=>node,hasAttribute:key=>key==='data-tree-branch'};branches.push(node);return node;};
  const hardware=branch('tree-hardware'),algorithm=branch('tree-algorithm');
  const links=[['hw-platform',hardware],['hw-board',hardware],['foc-current',algorithm]].map(([id,node])=>({dataset:{treeModule:id},closest:()=>node}));
  const root={querySelectorAll:selector=>selector==='[data-tree-module]'?links:branches};
  return {root,branches,hardware,algorithm};
}
test('visiting modules reveals the current path without accumulating open sibling branches',()=>{
  const tree=treeFixture(),state=createConfigurationTreeState();
  state.restore({querySelectorAll:()=>[]});
  state.restore(tree.root,{moduleId:"hw-platform"});
  assert.equal(tree.hardware.open,true);
  for(const moduleId of ['hw-platform','hw-board','foc-current']){
    state.capture(tree.root);state.restore(tree.root,{moduleId,reveal:true});
    assert.equal(tree.branches.filter(b=>b.open).length,1);
  }
  assert.equal(tree.hardware.open,false);assert.equal(tree.algorithm.open,true);
  tree.algorithm.open=false;state.capture(tree.root);state.restore(tree.root,{moduleId:'foc-current'});
  assert.equal(tree.algorithm.open,false);
  tree.hardware.open=true;state.capture(tree.root);state.restore(tree.root,{moduleId:'foc-current'});
  assert.equal(tree.hardware.open,true);assert.equal(tree.algorithm.open,false);
});
