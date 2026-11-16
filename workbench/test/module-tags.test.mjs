import test from 'node:test';
import assert from 'node:assert/strict';
import { renderModuleTags, renderModuleToggles } from '../web/src/shared/ui/module-tags.mjs';
const optional = { id:'app-comms', title:'通信', required:false, runtimeSwitchable:true };
test('feature labels show membership without build/runtime terminology',()=>{
  assert.equal(renderModuleTags(undefined),'');
  assert.equal(renderModuleTags({enabled:false,runtimeEnabled:true}),'');
  for(const runtimeEnabled of [true,false]){
    const html=renderModuleTags({enabled:true,runtimeEnabled});
    assert.match(html,/>已添加</);
    assert.doesNotMatch(html,/编译期|运行期|<input/);
  }
});
test('optional features offer add/remove without separate switches',()=>{
  assert.match(renderModuleToggles(optional,{enabled:false,runtimeEnabled:false}),/data-action="add-module" data-module="app-comms"/);
  for(const runtimeEnabled of [true,false]) {
    const html=renderModuleToggles(optional,{enabled:true,runtimeEnabled});
    assert.match(html,/data-action="remove-module" data-module="app-comms"/);
    assert.doesNotMatch(html,/type="checkbox"|toggle-runtime|编译期|运行期/);
  }
});
test('required modules cannot be removed',()=>{
  const html=renderModuleToggles({...optional,required:true},{enabled:true,runtimeEnabled:true});
  assert.equal(html,'');assert.equal(renderModuleTags({enabled:true},{...optional,required:true}),'');assert.doesNotMatch(html,/<input|<button/);
});
test('rendering escapes metadata and preserves existing feature state',()=>{
  const module=Object.freeze({...optional,id:'test"',title:'<img>'});
  const instance=Object.freeze({enabled:true,runtimeEnabled:false});
  const html=renderModuleToggles(module,instance);
  assert.match(html,/data-module="test&quot;"/);assert.match(html,/&lt;img&gt;/);
  assert.equal(instance.runtimeEnabled,false);assert.equal(renderModuleToggles(null,instance),'');
});
