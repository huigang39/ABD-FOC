import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { MODULES } from '../web/src/modules/registry.mjs';
import { parameterModuleRoute, resolveParameterModule, renderModuleParameters } from '../web/src/features/configuration/parameters-view.mjs';

test('standalone module pages stay within the selected layer and only render selected parameters', () => {
  const project = createNeo75hProject('KW'), before = structuredClone(project);
  for (const [layer, selected] of [['hardware','hw-drivers'],['foc','foc-current'],['app','app-calibration']]) {
    const calls = [];
    const html = renderModuleParameters(project,layer,selected,{parameters:module=>{calls.push(module.id);return `<input data-module="${module.id}" data-key="test">`;}});
    assert.deepEqual(calls,[selected]);
    assert.match(html,new RegExp(`data-parameter-module="${selected}"`));
    assert.doesNotMatch(html,/#\/project|data-tree-step|data-tree-branch|data-native-action|构建|烧录|data-action="save"/);
    for (const module of MODULES.filter(item=>item.layer===layer&&!['foc-feedback','foc-lifecycle','hw-safety'].includes(item.id))) assert.ok(html.includes(parameterModuleRoute(module.id)));
    for (const [,route] of html.matchAll(/href="([^"]+)"/g)) assert.ok(route==='#/architecture'||route.startsWith(`#/parameters/${layer}?module=`));
  }
  assert.deepEqual(project,before);
});

test('parameter sidebar reuses the numbered project directory with only current-layer leaves', () => {
  const project=createNeo75hProject('KW');
  const html=renderModuleParameters(project,'hardware','hw-board');
  assert.match(html,/class="module-parameters-page configuration-workflow"/);
  assert.match(html,/class="guide-layout"/);
  assert.match(html,/class="module-parameters-sidebar configuration-tree guide-steps"/);
  assert.match(html,/class="configuration-tree-heading"/);
  assert.match(html,/class="guide-content module-parameters-editor"/);
  assert.match(html,/class="guide-summary module-parameters-toolbar"/);
  assert.match(html,/class="guide-summary-copy"/);
  assert.match(html,/class="guide-summary-actions"/);
  const sidebar=html.match(/<nav\b[\s\S]*?<\/nav>/)[0];
  const modules=resolveParameterModule('hardware','hw-board').modules;
  assert.equal((sidebar.match(/class="configuration-tree-item configuration-module-leaf"/g)||[]).length,modules.length);
  assert.deepEqual([...sidebar.matchAll(/class="step-index">(\d+)</g)].map(match=>match[1]),modules.map((_,index)=>String(index+1).padStart(2,'0')));
  assert.match(sidebar,/<a class="guide-step active" href="#\/parameters\/hardware\?module=hw-board" aria-current="page"/);
  assert.doesNotMatch(sidebar,/<details|<summary|class="button|class="tree-chevron"/);
});

test('unimplemented device parameter transfer remains explicitly unavailable on every module', () => {
  const project = createNeo75hProject('KW');
  for (const module of MODULES.filter(item=>item.id!=='foc-feedback')) {
    const html=renderModuleParameters(project,module.layer,module.id);
    assert.match(html,/设备参数通道未接入/);
    for (const action of ['read','write']) assert.match(html,new RegExp(`<button[^>]*data-parameter-action="${action}"[^>]* disabled[^>]*>`));
    assert.doesNotMatch(html,/data-native-action|设备参数已读取|设备参数已写入/);
  }
});

test('invalid module selections cannot escape their layer, and feedback resolves to current-loop parameters', () => {
  assert.equal(resolveParameterModule('hardware','app-motion').module.id,'hw-platform');
  assert.equal(resolveParameterModule('foc','missing').module.id,'foc-current');
  assert.equal(resolveParameterModule('app','').module.id,'app-runtime');
  assert.equal(resolveParameterModule('foc','foc-feedback').module.id,'foc-current');
  assert.equal(resolveParameterModule('missing','hw-platform'),null);
  assert.equal(parameterModuleRoute('foc-feedback'),'#/parameters/foc?module=foc-current');
  assert.equal(resolveParameterModule('foc','foc-lifecycle').module.id,'foc-current');
  assert.equal(parameterModuleRoute('foc-lifecycle'),'#/parameters/foc?module=foc-current');
  assert.deepEqual(resolveParameterModule('foc','foc-lifecycle').modules.map(module=>module.id),['foc-current','foc-modulation','foc-observer','foc-filter','foc-compensation']);
  assert.doesNotMatch(renderModuleParameters(createNeo75hProject('KW'),'foc','foc-lifecycle'),/module=foc-lifecycle|data-parameter-module="foc-lifecycle"/);
  assert.equal(resolveParameterModule('hardware','hw-safety').module.id,'hw-platform');
  assert.equal(parameterModuleRoute('hw-safety'),'#/parameters/hardware?module=hw-platform');
  assert.deepEqual(resolveParameterModule('hardware','hw-safety').modules.map(module=>module.id),['hw-platform','hw-board','hw-drivers']);
  assert.equal(parameterModuleRoute('missing'),'#/architecture');
  assert.match(renderModuleParameters(createNeo75hProject('KW'),'missing','hw-platform'),/未找到参数模块/);
});
