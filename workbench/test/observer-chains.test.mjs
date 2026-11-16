import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeo75hProject} from '../web/src/profiles/neo75h.mjs';
import {parseProject,serializeProject} from '../web/src/core/model.mjs';
import {fixedAlgorithmChildren,checkAlgorithmChildren,algorithmChildrenIssues,observerOutputIssues,observerUsesModelAngle} from '../web/src/modules/algorithm/children.mjs';
import {childParameterVisible,OBSERVER_CHILDREN} from '../web/src/modules/algorithm/foc-observer/chains.mjs';
import {observerChainContracts,observerStages} from '../web/src/modules/algorithm/foc-observer/view.mjs';
import {runtimeConfiguration,renderRuntimeConfiguration} from '../web/src/features/configuration/runtime-config.mjs';
import {MODULE_CODE} from '../native/generator/modules.mjs';
import {renderAlgorithmChildren} from '../web/src/modules/algorithm/children-view.mjs';
import {MODULES} from '../web/src/core/catalog.mjs';
function fixture(){const p=createNeo75hProject(),i=p.instances['foc-observer'];i.enabled=i.runtimeEnabled=true;i.parameters.children=fixedAlgorithmChildren(p,'foc-observer');return p;}
const child=(p,id)=>p.instances['foc-observer'].parameters.children.find(c=>c.type===id);
const visible=c=>OBSERVER_CHILDREN.find(t=>t.id===c.type).fields.filter(f=>childParameterVisible(c,f)).map(f=>f[0]);
test('SMO and flux have independent estimator/extractor settings; encoder does not use atan2',()=>{
 const p=fixture(),s=child(p,'smo'),f=child(p,'flux'),e=child(p,'encoder_tracking_motor');
 assert.ok(visible(s).includes('pllBandwidthHz'));assert.ok(!visible(s).includes('speedFilterHz'));
 s.parameters.extraction='atan2';assert.ok(!visible(s).includes('pllBandwidthHz'));assert.ok(visible(s).includes('speedFilterHz'));
 assert.equal(f.parameters.extraction,'pll');e.parameters.extraction='atan2';assert.throws(()=>checkAlgorithmChildren(p.instances['foc-observer'].parameters.children),/类型/);
 assert.ok(observerStages('smo','atan2').includes('反电动势估算'));assert.ok(observerStages('flux').includes('转子磁链估算'));
});
test('unselected results and inactive producers cannot supply electrical angle',()=>{
 const p=fixture(),i=p.instances['foc-observer'];p.instances['foc-feedback'].parameters.angleSource='observer';
 assert.ok(observerOutputIssues(p).some(i=>i.paramKey==='angleOutput'));
 i.parameters.angleOutput='smo.angle';assert.ok(observerOutputIssues(p).some(i=>i.paramKey==='angleOutput'));
 Object.assign(child(p,'smo'),{compiled:true,enabled:true});assert.ok(!observerOutputIssues(p).some(i=>i.paramKey==='angleOutput'));
 child(p,'smo').enabled=false;assert.ok(observerOutputIssues(p).some(i=>i.paramKey==='angleOutput'));
});
test('visible bandwidth and signal thresholds are checked; unused extraction settings are ignored',()=>{
 const p=fixture(),s=child(p,'smo');s.compiled=true;
 Object.assign(s.parameters,{gain:5,boundary:.1,emfFilterHz:100,pllBandwidthHz:100,validTimeMs:10,signalFloor:.2});
 assert.ok(!algorithmChildrenIssues(p).some(i=>i.id.startsWith('algorithm-routing-smo-')));
 s.parameters.pllBandwidthHz=1e9;assert.ok(algorithmChildrenIssues(p).some(i=>i.id==='algorithm-routing-smo-pllBandwidthHz-rate'));
 s.parameters.extraction='atan2';s.parameters.speedFilterHz=50;assert.ok(!algorithmChildrenIssues(p).some(i=>i.id.includes('smo-pllBandwidthHz')));
 s.parameters.signalFloor=0;assert.ok(algorithmChildrenIssues(p).some(i=>i.id==='algorithm-routing-smo-signalFloor'));
});
test('JSON and runtime export preserve each chain; compiled-out chains are excluded',()=>{
 const p=fixture(),s=child(p,'smo');Object.assign(s,{compiled:true,enabled:true});s.parameters.extraction='atan2';s.parameters.speedFilterHz=50;
 const restored=parseProject(serializeProject(p));assert.equal(child(restored,'smo').parameters.extraction,'atan2');
 const entries=runtimeConfiguration(restored).entries.filter(e=>e.childId==='smo');
 assert.ok(entries.some(e=>e.key==='extraction'&&e.value==='atan2'));assert.ok(entries.some(e=>e.key==='enabled'&&e.value===true));assert.ok(!entries.some(e=>e.key==='pllBandwidthHz'));
 assert.ok(!runtimeConfiguration(p).entries.some(e=>e.childId==='flux'));
 const html=renderRuntimeConfiguration(p,()=>'<input>');assert.match(html,/data-edit="algorithm-child"[^>]+data-id="smo"/);
});
test('chain data and UI describe rotor quantities rather than a generic stand-alone PLL',()=>{
 const p=fixture(),s=child(p,'smo');s.compiled=true;s.parameters.extraction='atan2';
 const data=observerChainContracts(s);assert.ok(data.output.some(f=>f.name==='back_emf_alpha_beta'&&f.unit==='V'));assert.ok(data.output.some(f=>f.name==='motor_velocity'));assert.ok(data.input.some(f=>f.name==='applied_voltage_alpha_beta'));
 const html=renderAlgorithmChildren(p,MODULES.find(m=>m.id==='foc-observer'),'<span>发布来源</span>');
 assert.match(html,/data-key="gain"/);assert.match(html,/data-key="emfFilterHz"/);assert.match(html,/反正切 \+ 速度滤波/);assert.match(html,/待替换/);assert.doesNotMatch(html,/PLL 观测器|observer-guide|observer-stages|observer-contract-notes|data-edit="algorithm-routing"|发布来源/);
 assert.throws(()=>MODULE_CODE['foc-observer'].values(p),/不能用单一 PLL 模板代替/);
});

test('model-based startup is conditional on actual commutation use',()=>{
 const p=fixture(),i=p.instances['foc-observer'];i.parameters.angleOutput='smo.angle';
 assert.equal(observerUsesModelAngle(p),false);
 p.instances['foc-feedback'].parameters.angleSource='observer';assert.equal(observerUsesModelAngle(p),true);
 i.parameters.angleOutput='encoder_tracking_output.angle';assert.equal(observerUsesModelAngle(p),false);
 i.parameters.angleOutput='angle_fusion.angle';assert.equal(observerUsesModelAngle(p),true);
});
