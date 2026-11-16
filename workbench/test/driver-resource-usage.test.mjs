import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { createResource } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { validateHardware } from '../web/src/modules/hardware/hw-board/validation.mjs';
import { applyBuiltinDriverModel, bindBuiltinDriverResource } from '../web/src/modules/hardware/hw-drivers/sensors.mjs';
import { bindCustomDriverResource, createCustomDriver, customDriverIssues, syncCustomDriverResource } from '../web/src/modules/hardware/hw-drivers/custom-drivers.mjs';
import { driverResourceUsers, driverResourceOccupants, driverResourceConflictIssues } from '../web/src/modules/hardware/hw-drivers/resource-usage.mjs';

function serial(id, instance = 'USART2') {
  const resource = { ...createResource('uart', id), instance };
  Object.assign(resource.settings, { physical: 'rs485', bitrate: 1000000 });
  return resource;
}
const parameters = () => ({ encoderCapability: 'present', motorEncoderModel: 'MC_ENCODER_JG', motorEncoderResource: 'serial', motorEncoderBitrate: 1000000, outputEncoderCapability: 'present', outputEncoderModel: 'MC_ENCODER_GW_OUTER', outputEncoderResource: '', outputEncoderBitrate: 115200, customDrivers: [] });
const custom = (id, resource = '') => Object.assign(createCustomDriver(id, 'rs485'), { model: id, resource, bitrate: 115200 });

test('occupancy counts active explicit owners, excludes inactive/discrete/unconfigured references, and compares actual ports', () => {
  const p = parameters(), resources = [serial('serial'), serial('alias'), serial('other', 'USART3'), serial('unconfigured', '')];
  Object.assign(p, { outputEncoderResource: 'alias', torqueCapability: 'unconfirmed', torqueSensorResource: 'serial', gateDriverCapability: 'present', gateDriverModel: 'discrete', gateDriverResource: 'serial' });
  p.customDrivers = [custom('active', 'serial'), { ...custom('disabled', 'serial'), enabled: false }, custom('missing', 'removed'), custom('blank', 'unconfigured')];
  const before = structuredClone([p, resources]);
  assert.deepEqual(driverResourceUsers(p, resources).map(user => user.prefix || user.customId), ['motorEncoder', 'outputEncoder', 'active']);
  assert.deepEqual(driverResourceOccupants(p, resources, 'alias', { prefix: 'outputEncoder' }).map(user => user.prefix || user.customId), ['motorEncoder', 'active']);
  assert.deepEqual(driverResourceOccupants(p, resources, 'serial', { customId: 'active' }).map(user => user.prefix), ['motorEncoder', 'outputEncoder']);
  for (const reference of ['missing', 'unconfigured', 'other']) assert.deepEqual(driverResourceOccupants(p, resources, reference), []);
  p.encoderCapability = 'absent';
  assert(!driverResourceUsers(p, resources).some(user => user.prefix === 'motorEncoder'));
  p.encoderCapability = 'present';
  assert.deepEqual([p, resources], before);
});

test('each conflicting owner gets a visible field error without changing stored references', () => {
  const p = parameters(), resources = [serial('serial'), serial('alias')];
  p.outputEncoderResource = 'alias';
  p.customDrivers.push(custom('extra', 'serial'));
  const before = structuredClone([p, resources]);
  const issues = driverResourceConflictIssues(p, resources);
  assert.equal(issues.length, 3);
  assert(issues.every(issue => issue.level === 'error' && issue.title === '外设重复占用' && issue.id.startsWith('hardware-') && issue.id.endsWith('-choice')));
  assert(issues.every(issue => issue.code === 'driver-resource-conflict'));
  assert.deepEqual(issues.map(issue => issue.paramKey), ['motorEncoderResource', 'outputEncoderResource', 'customDrivers']);
  assert.equal(issues[2].itemId, 'extra');
  assert(issues.every(issue => issue.message.includes('USART2')));
  for (const issue of issues) {
    assert.equal(issue.messageParts.map(part => typeof part === 'string' ? part : part.label).join(''), issue.message);
    const references = issue.messageParts.filter(part => typeof part !== 'string');
    assert.deepEqual(references.map(part => part.kind), ['peripheral', 'driver', 'driver', 'driver']);
    assert(references.every(part => part.type === 'reference'));
  }
  assert.deepEqual([p, resources], before);
});

test('builtin and custom bindings reject occupied actual ports before modifying references or bus rates', () => {
  const p = parameters(), driver = custom('extra');
  p.customDrivers.push(driver);
  const resources = [serial('serial'), serial('alias'), serial('free', 'USART3')];
  const before = structuredClone([p, resources]);
  assert.throws(() => bindBuiltinDriverResource(p, 'outputEncoder', 'alias', resources), /占用/);
  assert.deepEqual([p, resources], before);
  assert.throws(() => bindCustomDriverResource(driver, 'alias', resources, p), /占用/);
  assert.deepEqual([p, resources], before);
  assert.equal(bindBuiltinDriverResource(p, 'motorEncoder', 'serial', resources), resources[0], 'the sole existing owner can keep its own port');
  assert.equal(bindCustomDriverResource(driver, 'free', resources, p), resources[2]);
  assert.equal(driver.resource, 'free');
  const bound = structuredClone([p, resources]);
  assert.throws(() => bindBuiltinDriverResource(p, 'outputEncoder', 'free', resources), /占用/);
  assert.deepEqual([p, resources], bound);
  assert.equal(resources.length, 3);
});

test('model auto binding cannot claim an occupied unique port and preserves existing imported conflicts', () => {
  const p = parameters(), resources = [serial('serial')];
  applyBuiltinDriverModel(p, 'outputEncoder', 'MC_ENCODER_GW_OUTER', resources);
  assert.equal(p.outputEncoderResource, '');
  assert.equal(p.motorEncoderResource, 'serial');
  p.outputEncoderResource = 'serial';
  applyBuiltinDriverModel(p, 'outputEncoder', 'MC_ENCODER_GW_OUTER', resources);
  assert.equal(p.outputEncoderResource, 'serial');
  assert.equal(driverResourceConflictIssues(p, resources).length, 2);
  p.outputEncoderResource = '';
  p.encoderCapability = 'absent';
  applyBuiltinDriverModel(p, 'outputEncoder', 'MC_ENCODER_GW_OUTER', resources);
  assert.equal(p.outputEncoderResource, 'serial', 'an inactive owner does not reserve the port');
});

test('custom auto binding checks all other owners, reports occupied unresolved ports, and keeps saved conflicts', () => {
  const p = parameters(), driver = custom('extra'), resources = [serial('serial')];
  p.customDrivers.push(driver);
  assert.equal(syncCustomDriverResource(driver, resources, { parameters: p }), null);
  assert.equal(driver.resource, '');
  assert(customDriverIssues(p, resources).some(issue => issue.id === 'custom-driver-extra-resource' && issue.message.includes('占用')));
  driver.resource = 'serial';
  assert.equal(syncCustomDriverResource(driver, resources, { parameters: p }), resources[0]);
  assert.equal(driver.resource, 'serial');
  assert.equal(driverResourceConflictIssues(p, resources).length, 2);
  driver.resource = '';
  p.encoderCapability = 'absent';
  assert.equal(syncCustomDriverResource(driver, resources, { parameters: p }), resources[0]);
  const next = custom('next'); p.customDrivers.push(next);
  assert.equal(syncCustomDriverResource(next, resources, { parameters: p }), null);
  assert.equal(next.resource, '');
});

test('legacy NEO shared USART2 references are preserved and reported as two hardware errors', () => {
  const project = createNeo75hProject(), p = project.instances['hw-drivers'].parameters;
  const resources = project.instances['hw-board'].parameters.resources;
  const before = structuredClone([p, resources]);
  assert.equal(p.motorEncoderResource, p.outputEncoderResource);
  const conflicts = validateHardware(project).filter(issue => issue.title === '外设重复占用');
  assert.deepEqual(conflicts.map(issue => issue.paramKey), ['motorEncoderResource', 'outputEncoderResource']);
  assert.deepEqual([p, resources], before);
});
