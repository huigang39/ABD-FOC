import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { SENSOR_PARAMS, sensorFieldVisible, sensorIssues } from '../web/src/modules/hardware/hw-drivers/sensors.mjs';
import { renderSensorConfig } from '../web/src/modules/hardware/hw-drivers/view.mjs';
import { renderSensorTransport } from '../web/src/features/configuration/hardware-view.mjs';
import { captureDriverHardware, applyDriver } from '../web/src/features/equipment/model.mjs';
import { saveLayerVersion, applyLayerVersion } from '../web/src/features/configuration/versions.mjs';
import { driverDescriptors, driverConfigurationIssues } from '../native/generator/drivers.mjs';
import { newModuleProject } from './support/new-project.mjs';
const params = p => p.instances['hw-drivers'].parameters;
const visible = (p, key) => sensorFieldVisible(SENSOR_PARAMS.find(f => f.key === 'motorEncoder'+key), params(p));
function framed(p) { Object.assign(params(p), { motorEncoderTransferMode:'request_response', motorEncoderRequestHex:'01 03', motorEncoderHeaderHex:'AA 55', motorEncoderFooterHex:'', motorEncoderFrameBytes:8, motorEncoderDataOffset:2, motorEncoderDataType:'unsigned', motorEncoderDataBits:32, motorEncoderByteOrder:'little', motorEncoderValueScale:0.0001, motorEncoderValueOffset:0, motorEncoderChecksum:'crc16_modbus', motorEncoderChecksumStart:0, motorEncoderStatusOffset:null, motorEncoderStatusMask:0 }); return p; }
test('all serial drivers expose frame configuration and exactly two transfer modes', () => {
  const p = createNeo75hProject();
  assert(visible(p,'FrameBytes'));
  assert(visible(p,'RequestHex')); assert(!visible(p,'StartHex'));
  assert.deepEqual(SENSOR_PARAMS.find(f=>f.key==='motorEncoderTransferMode').options.filter(o=>o.value!=='unselected').map(o=>o.value), ['request_response','active_upload']);
  assert(!SENSOR_PARAMS.some(f=>f.key.endsWith('ProtocolMode')));
  params(p).motorEncoderTransferMode='active_upload';
  assert(!visible(p,'RequestHex')); assert(visible(p,'StartHex'));
  params(p).motorEncoderInterface='adc'; assert(!visible(p,'FrameBytes'));
});
test('frame validation checks hexadecimal bytes, payload width, checksum and footer boundaries', () => {
  const p=framed(newModuleProject());
  assert.deepEqual(driverConfigurationIssues(params(p)),[]);
  Object.assign(params(p),{motorEncoderHeaderHex:'A 55',motorEncoderDataType:'float32',motorEncoderDataBits:16,motorEncoderFrameBytes:3,motorEncoderChecksumStart:2});
  const issues=sensorIssues(params(p));
  for(const key of ['HeaderHex','DataBits','FrameBytes','ChecksumStart'])assert(issues.some(i=>i.paramKey==='motorEncoder'+key),key);
  params(p).motorEncoderDataBits=12;
  assert(sensorIssues(params(p)).some(i=>i.paramKey==='motorEncoderDataBits'));
});
test('both communication modes and their bytes survive driver reuse and layer versions', () => {
  let p=framed(createNeo75hProject());p=captureDriverHardware(p,p.catalog.activeDriverId);
  const restored=applyDriver(parseProject(serializeProject(p)),p.catalog.activeDriverId);
  assert.deepEqual(params(restored),params(p));
  const saved=saveLayerVersion(p,{layer:'hardware',version:'wire-v1'});params(saved).motorEncoderFrameBytes=20;
  assert.equal(params(applyLayerVersion(saved,'hardware')).motorEncoderFrameBytes,8);
  params(p).motorEncoderTransferMode='active_upload'; params(p).motorEncoderStartHex='12 34';
  p=captureDriverHardware(p,p.catalog.activeDriverId);
  assert.equal(params(applyDriver(parseProject(serializeProject(p)),p.catalog.activeDriverId)).motorEncoderStartHex,'12 34');
});
test('driver settings edit their shared peripheral and render fields for the selected mode', () => {
  const p=createNeo75hProject(),resources=p.instances['hw-board'].parameters.resources;
  const html=renderSensorConfig(params(p),f=>`<input data-key="${f.key}">`,{renderTransport:role=>renderSensorTransport(params(p),role,resources,{mcu:p.target.mcu,owner:'driver'})});
  assert.match(html,/通信与帧格式/); assert.match(html,/data-edit="pcba-resource" data-id="USART2" data-owner="driver"/);
  for(const key of ['parity','motorEncoderTransferMode','motorEncoderFrameBytes','motorEncoderRequestHex','torqueSensorStartHex']) assert(html.includes(`data-key="${key}"`));
  assert.doesNotMatch(html,/ProtocolMode|data-key="motorEncoderStartHex"|data-key="torqueSensorRequestHex"/);
});
test('incomplete frames block source generation while empty upload startup means receive-only', () => {
  const p=framed(newModuleProject());params(p).motorEncoderFrameBytes=null;
  assert(validateProject(p).some(i=>i.paramKey==='motorEncoderFrameBytes'&&i.level==='pending'));
  assert(driverConfigurationIssues(params(p)).some(i=>i.paramKey==='motorEncoderFrameBytes'));
  framed(p);params(p).motorEncoderRequestHex='';
  assert(driverConfigurationIssues(params(p)).some(i=>i.paramKey==='motorEncoderRequestHex'));
  params(p).motorEncoderTransferMode='active_upload';params(p).motorEncoderStartHex='';
  assert.deepEqual(driverDescriptors(params(p))[0].request,[]);
});
