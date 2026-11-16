import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { createResource } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { applyBuiltinDriverModel, builtinDriverInterfaceForModel, setDriverCommunicationRate, SENSOR_ROLES, SENSOR_PARAMS, sensorFieldRequired } from '../web/src/modules/hardware/hw-drivers/sensors.mjs';
import { validateHardware } from '../web/src/modules/hardware/hw-board/validation.mjs';
import { newModuleProject } from './support/new-project.mjs';
import { driverConfigurationIssues, driverDescriptors } from '../native/generator/drivers.mjs';

const params = project => project.instances['hw-drivers'].parameters;
const bus = (id,kind,rate) => {
  const resource=createResource(kind,id);
  resource.instance=kind==='uart'?'USART2':'SPI2';
  if(kind==='uart')Object.assign(resource.settings,{physical:'rs485',bitrate:rate});
  else resource.settings.clockHz=rate;
  return resource;
};

test('built-in model selection assigns only maintained transports and unique compatible resources', () => {
  for(const [prefix,models,transport,kind,capability] of [
    ['motorEncoder',['MC_ENCODER_GW_OUTER','MC_ENCODER_JG'],'rs485','uart','encoderCapability'],
    ['outputEncoder',['MC_ENCODER_GW_INNER'],'rs485','uart','outputEncoderCapability'],
    ['torqueSensor',['MC_TOR_SENSOR_KW','MC_TOR_SENSOR_XH','MC_TOR_SENSOR_LD','MC_TOR_SENSOR_SMH','KW','XH','LD','SMH'],'rs485','uart','torqueCapability'],
    ['gateDriver',['DRV8353S','DRV8353'],'spi','spi','gateDriverCapability'],
  ]) for(const model of models) {
    const p=params(createProject()), resource=bus('bus',kind,1000000);
    const before=structuredClone(p[prefix+'Commands']);
    applyBuiltinDriverModel(p,prefix,model,[resource]);
    assert.equal(builtinDriverInterfaceForModel(prefix,model),transport);
    assert.equal(p[prefix+'Interface'],transport);
    assert.equal(p[prefix+'Resource'],'bus');
    assert.equal(p[prefix+'Bitrate'],1000000);
    assert.equal(p[capability],'present');
    assert.deepEqual(p[prefix+'Commands'],before);
  }
});

test('ambiguous resources remain unbound, valid existing bindings win, unknown bus rates are not guessed', () => {
  const p=params(createProject()), a=bus('a','uart',null), b=bus('b','uart',2000000);
  p.motorEncoderBitrate=500000;
  applyBuiltinDriverModel(p,'motorEncoder','MC_ENCODER_JG',[a,b]);
  assert.equal(p.motorEncoderResource,'');
  assert.equal(p.motorEncoderBitrate,500000);
  p.motorEncoderResource='a';
  applyBuiltinDriverModel(p,'motorEncoder','MC_ENCODER_JG',[a,b]);
  assert.equal(p.motorEncoderResource,'a');
  assert.equal(p.motorEncoderBitrate,null);
  p.motorEncoderResource='missing';
  applyBuiltinDriverModel(p,'motorEncoder','MC_ENCODER_JG',[a,b]);
  assert.equal(p.motorEncoderResource,'');
  applyBuiltinDriverModel(p,'motorEncoder','MC_ENCODER_JG',[b]);
  assert.equal(p.motorEncoderResource,'b');
  assert.equal(p.motorEncoderBitrate,2000000);
});

test('discrete gates preserve and ignore prior serial data and do not acquire a bus', () => {
  const p=params(createProject());
  Object.assign(p,{gateDriverInterface:'spi',gateDriverResource:'old',gateDriverBitrate:1000000});
  const before=structuredClone(p);
  applyBuiltinDriverModel(p,'gateDriver','discrete',[bus('new','spi',2000000)]);
  assert.deepEqual(p,{...before,gateDriverModel:'discrete',gateDriverCapability:'present'});
});

test('internal serial and SPI rate synchronization never auto-binds a second driver to an occupied port', () => {
  const p=params(createProject()), uart=bus('uart','uart',1000000), spi=bus('spi','spi',2000000);
  applyBuiltinDriverModel(p,'motorEncoder','MC_ENCODER_GW_OUTER',[uart]);
  applyBuiltinDriverModel(p,'outputEncoder','MC_ENCODER_GW_INNER',[uart]);
  applyBuiltinDriverModel(p,'gateDriver','DRV8353S',[spi]);
  setDriverCommunicationRate(p,'motorEncoder',3000000,[uart,spi]);
  assert.equal(uart.settings.bitrate,3000000);
  assert.equal(p.motorEncoderBitrate,3000000);
  assert.equal(p.outputEncoderBitrate,null);
  assert.equal(p.outputEncoderResource,'');
  assert.equal(spi.settings.clockHz,2000000);
  setDriverCommunicationRate(p,'gateDriver',4000000,[uart,spi]);
  assert.equal(spi.settings.clockHz,4000000);
  setDriverCommunicationRate(p,'gateDriver',null,[uart,spi]);
  assert.equal(spi.settings.clockHz,null);
  assert.equal(p.gateDriverBitrate,null);
  const before=structuredClone([p,uart,spi]);
  assert.throws(()=>setDriverCommunicationRate(p,'motorEncoder',-1,[uart,spi]),/正数/);
  assert.deepEqual([p,uart,spi],before);
});

test('known legacy UART model values still require an electrically compatible RS-485 resource', () => {
  const project=createProject(), p=params(project), uart=bus('uart','uart',1000000);
  project.target={vendor:'st',mcu:'STM32H745IIK6',board:''};
  project.instances['hw-board'].parameters.resources.push(uart);
  Object.assign(p,{encoderCapability:'present',motorEncoderModel:'GW 外圈',motorEncoderInterface:'uart',motorEncoderResource:'uart'});
  uart.settings.physical='ttl';
  assert(validateHardware(project).some(issue=>issue.id==='hardware-motor-interface'));
  uart.settings.physical='rs485';
  assert(!validateHardware(project).some(issue=>issue.id==='hardware-motor-interface'));
});

test('changing maintained device family clears stale frames but preserves speed, pins and angle semantics', () => {
  for (const [prefix,model] of [['motorEncoder','MC_ENCODER_JG'],['torqueSensor','MC_TOR_SENSOR_SMH']]) {
    const project=newModuleProject(), p=params(project);
    const resources=project.instances['hw-board'].parameters.resources;
    const speed=p[prefix+'Bitrate'], angle=p[prefix+'AngleDomain'], direction=p[prefix+'Direction'];
    assert(p[prefix+'Commands'].length>0);
    assert.deepEqual(driverConfigurationIssues(p),[]);
    applyBuiltinDriverModel(p,prefix,model,resources);
    assert.deepEqual(p[prefix+'Commands'],[]);
    assert.equal(p[prefix+'Bitrate'],speed);
    assert.equal(p[prefix+'AngleDomain'],angle);
    assert.equal(p[prefix+'Direction'],direction);
    assert(driverConfigurationIssues(p).some(issue=>issue.paramKey===prefix+'Commands'));
    assert.throws(()=>driverDescriptors(p),/主数据指令/);
  }
  const p=params(createProject());
  Object.assign(p,{gateDriverModel:'DRV8353S',gateDriverEnablePin:'PE1',gateDriverEnableLevel:'low',gateDriverBitrate:1000000,gateDriverCommands:[{id:'old-frame'}]});
  applyBuiltinDriverModel(p,'gateDriver','discrete');
  assert.deepEqual(p.gateDriverCommands,[]);
  assert.equal(p.gateDriverEnablePin,'PE1');
  assert.equal(p.gateDriverEnableLevel,'low');
  assert.equal(p.gateDriverBitrate,1000000);
});

test('same family aliases retain protocol frames and explicitly clearing a model disables it', () => {
  for (const [prefix,previous,next] of [
    ['motorEncoder','GW 外圈','MC_ENCODER_GW_OUTER'],
    ['outputEncoder','MC_ENCODER_GW_INNER','MC_ENCODER_GW_OUTER'],
    ['motorEncoder','MC_ENCODER_JG','jingang'],
    ['torqueSensor','KW','MC_TOR_SENSOR_KW'],
    ['gateDriver','DRV8353','DRV8353S'],
  ]) {
    const p=params(createProject()), frames=[{id:'saved-frame'}];
    p[prefix+'Model']=previous;p[prefix+'Commands']=frames;
    applyBuiltinDriverModel(p,prefix,next);
    assert.equal(p[prefix+'Commands'],frames);
  }
  const project=newModuleProject(), p=params(project), speed=p.torqueSensorBitrate;
  applyBuiltinDriverModel(p,'torqueSensor','');
  assert.equal(p.torqueSensorModel,'');
  assert.equal(p.torqueCapability,'absent');
  assert.deepEqual(p.torqueSensorCommands,[]);
  assert.equal(p.torqueSensorBitrate,speed);
  assert.equal(driverDescriptors(p)[2].enabled,false);
  assert.deepEqual(driverConfigurationIssues(p),[]);
});

test('removed capability controls are not required fields but unknown hardware still blocks native generation', () => {
  const p=params(createProject());
  for(const role of SENSOR_ROLES) {
    assert.equal(sensorFieldRequired(SENSOR_PARAMS.find(field=>field.key===role.capability),p),false);
    assert(driverConfigurationIssues(p).some(issue=>issue.paramKey===role.capability));
  }
  assert.throws(()=>driverDescriptors(p),/启用状态/);
});
