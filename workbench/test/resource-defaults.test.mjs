import { renderResourceEditor } from '../web/src/features/configuration/hardware-view.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { createPresetResource, createResource, resourceIssues, selectAdcChannel } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { ensureCommonResources, resizeCurrentChannels } from '../web/src/modules/hardware/hw-board/resource-defaults.mjs';

const boardOf = project => project.instances['hw-board'].parameters;
const channels = board => board.resources.filter(resource => resource.preset === 'phase-current');

test('new and loaded empty projects contain editable common resources without invented routes', () => {
  for (const project of [createProject(), (() => { const p=createProject(); boardOf(p).resources=[]; return parseProject(serializeProject(p)); })()]) {
    const board=boardOf(project);
    assert.equal(channels(board).length,3);
    assert.equal(board.currentTopology,'three_shunt');
    for (const preset of ['bus-voltage','temperature','pwm']) assert.equal(board.resources.filter(resource=>resource.preset===preset).length,1);
    assert(board.resources.every(resource=>resource.instance===''&&Object.keys(resource.pins).length===0));
    assert.equal(board.resources.length,6);
    const before=structuredClone(board);
    ensureCommonResources(board);
    assert.deepEqual(board,before);
    assert.deepEqual(boardOf(parseProject(serializeProject(project))),board);
  }
});

test('explicit 1/2/3 channel resizing preserves retained settings and other peripherals', () => {
  const board=boardOf(createProject()), initial=channels(board);
  initial[0].instance='ADC1'; initial[0].pins={INP0:'PA0_C'}; initial[0].settings.sampleCycles=8.5;
  initial[1].instance='ADC2'; initial[1].pins={INP1:'PA1_C'};
  const first=structuredClone(initial[0]);
  const other=structuredClone(board.resources.filter(resource=>resource.preset!=='phase-current'));
  for (const [count,topology] of [[2,'two_shunt'],[1,'single_shunt'],[3,'three_shunt']]) {
    resizeCurrentChannels(board,count);
    assert.equal(channels(board).length,count);
    assert.equal(board.currentTopology,topology);
    assert.deepEqual(channels(board)[0],first);
    assert.deepEqual(board.resources.filter(resource=>resource.preset!=='phase-current'),other);
  }
  assert(channels(board).slice(1).every(resource=>resource.instance===''&&Object.keys(resource.pins).length===0));
  const before=structuredClone(board);
  for (const count of [0,4,1.5,'2']) assert.throws(()=>resizeCurrentChannels(board,count),/通道数/);
  assert.deepEqual(board,before);
});

test('explicit multi-channel current groups split without classifying legacy mixed ADCs as current', () => {
  const grouped=createPresetResource('phase-current','grouped');
  grouped.instance='ADC1'; grouped.pins={INP0:'PA0_C',INP9:'PB0',INP10:'PC0'};
  grouped.settings.sampleCycles=8.5;
  const raw=createResource('adc','legacy-mixed');
  raw.instance='ADC3'; raw.pins={INP1:'PC3_C',INP8:'PF6',INP9:'PF4'};
  raw.settings.currentGain=0.025;
  const originalRaw=structuredClone(raw), board={resources:[grouped,raw],currentTopology:'single_shunt'};
  ensureCommonResources(board);
  assert.equal(channels(board).length,3);
  assert.equal(board.currentTopology,'three_shunt');
  assert.deepEqual(channels(board).map(resource=>resource.pins),[{INP0:'PA0_C'},{INP9:'PB0'},{INP10:'PC0'}]);
  assert(channels(board).every(resource=>resource.settings.sampleCycles===8.5));
  assert.deepEqual(board.resources.find(resource=>resource.id===raw.id),originalRaw);
  const before=structuredClone(board);ensureCommonResources(board);assert.deepEqual(board,before);
});

test('fresh NEO resources preserve all known ADC pins while separating current, terminal and bus sampling', () => {
  const project=createNeo75hProject(), board=boardOf(project);
  assert.deepEqual(channels(board).map(resource=>[resource.instance,resource.pins]),[
    ['ADC1',{INP0:'PA0_C'}],['ADC2',{INP1:'PA1_C'}],['ADC3',{INP1:'PC3_C'}],
  ]);
  assert.equal(board.resources.filter(resource=>resource.preset==='terminal-voltage').length,3);
  assert.deepEqual(board.resources.find(resource=>resource.preset==='bus-voltage').pins,{INP9:'PF4'});
  assert.equal(board.resources.find(resource=>resource.preset==='temperature').instance,'');
  assert.deepEqual(resourceIssues(project.target.mcu,board.resources).filter(issue=>issue.level==='error'),[]);
  assert.deepEqual(boardOf(parseProject(serializeProject(project))),board);
});


test('sampling editor shows persisted default groups with one selector per ADC and no removed fields', () => {
  const board=boardOf(createProject());
  for (const count of [1,2,3]) {
    resizeCurrentChannels(board,count);
    const before=structuredClone(board), html=renderResourceEditor('STM32H745IIK6',board.resources);
    assert.equal((html.match(/data-current-channel=/g)||[]).length,count);
    assert.equal((html.match(/data-key="channel"/g)||[]).length,count+2);
    for(const title of ['相电流采样','母线电压采样','温度采样','PWM'])assert.ok(html.includes(title));
    assert.doesNotMatch(html,/<input[^>]*data-key="name"|data-key="(?:trigger|currentGain)"|hardware-presets|添加采样通道/);
    assert.match(html,/<select[^>]*data-key="name"[^>]*aria-label="测量位置"/);
    assert.deepEqual(board,before);
  }
});

test('single ADC channel selection validates before changing pins and round-trips through the project', () => {
  const p=createProject(), board=boardOf(p), bus=board.resources.find(r=>r.preset==='bus-voltage');
  bus.instance='ADC3';
  selectAdcChannel(bus,'STM32H745IIK6','INP9');
  bus.pins.INP9='PF4';
  selectAdcChannel(bus,'STM32H745IIK6','INP9');
  assert.deepEqual(bus.pins,{INP9:'PF4'});
  const before=structuredClone(bus);
  assert.throws(()=>selectAdcChannel(bus,'STM32H745IIK6','INVALID'),/采样通道/);
  assert.deepEqual(bus,before);
  selectAdcChannel(bus,'STM32H745IIK6','INP8');
  assert.deepEqual(bus.pins,{INP8:''});
  assert.deepEqual(boardOf(parseProject(serializeProject(p))).resources.find(r=>r.id===bus.id),bus);
});

test('legacy inline topology and differential negative pins remain visible and preserved', () => {
  const board=boardOf(createProject());board.currentTopology='inline';
  const current=channels(board)[0];current.instance='ADC1';current.pins={INP10:'PC0',INN10:'PC1'};
  ensureCommonResources(board);ensureCommonResources(board);
  assert.equal(board.currentTopology,'inline');
  const html=renderResourceEditor('STM32H745IIK6',board.resources,{currentTopology:board.currentTopology});
  assert.match(html,/相线采样/);assert.match(html,/data-key="INN10"/);
  resizeCurrentChannels(board,2);assert.equal(board.currentTopology,'two_shunt');
});
