import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeo75hProject} from '../web/src/profiles/neo75h.mjs';
import {fixedAlgorithmChildren,checkAlgorithmChildren,algorithmChildrenIssues,algorithmExecutionPlan,CHILD_TYPES} from '../web/src/modules/algorithm/children.mjs';
import {signalChoices,SIGNALS} from '../web/src/modules/algorithm/signals.mjs';
function fixture(){const p=createNeo75hProject();for(const id of Object.keys(CHILD_TYPES)){p.instances[id].enabled=true;p.instances[id].runtimeEnabled=true;p.instances[id].parameters.children=fixedAlgorithmChildren(p,id);}return p;}
test('signal options preserve physical quantity and reject self connection',()=>{
 assert.ok(signalChoices('angle_fusion').every(([id])=>SIGNALS.find(s=>s.id===id).quantity==='electrical-angle'&&!id.startsWith('angle_fusion')));
 assert.ok(signalChoices('friction').every(([id])=>SIGNALS.find(s=>s.id===id).quantity==='motor-speed'));
 const p=fixture(),c=p.instances['foc-observer'].parameters.children;
 c[0].routing.source='sampling.current';assert.throws(()=>checkAlgorithmChildren(c),/物理量|类型/);
});
test('fusion checks disabled producer, duplicate source, and weight',()=>{
 const p=fixture(),c=p.instances['foc-observer'].parameters.children.find(c=>c.type==='angle_fusion');c.compiled=true;c.enabled=true;c.parameters.weight=2;
 let issues=algorithmChildrenIssues(p);assert.ok(issues.some(i=>i.id.includes(c.id+'-weight')));assert.ok(issues.some(i=>i.message.includes('输入来源没有编译')));
 c.routing.secondary=c.routing.source;issues=algorithmChildrenIssues(p);assert.ok(issues.some(i=>i.id.endsWith('-duplicate')));
});
test('execution orders producers before consumers and rejects same-cycle loops',()=>{
 const p=fixture(),list=p.instances['foc-observer'].parameters.children;
 const pll=list.find(c=>c.type==='encoder_tracking_motor'),fusion=list.find(c=>c.type==='angle_fusion');pll.compiled=fusion.compiled=true;fusion.routing.secondary='encoder_tracking_motor.speed';
 let plan=algorithmExecutionPlan(p);assert.equal(plan.cycle,false);assert.ok(plan.order.indexOf('encoder_tracking_motor')<plan.order.indexOf('angle_fusion'));
 pll.routing.source='angle_fusion.angle';plan=algorithmExecutionPlan(p);assert.equal(plan.cycle,true);assert.deepEqual(plan.order,[]);
});
test('child connection configuration survives JSON and excludes removed modules',()=>{
 const p=fixture();for(const id of Object.keys(CHILD_TYPES))checkAlgorithmChildren(JSON.parse(JSON.stringify(p.instances[id].parameters.children)));
 assert.ok(!CHILD_TYPES['foc-compensation'].some(c=>['gravity','inertia'].includes(c.id)));
});
test('current offset measurement uses acquisition settings and conditional PWM duty',()=>{
 const p=fixture(),child=p.instances['foc-compensation'].parameters.children.find(c=>c.type==='current_calibration');
 child.compiled=true;Object.assign(child.parameters,{sampleIntervalUs:50,settlingMs:10,durationMs:100,pwmEnabled:false});
 checkAlgorithmChildren(p.instances['foc-compensation'].parameters.children);
 assert.ok(!Object.keys(child.parameters).some(k=>/Gain|Offset/.test(k)));
 assert.ok(!algorithmChildrenIssues(p).some(i=>i.id.endsWith('current_calibration-pwmDutyPercent')));
 child.parameters.pwmEnabled=true;assert.ok(algorithmChildrenIssues(p).some(i=>i.id.endsWith('current_calibration-pwmDutyPercent')));
 child.parameters.pwmDutyPercent=50;assert.ok(!algorithmChildrenIssues(p).some(i=>i.id.endsWith('current_calibration-pwmDutyPercent')));
 child.parameters.durationMs=0.01;assert.ok(algorithmChildrenIssues(p).some(i=>i.id.endsWith('current_calibration-duration')));
 assert.ok(!CHILD_TYPES['foc-compensation'].some(c=>c.id==='angle_offset'));
});

test('capture on enable is a persisted boolean, disabled by default',()=>{
 const p=fixture(),children=p.instances['foc-compensation'].parameters.children;
 const child=children.find(c=>c.type==='current_calibration');
 assert.equal(child.parameters.captureOnEnable,false);
 child.parameters.captureOnEnable=true;
 const saved=JSON.parse(JSON.stringify(children));checkAlgorithmChildren(saved);
 assert.equal(saved.find(c=>c.type==='current_calibration').parameters.captureOnEnable,true);
 child.parameters.captureOnEnable=1;assert.throws(()=>checkAlgorithmChildren(children),/类型/);
});
