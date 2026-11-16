import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { SENSOR_PARAMS, sensorFieldVisible, sensorFieldRequired, sensorIssues, isDiscreteGate } from '../web/src/modules/hardware/hw-drivers/sensors.mjs';
import { createDriverCommand } from '../web/src/modules/hardware/hw-drivers/protocol.mjs';
import { validateHardware, syncSensorResource } from '../web/src/modules/hardware/hw-board/validation.mjs';
import { createResource } from '../web/src/modules/hardware/hw-board/resources.mjs';

const parameters = project => project.instances['hw-drivers'].parameters;
const makeProject = model => {
  const project = createProject();
  project.target = { vendor:'st', mcu:'STM32H745IIK6', board:'' };
  Object.assign(parameters(project), { gateDriverCapability:'present', gateDriverModel:model });
  return project;
};
const gateHardwareIssues = project => validateHardware(project).filter(issue => issue.id.startsWith('hardware-gate-'));

test('both gate variants require enable pin while hidden enable level and discrete communication stay optional', () => {
  for (const model of ['DRV8353S','discrete']) {
    const project = makeProject(model), p = parameters(project);
    for (const key of ['gateDriverEnablePin']) {
      const field=SENSOR_PARAMS.find(field=>field.key===key);
      assert.equal(sensorFieldVisible(field,p),true);
      assert.equal(sensorFieldRequired(field,p),true);
      assert(sensorIssues(p).some(issue=>issue.paramKey===key));
    }
    const level=SENSOR_PARAMS.find(field=>field.key==='gateDriverEnableLevel');
    assert.equal(sensorFieldVisible(level,p),false);
    assert.equal(sensorFieldRequired(level,p),false);
    for (const suffix of ['Interface','Resource','TimeoutUs']) {
      const field=SENSOR_PARAMS.find(field=>field.key==='gateDriver'+suffix);
      const shown=model!=='discrete'&&suffix!=='Interface';
      assert.equal(sensorFieldVisible(field,p),shown);
      assert.equal(sensorFieldRequired(field,p),shown);
    }
    assert.equal(isDiscreteGate(p),model==='discrete');
  }
});

test('switching a gate to discrete ignores stale communication settings and preserves them for export', () => {
  const project=makeProject('discrete'), p=parameters(project);
  Object.assign(p,{gateDriverEnablePin:'PE1',gateDriverEnableLevel:'low',gateDriverInterface:'spi',gateDriverResource:'missing-bus',gateDriverTimeoutUs:null,gateDriverBitrate:1000000,gateDriverCommands:[createDriverCommand('data','legacy-data')]});
  const before=structuredClone(p);
  assert.deepEqual(sensorIssues(p),[]);
  assert.deepEqual(gateHardwareIssues(project),[]);
  syncSensorResource(p,[{id:'missing-bus',settings:{clockHz:2000000}}]);
  assert.deepEqual(p,before);
  const imported=parameters(parseProject(serializeProject(project)));
  assert.equal(imported.gateDriverModel,'discrete');
  for (const key of Object.keys(p).filter(key=>key.startsWith('gateDriver'))) assert.deepEqual(imported[key],p[key]);
});

test('gate enable GPIO validation permits a matching output declaration and rejects other uses', () => {
  const project=makeProject('discrete'), p=parameters(project);
  Object.assign(p,{gateDriverEnablePin:'PE1',gateDriverEnableLevel:'low'});
  const gpio=createResource('gpio','gate-enable');
  gpio.instance='GPIO';gpio.pins.IO='PE1';Object.assign(gpio.settings,{direction:'output',pull:'none',initialLevel:'high'});
  project.instances['hw-board'].parameters.resources.push(gpio);
  assert.deepEqual(gateHardwareIssues(project),[]);
  gpio.settings.direction='input';
  assert(gateHardwareIssues(project).some(issue=>issue.id==='hardware-gate-enable-pin-conflict'));
  p.gateDriverEnablePin='PZ99';
  assert(gateHardwareIssues(project).some(issue=>issue.id==='hardware-gate-enable-pin'));
  p.gateDriverCapability='absent';
  assert.deepEqual(gateHardwareIssues(project),[]);
});

test('loading legacy parameters adds enable fields without enabling a gate or guessing its level', () => {
  const project=createProject(), p=parameters(project);
  p.gateDriverCapability='absent';
  delete p.gateDriverEnablePin;delete p.gateDriverEnableLevel;
  const restored=parameters(parseProject(JSON.stringify(project)));
  assert.equal(restored.gateDriverCapability,'absent');
  assert.equal(restored.gateDriverEnablePin,'');
  assert.equal(restored.gateDriverEnableLevel,'unselected');
  assert.equal(SENSOR_PARAMS.find(field=>field.key==='gateDriverModel').sensorLayoutTrigger,true);
});
