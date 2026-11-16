import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { SENSOR_PARAMS, applyEncoderModel, encoderInterfaceForModel, sensorFieldVisible, sensorFieldRequired, sensorIssues } from '../web/src/modules/hardware/hw-drivers/sensors.mjs';

const params = project => project.instances['hw-drivers'].parameters;

test('explicit GW and JG model selections fix RS-485 transport without inventing protocol values', () => {
  for (const [prefix,capability] of [['motorEncoder','encoderCapability'],['outputEncoder','outputEncoderCapability']]) {
    for (const [model,vendor] of [['MC_ENCODER_GW_OUTER','gongwang'],['MC_ENCODER_GW_INNER','gongwang'],['GW 外圈','gongwang'],['GW 内圈','gongwang'],['MC_ENCODER_JG','jingang']]) {
      const p=params(createNeo75hProject()), before=structuredClone(p);
      const expected={...before,[prefix+'Model']:model,[prefix+'Vendor']:vendor,[prefix+'Interface']:'rs485',[capability]:'present'};
      applyEncoderModel(p,prefix,model);
      assert.deepEqual(p,expected);
      assert.equal(encoderInterfaceForModel(model),'rs485');
      const field=SENSOR_PARAMS.find(field=>field.key===prefix+'Interface');
      assert.equal(sensorFieldVisible(field,p),false);
      assert.equal(sensorFieldRequired(field,p),false);
    }
  }
});

test('new encoder models leave unknown baud and frame settings unknown', () => {
  const p=params(createProject());
  applyEncoderModel(p,'motorEncoder','MC_ENCODER_JG');
  assert.equal(p.encoderCapability,'present');
  assert.equal(p.motorEncoderBitrate,null);
  assert.deepEqual(p.motorEncoderCommands,[]);
  assert.equal(p.motorEncoderResource,'');
  assert(sensorIssues(p).some(issue=>issue.paramKey==='motorEncoderCommands'));
});

test('unknown imported encoder models retain editable communication and are not auto-enabled', () => {
  const p=params(createProject());
  Object.assign(p,{encoderCapability:'absent',motorEncoderInterface:'spi',motorEncoderVendor:'other'});
  const before=structuredClone(p);
  applyEncoderModel(p,'motorEncoder','CUSTOM_ENCODER');
  assert.deepEqual(p,{...before,motorEncoderModel:'CUSTOM_ENCODER'});
  assert.equal(encoderInterfaceForModel('CUSTOM_ENCODER'),'');
  p.encoderCapability='present';
  assert.equal(sensorFieldVisible(SENSOR_PARAMS.find(field=>field.key==='motorEncoderInterface'),p),true);
  const saved=structuredClone(p);
  assert.throws(()=>applyEncoderModel(p,'torqueSensor','MC_ENCODER_JG'),/型号配置无效/);
  assert.deepEqual(p,saved);
});

test('legacy GW UART storage survives import while incompatible known-model interfaces require model reselection', () => {
  const project=createNeo75hProject(), p=params(project);
  assert.equal(p.motorEncoderInterface,'uart');
  assert.equal(params(parseProject(serializeProject(project))).motorEncoderInterface,'uart');
  assert(!sensorIssues(p).some(issue=>issue.id==='sensor-motorEncodermodel-interface'));
  p.motorEncoderInterface='spi';
  assert(sensorIssues(p).some(issue=>issue.paramKey==='motorEncoderModel'&&issue.level==='error'));
  applyEncoderModel(p,'motorEncoder',p.motorEncoderModel);
  assert.equal(p.motorEncoderInterface,'rs485');
  assert(!sensorIssues(p).some(issue=>issue.id==='sensor-motorEncodermodel-interface'));
});
