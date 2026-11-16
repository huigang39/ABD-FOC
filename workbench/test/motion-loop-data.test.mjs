import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,parseProject,serializeProject,validateProject,MODULES} from '../web/src/core/model.mjs';
import {MOTION_LOOPS,MOTION_GAIN_FIELDS,MOTION_GAIN_KEYS} from '../web/src/modules/application/app-motion/loops.mjs';
import {migrateMotionLoopParameters} from '../web/src/modules/application/app-motion/migration.mjs';
import {parameterVisible} from '../web/src/modules/shared/visibility.mjs';
import {saveLayerVersion,applyLayerVersion,layerMatchesRelease} from '../web/src/features/configuration/versions.mjs';
import {createActuator,createDriver,createJointModule} from '../web/src/features/equipment/model.mjs';
import {createPerformanceDraft,savePerformanceRecord,checkPerformanceRecordShape,getAssemblyTests} from '../web/src/features/performance/model.mjs';
import {validateCia402} from '../web/src/modules/application/app-state/cia402.mjs';
const motion=p=>p.instances['app-motion'].parameters;
const introduced=MOTION_GAIN_KEYS.filter(key=>!['speedKp','speedKi'].includes(key));
const omitNew=parameters=>{for(const key of introduced)delete parameters[key];};
function recordedProject(){
 let p=createProject();p.catalog.actuators.push(createActuator('测试执行器'));p.catalog.drivers.push(createDriver('测试驱动器'));
 const assembly=createJointModule(p,{actuatorId:p.catalog.actuators[0].id,driverId:p.catalog.drivers[0].id});p.catalog.assemblies.push(assembly);p.catalog.activeAssemblyId=assembly.id;
 const draft=createPerformanceDraft(p);draft.measuredAt='2026-11-17';draft.firmwareId='test-firmware';draft.samples=[{currentA:1,torqueNm:2,series:'测试'}];
 p=savePerformanceRecord(p,draft);return p;
}

test('four fixed loops expose only eleven gains irrespective of historical supported modes',()=>{
 const p=createProject(),definition=MODULES.find(module=>module.id==='app-motion');
 assert.deepEqual(MOTION_LOOPS.map(loop=>[loop.title,loop.controller,loop.keys.length]),[['力矩环','PID',3],['速度环','PID',3],['位置环','PID',3],['PD 环','PD',2]]);
 assert.equal(new Set(MOTION_GAIN_KEYS).size,11);assert.deepEqual(definition.params.filter(field=>!field.hidden).map(field=>field.key),MOTION_GAIN_KEYS);
 for(const activeMode of ['unselected','current','speed','position','impedance','torque_feedback']){
  motion(p).activeMode=activeMode;motion(p).supportedModes=activeMode==='unselected'?[]:[activeMode];
  assert.deepEqual(definition.params.filter(field=>parameterVisible(p,'app-motion',field)).map(field=>field.key),MOTION_GAIN_KEYS);
 }
 assert(Object.values(Object.fromEntries(MOTION_GAIN_KEYS.map(key=>[key,motion(p)[key]]))).every(value=>value===null));
 assert(MOTION_GAIN_FIELDS.every(field=>field.min===0&&field.required===false));
 const units=Object.fromEntries(MOTION_GAIN_FIELDS.map(field=>[field.key,field.unit]));
 assert.equal(units.speedKp,'A/(rad/s)');assert.equal(units.speedKi,'A/rad');assert.equal(units.positionKp,'1/s');assert.equal(units.positionKi,'1/s²');assert.equal(units.positionKd,'');assert.equal(units.pdKd,'N·m/(rad/s)');
});

test('gains accept zero or missing values without requiring hidden old controls, and reject negative/nonfinite entries',()=>{
 const p=createProject();for(const key of MOTION_GAIN_KEYS)motion(p)[key]=0;
 assert(!validateProject(p).some(issue=>issue.moduleId==='app-motion'&&issue.id.startsWith('missing-')));
 assert(!validateProject(p).some(issue=>issue.id.startsWith('range-app-motion')));
 for(const key of MOTION_GAIN_KEYS){motion(p)[key]=-0.5;assert(validateProject(p).some(issue=>issue.id===`range-app-motion-${key}`));motion(p)[key]=null;}
 motion(p).positionFeedback='unselected';motion(p).supportedModes=['position'];motion(p).activeMode='position';assert(!validateProject(p).some(issue=>issue.id==='position-source'));
 motion(p).pdKd=Infinity;assert.throws(()=>serializeProject(p),/有限数字/);
});

test('gain migration fills only absent slots and preserves zeros, old gain values and unrelated configuration',()=>{
 const instances={'app-motion':{parameters:{speedKp:3.25,speedKi:0,torqueKd:0,pdKp:null,supportedModes:['speed'],profileVelocityRadS:4}}};
 const before=structuredClone(instances);migrateMotionLoopParameters(instances);
 for(const [key,value] of Object.entries(before['app-motion'].parameters))assert.deepEqual(instances['app-motion'].parameters[key],value);
 assert(MOTION_GAIN_KEYS.every(key=>Object.hasOwn(instances['app-motion'].parameters,key)));
 const once=structuredClone(instances);migrateMotionLoopParameters(instances);assert.deepEqual(instances,once);
 assert.doesNotThrow(()=>migrateMotionLoopParameters({}));assert.equal(instances['app-motion'].parameters.speedKi,0);
});

test('old active projects, detached application releases and performance snapshots gain null slots on import',()=>{
 let p=recordedProject();Object.assign(motion(p),{speedKp:3.25,speedKi:0,outerHz:777,profileVelocityRadS:4});
 p=saveLayerVersion(p,{layer:'app',version:'旧控制参数'});
 const recordMotion=p.performance.records[0].snapshot.layers.app.configuration['app-motion'].parameters;recordMotion.speedKp=8;recordMotion.speedKi=0;
 for(const parameters of [motion(p),p.layerVersions.releases[0].snapshot.instances['app-motion'].parameters,recordMotion])omitNew(parameters);
 const before=structuredClone(p),restored=parseProject(JSON.stringify(p));assert.deepEqual(p,before);
 for(const parameters of [motion(restored),restored.layerVersions.releases[0].snapshot.instances['app-motion'].parameters,restored.performance.records[0].snapshot.layers.app.configuration['app-motion'].parameters]){
  assert(introduced.every(key=>parameters[key]===null));assert.equal(parameters.speedKi,0);
 }
 assert.equal(motion(restored).speedKp,3.25);assert.equal(restored.performance.records[0].snapshot.layers.app.configuration['app-motion'].parameters.speedKp,8);
 assert.equal(motion(restored).outerHz,777);assert.equal(motion(restored).profileVelocityRadS,4);
 const saved=JSON.parse(serializeProject(p));assert(introduced.every(key=>saved.instances['app-motion'].parameters[key]===null));assert.deepEqual(p,before);
});

test('direct application-version restore and historical performance checks normalize old gain schemas without mutating history',()=>{
 let p=createProject();Object.assign(motion(p),{speedKp:6,speedKi:0});p=saveLayerVersion(p,{layer:'app',version:'控制参数旧版'});
 const release=p.layerVersions.releases[0];omitNew(release.snapshot.instances['app-motion'].parameters);const oldRelease=structuredClone(release);
 assert.equal(layerMatchesRelease(p,'app',release),true);
 motion(p).pdKp=5;const restored=applyLayerVersion(p,'app');assert.equal(motion(restored).pdKp,null);assert.equal(motion(restored).speedKp,6);assert.deepEqual(release,oldRelease);
 const recorded=recordedProject(),record=recorded.performance.records[0];omitNew(record.snapshot.layers.app.configuration['app-motion'].parameters);const oldRecord=structuredClone(record);
 assert.equal(checkPerformanceRecordShape(record),true);assert.equal(getAssemblyTests(recorded,recorded.catalog.activeAssemblyId)[0].historical,false);assert.deepEqual(record,oldRecord);
 motion(recorded).torqueKp=2;assert.equal(getAssemblyTests(recorded,recorded.catalog.activeAssemblyId)[0].historical,true);
});

test('retained timing, hardware and protocol constraints are reported at the module that owns their configuration',()=>{
 const p=createProject();Object.assign(p.instances['hw-board'].parameters,{pwmHz:20000,currentLoopDivider:1});motion(p).outerHz=20000;
 assert.equal(validateProject(p).find(issue=>issue.id==='outer-rate').moduleId,'app-runtime');motion(p).outerHz=0;assert.equal(validateProject(p).find(issue=>issue.id==='positive-app-motion-outerHz').moduleId,'app-runtime');
 Object.assign(motion(p),{supportedModes:['torque_feedback'],activeMode:'torque_feedback',positionFeedback:'output_encoder'});Object.assign(p.instances['hw-drivers'].parameters,{torqueCapability:'absent',outputEncoderCapability:'absent'});
 for(const key of ['torqueCapability','outputEncoderCapability']){const issue=validateProject(p).find(issue=>issue.id===`capability-${key}-app-motion`);assert.equal(issue.moduleId,'hw-drivers');assert.equal(issue.paramKey,key);}
 Object.assign(p.instances['app-state'].parameters,{stateMachine:'cia402',cia402Modes:['pp']});
 const profileIssues=validateCia402(p).filter(issue=>issue.id.startsWith('cia402-profile-missing-'));assert(profileIssues.length>0);assert(profileIssues.every(issue=>issue.moduleId==='app-state'&&issue.paramKey==='cia402Modes'));
 motion(p).currentLimitA=100;p.instances['foc-lifecycle'].parameters.maxCurrentA=1;assert(validateProject(p).some(issue=>issue.id==='current-limit'&&issue.level==='error'));
});
