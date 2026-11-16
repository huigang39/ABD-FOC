import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeo75hProject} from '../web/src/profiles/neo75h.mjs';
import {parseProject,serializeProject} from '../web/src/core/model.mjs';
import {fixedAlgorithmChildren,algorithmChildrenIssues,observerOutputIssues,checkAlgorithmChildren} from '../web/src/modules/algorithm/children.mjs';
import {observerChainContracts,observerStages} from '../web/src/modules/algorithm/foc-observer/view.mjs';
import {CHILD_DESIGNS,signalChoices,observerOutputOptions} from '../web/src/modules/algorithm/signals.mjs';
import {OBSERVER_CHILDREN} from '../web/src/modules/algorithm/foc-observer/chains.mjs';
import {runtimeConfiguration} from '../web/src/features/configuration/runtime-config.mjs';
function fixture(){const p=createNeo75hProject(),i=p.instances['foc-observer'];i.enabled=i.runtimeEnabled=true;i.parameters.children=fixedAlgorithmChildren(p,'foc-observer');const m=i.parameters.children.find(c=>c.type==='encoder_tracking_motor'),o=i.parameters.children.find(c=>c.type==='encoder_tracking_output');for(const c of [m,o]){c.compiled=true;c.enabled=true;c.parameters.pllBandwidthHz=100;}return {p,i,m,o};}
const child=(p,id)=>p.instances['foc-observer'].parameters.children.find(c=>c.type===id);
test('两条编码器跟踪链路分别固定电机侧与出轴侧输入',()=>{
 const {p,m,o}=fixture();
 assert.equal(m.routing.source,'sensor.motor_angle');assert.equal(o.routing.source,'sensor.output_angle');
 assert.deepEqual(signalChoices('encoder_tracking_motor',p).map(([id])=>id),['sensor.motor_angle']);
 assert.deepEqual(signalChoices('encoder_tracking_output',p).map(([id])=>id),['sensor.output_angle']);
 checkAlgorithmChildren(p.instances['foc-observer'].parameters.children);
 assert.ok(OBSERVER_CHILDREN.every(t=>!t.id.startsWith('encoder_tracking')||t.title.includes('编码器跟踪')));
});
test('链路契约保持各自的轴侧，输出不跨域',()=>{
 const {m,o}=fixture();
 const dm=observerChainContracts(m),doo=observerChainContracts(o);
 assert.ok(dm.input.some(f=>f.name==='motor_angle'));assert.ok(dm.output.some(f=>f.name==='motor_velocity'));
 assert.ok(!dm.output.some(f=>f.name==='electrical_angle'||f.name==='output_velocity'));
 assert.ok(doo.input.some(f=>f.name==='output_angle'));assert.ok(doo.output.some(f=>f.name==='output_velocity'));
 assert.ok(!doo.output.some(f=>f.name==='motor_velocity'));
 assert.equal(observerStages('encoder_tracking_motor','pll',m)[0],'电机侧机械角度');
 assert.equal(observerStages('encoder_tracking_output','pll',o)[0],'出轴侧机械角度');
});
test('角度形式固定为单圈，不再提供连续角度选项',()=>{
 const {m}=fixture();
 for(const type of OBSERVER_CHILDREN.filter(t=>t.id.startsWith('encoder_tracking')))assert.ok(!type.fields.some(([key])=>key==='angleForm'));
 assert.ok(!Object.hasOwn(m.parameters,'angleForm'));
 assert.ok(observerChainContracts(m).input.some(f=>f.name==='motor_angle'&&f.meaning.includes('单圈')));
 m.parameters.angleForm='continuous';assert.throws(()=>checkAlgorithmChildren([m]),/类型/);
 delete m.parameters.angleForm;
 assert.ok(!CHILD_DESIGNS.encoder_tracking_motor.use.includes('连续角度'));
});
test('发布结果按链路区分，跨域或未编译的选择会被拒绝',()=>{
 const {p,i,m,o}=fixture();
 i.parameters.motorAngleOutput='encoder_tracking_motor.angle';i.parameters.outputAngleOutput='encoder_tracking_output.angle';i.parameters.outputSpeedOutput='encoder_tracking_output.speed';
 assert.ok(!observerOutputIssues(p).some(e=>['motorAngleOutput','outputAngleOutput','outputSpeedOutput'].includes(e.paramKey)));
 assert.ok(observerOutputOptions('outputAngleOutput',p).some(option=>option.value==='encoder_tracking_output.angle'));
 i.parameters.speedOutput='encoder_tracking_output.speed';assert.ok(observerOutputIssues(p).some(e=>e.paramKey==='speedOutput'));
 i.parameters.speedOutput='none';o.compiled=false;
 assert.ok(observerOutputIssues(p).some(e=>e.paramKey==='outputAngleOutput'));
});
test('链路编译时要求对应编码器已配置',()=>{
 const {p}=fixture();
 p.instances['hw-drivers'].parameters.encoderCapability='absent';p.instances['hw-drivers'].parameters.outputEncoderCapability='absent';
 const issues=algorithmChildrenIssues(p);
 assert.ok(issues.some(e=>e.id==='algorithm-routing-encoder_tracking_motor-source-encoder'));
 assert.ok(issues.some(e=>e.id==='algorithm-routing-encoder_tracking_output-source-encoder'));
});
test('旧的单链路配置迁移为固定双链路，电角度跟踪信号移除',()=>{
 const p=createNeo75hProject(),i=p.instances['foc-observer'];
 i.parameters.children=[
  {id:'legacy-out',type:'encoder_tracking',name:'编码器跟踪',compiled:true,enabled:true,routing:{source:'sensor.output_angle'},parameters:{angleForm:'wrapped',extraction:'pll',pllBandwidthHz:80,speedFilterHz:20}},
  {id:'legacy-motor',type:'encoder_tracking',name:'编码器跟踪',compiled:false,enabled:false,routing:{source:'feedback.angle'},parameters:{angleForm:'continuous',extraction:'difference',pllBandwidthHz:null,speedFilterHz:30}},
  {id:'fusion',type:'angle_fusion',name:'电角度选择与融合',compiled:true,enabled:true,routing:{source:'feedback.angle',secondary:'encoder_tracking.electrical_angle',method:'weighted'},parameters:{weight:0.5,transitionMs:0,maxDisagreementRad:0.5}},
 ];
 i.parameters.outputAngleOutput='encoder_tracking.output_angle';i.parameters.angleOutput='encoder_tracking.electrical_angle';i.parameters.torqueOutput='none';
 const saved=parseProject(serializeProject(p));
 const out=child(saved,'encoder_tracking_output'),motor=child(saved,'encoder_tracking_motor'),fusion=child(saved,'angle_fusion');
 checkAlgorithmChildren(saved.instances['foc-observer'].parameters.children);
 assert.equal(out.routing.source,'sensor.output_angle');assert.equal(out.parameters.pllBandwidthHz,80);assert.ok(!Object.hasOwn(out.parameters,'angleForm'));
 assert.equal(motor.routing.source,'sensor.motor_angle');assert.equal(motor.parameters.speedFilterHz,30);
 assert.equal(fusion.routing.secondary,'smo.angle');
 assert.equal(saved.instances['foc-observer'].parameters.outputAngleOutput,'encoder_tracking_output.angle');
 assert.equal(saved.instances['foc-observer'].parameters.angleOutput,'none');
});
test('运行配置随新链路导出，旧角度形式不再出现',()=>{
 const {p}=fixture();
 const restored=parseProject(serializeProject(p));
 const entries=runtimeConfiguration(restored).entries;
 assert.ok(entries.some(e=>e.childId==='encoder_tracking_output'&&e.key==='extraction'));
 assert.ok(!entries.some(e=>e.key==='angleForm'));
 assert.ok(CHILD_DESIGNS.encoder_tracking_output.use.includes('减速比'));
});
test('关闭出轴链路时的估算语义记录在链路说明中',()=>{
 assert.ok(CHILD_DESIGNS.encoder_tracking_output.use.includes('关闭'));
 assert.ok(CHILD_DESIGNS.encoder_tracking_output.use.includes('电机侧'));
 assert.ok(CHILD_DESIGNS.encoder_tracking_output.use.includes('减速比'));
 assert.ok(observerOutputOptions('outputSpeedOutput',null).some(option=>option.value==='encoder_tracking_output.speed'));
});
