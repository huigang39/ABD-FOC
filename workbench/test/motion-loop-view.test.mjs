import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { renderMotionLoops } from '../web/src/modules/application/app-motion/view.mjs';
import { edit } from '../web/src/features/configuration/view.mjs';

const groups=[
  ['torque','力矩环','PID',['torqueKp','torqueKi','torqueKd']],
  ['speed','速度环','PID',['speedKp','speedKi','speedKd']],
  ['position','位置环','PID',['positionKp','positionKi','positionKd']],
  ['pd','PD 环','PD',['pdKp','pdKd']],
];
const fieldHtml=(field,value,scope,moduleId)=>edit(field.label,value,scope,field.key,{section:moduleId,type:field.type,unit:field.unit,min:field.min});
const render=project=>renderMotionLoops(project,fieldHtml);
const card=(html,id)=>html.match(new RegExp(`<section class="hardware-resource motion-loop-card" data-motion-loop="${id}">([\\s\\S]*?)<\\/section>`))[1];
const keys=html=>[...html.matchAll(/<input\b[^>]*data-key="([^"]+)"/g)].map(match=>match[1]);

test('control loop configuration always presents four flat fixed cards with precisely 11 gains',()=>{
  const project=createProject(),before=structuredClone(project),html=render(project);
  assert.deepEqual([...html.matchAll(/data-motion-loop="([^"]+)"/g)].map(match=>match[1]),groups.map(group=>group[0]));
  assert.deepEqual(keys(html),groups.flatMap(group=>group[3]));
  for(const [id,title,controller,gains] of groups){
    const body=card(html,id);
    assert.match(body,new RegExp(`<strong>${title}<\\/strong>`));
    assert.deepEqual(keys(body),gains);
    assert.match(body,new RegExp(`<span class="motion-loop-tags"><span class="attribute-tag">${controller}<\\/span><\\/span><\\/header>`));
    assert.match(body,/icons\.svg#/);
  }
  assert.doesNotMatch(html,/<details|<summary|<select|<button|type="checkbox"|data-action=|高级参数|反馈来源|允许的运行模式|动态电流限值/);
  assert.deepEqual(project,before);
});

test('each gain preserves its own stored value, including zero and unset values',()=>{
  const project=createProject(),parameters=project.instances['app-motion'].parameters;
  Object.assign(parameters,{torqueKp:0,torqueKi:0.25,torqueKd:null,speedKp:1.5,speedKi:2,speedKd:0.05,positionKp:3,positionKi:4,positionKd:5,pdKp:6,pdKd:7});
  const before=structuredClone(project),values=new Map();
  renderMotionLoops(project,(field,value)=>{values.set(field.key,value);return fieldHtml(field,value,'module','app-motion');});
  for(const key of groups.flatMap(group=>group[3]))assert.equal(values.get(key),parameters[key]);
  assert.deepEqual(project,before);
});

test('mode, feedback, profile and other saved motion settings cannot restore removed controls',()=>{
  const project=createProject(),parameters=project.instances['app-motion'].parameters;
  Object.assign(parameters,{supportedModes:['speed','position','impedance','torque_feedback'],activeMode:'impedance',commandSource:'communication',outerHz:1000,currentLimitA:10,positionFeedback:'output_encoder',speedFeedbackSignal:'instance:old:speed',profileVelocityRadS:20,speedFilterHz:30});
  const before=structuredClone(project),html=render(project);
  assert.deepEqual(keys(html),groups.flatMap(group=>group[3]));
  for(const key of ['supportedModes','activeMode','commandSource','outerHz','currentLimitA','positionFeedback','speedFeedbackSignal','profileVelocityRadS','speedFilterHz'])assert.ok(!html.includes(`data-key="${key}"`));
  assert.doesNotMatch(html,/instance:old:speed|communication|output_encoder/);
  assert.deepEqual(project,before);
});

test('the same flat view supplies field metadata and values to configuration or runtime renderers',()=>{
  const project=createProject(),received=[];
  const html=renderMotionLoops(project,(field,value,scope,moduleId)=>{
    received.push({field,value,scope,moduleId});
    return `<output data-runtime-key="${field.key}"></output>`;
  });
  assert.equal(received.length,11);
  for(const entry of received){
    assert.equal(entry.scope,'module');
    assert.equal(entry.moduleId,'app-motion');
    assert.ok(['Kp','Ki','Kd'].includes(entry.field.label));
    assert.equal(entry.field.type,'number');
    assert.equal(entry.value,null);
  }
  assert.equal((html.match(/data-runtime-key=/g)||[]).length,11);
  assert.doesNotMatch(html,/<details|<summary|<button|data-action=/);
});
