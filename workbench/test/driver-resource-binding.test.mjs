import test from 'node:test';
import assert from 'node:assert/strict';
import { createResource } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { applyBuiltinDriverModel, bindBuiltinDriverResource } from '../web/src/modules/hardware/hw-drivers/sensors.mjs';
import { syncSensorResource } from '../web/src/modules/hardware/hw-board/validation.mjs';
import { bindCustomDriverResource, createCustomDriver } from '../web/src/modules/hardware/hw-drivers/custom-drivers.mjs';

function port(kind, id, instance, rate = null) {
  const resource = { ...createResource(kind, id), instance };
  if (kind === 'uart') Object.assign(resource.settings, { physical: 'rs485', bitrate: rate });
  if (kind === 'spi') resource.settings.clockHz = rate;
  return resource;
}
const builtin = () => ({ motorEncoderModel: 'MC_ENCODER_JG', motorEncoderInterface: 'spi', motorEncoderResource: 'old', motorEncoderBitrate: 115200, motorEncoderCommands: [{ id: 'saved-frame' }] });

test('built-in binding rejects missing, unconfigured, incompatible and unsupported targets without mutation', () => {
  const parameters = builtin();
  const rs485 = port('uart', 'serial', 'USART2', 1000000);
  const ttl = port('uart', 'ttl', 'UART4', 115200); ttl.settings.physical = 'ttl';
  const resources = [rs485, ttl, port('spi', 'spi', 'SPI2'), port('uart', 'unconfigured', '')];
  const before = structuredClone([parameters, resources]);
  for (const id of ['', 'missing', 'USART2', 'ttl', 'spi', 'unconfigured']) {
    assert.throws(() => bindBuiltinDriverResource(parameters, 'motorEncoder', id, resources), /已配置.*兼容/);
    assert.deepEqual([parameters, resources], before);
  }
  assert.throws(() => bindBuiltinDriverResource(parameters, 'unknownRole', rs485.id, resources), /不支持/);
  assert.deepEqual([parameters, resources], before);
  const discrete = { gateDriverModel: 'discrete', gateDriverInterface: 'spi', gateDriverResource: 'old' };
  const savedDiscrete = structuredClone(discrete);
  assert.throws(() => bindBuiltinDriverResource(discrete, 'gateDriver', 'spi', resources), /不支持/);
  assert.deepEqual(discrete, savedDiscrete);
});

test('explicit built-in binding keeps the selected bus rate, model and frames without creating peripherals', () => {
  const parameters = builtin(), frames = parameters.motorEncoderCommands;
  const a = port('uart', 'first', 'USART2', 1000000), b = port('uart', 'chosen', 'UART4', 2000000);
  const resources = [a, b], before = structuredClone(resources);
  assert.equal(bindBuiltinDriverResource(parameters, 'motorEncoder', b.id, resources), b);
  assert.equal(parameters.motorEncoderResource, b.id);
  assert.equal(parameters.motorEncoderBitrate, 2000000);
  assert.equal(parameters.motorEncoderModel, 'MC_ENCODER_JG');
  assert.equal(parameters.motorEncoderInterface, 'spi', 'fixed model transport determines compatibility without rewriting stored metadata');
  assert.equal(parameters.motorEncoderCommands, frames);
  assert.deepEqual(resources, before);
  assert.equal(resources.length, 2);
});

test('built-in binding copies blank port rates and never fills a port from an old driver speed', () => {
  const parameters = { ...builtin(), outputEncoderResource: 'chosen', outputEncoderBitrate: null };
  const a = port('uart', 'untouched', 'USART2', 1000000), b = port('uart', 'chosen', 'UART4', null);
  const resources = [a, b], firstBefore = structuredClone(a);
  bindBuiltinDriverResource(parameters, 'motorEncoder', b.id, resources);
  assert.equal(b.settings.bitrate, null);
  assert.equal(parameters.motorEncoderBitrate, null);
  assert.equal(parameters.outputEncoderBitrate, null);
  assert.deepEqual(a, firstBefore);
  assert.equal(resources.length, 2);
  for (const speed of [null, undefined, 0, -1, NaN, 115200]) {
    const p = { ...builtin(), motorEncoderBitrate: speed }, empty = port('uart', 'empty', 'UART4', null);
    bindBuiltinDriverResource(p, 'motorEncoder', empty.id, [empty]);
    assert.equal(empty.settings.bitrate, null);
    assert.equal(p.motorEncoderBitrate, null);
  }
  delete b.settings.bitrate;
  parameters.motorEncoderBitrate = 500000;
  bindBuiltinDriverResource(parameters, 'motorEncoder', b.id, resources);
  assert.equal(parameters.motorEncoderBitrate, null);
  assert.equal(Object.hasOwn(b.settings, 'bitrate'), false);
});

test('legacy stored interfaces can bind compatible resources without treating unrelated timer clocks as driver speed', () => {
  const parameters = { torqueSensorModel: 'legacy', torqueSensorInterface: 'spi', torqueSensorResource: '', torqueSensorBitrate: 500000, torqueSensorCommands: [{ id: 'frame' }] };
  const spi = port('spi', 'spi', 'SPI2', 4000000);
  bindBuiltinDriverResource(parameters, 'torqueSensor', spi.id, [spi]);
  assert.equal(parameters.torqueSensorBitrate, 4000000);
  const timer = port('timer', 'timer', 'TIM1'); timer.settings.clockHz = 100000000;
  parameters.torqueSensorInterface = 'abz';
  bindBuiltinDriverResource(parameters, 'torqueSensor', timer.id, [timer]);
  assert.equal(parameters.torqueSensorBitrate, null);
  assert.equal(timer.settings.clockHz, 100000000);
});

test('custom binding requires an explicit existing compatible resource and never guesses a unique candidate', () => {
  const driver = Object.assign(createCustomDriver('driver', 'rs485'), { model: 'ABC', resource: 'old', bitrate: 115200 });
  const serial = port('uart', 'serial', 'USART2', 1000000);
  const ttl = port('uart', 'ttl', 'UART4', 115200); ttl.settings.physical = 'ttl';
  const resources = [serial, ttl, port('spi', 'spi', 'SPI2'), port('uart', 'unconfigured', '')];
  const before = structuredClone([driver, resources]);
  for (const id of ['', 'missing', 'USART2', 'ttl', 'spi', 'unconfigured']) {
    assert.throws(() => bindCustomDriverResource(driver, id, resources), /已配置.*兼容/);
    assert.deepEqual([driver, resources], before);
  }
  assert.throws(() => bindCustomDriverResource(driver, '', [serial]), /已配置.*兼容/);
  assert.deepEqual([driver, resources], before);
});

test('custom binding derives speed only from the configured peripheral, including null and missing rates', () => {
  for (const kind of ['uart', 'spi']) {
    const driver = Object.assign(createCustomDriver('driver', kind), { model: 'ABC', bitrate: 115200 });
    const key = kind === 'uart' ? 'bitrate' : 'clockHz';
    const a = port(kind, 'first', kind === 'uart' ? 'USART2' : 'SPI1', 1000000);
    const b = port(kind, 'chosen', kind === 'uart' ? 'UART4' : 'SPI2', 2000000);
    const resources = [a, b], before = structuredClone(resources);
    assert.equal(bindCustomDriverResource(driver, b.id, resources), b);
    assert.equal(driver.resource, b.id);
    assert.equal(driver.bitrate, 2000000);
    assert.equal(driver.model, 'ABC');
    assert.equal(driver.interface, kind);
    assert.deepEqual(resources, before);
    b.settings[key] = null;
    driver.bitrate = 3000000;
    bindCustomDriverResource(driver, b.id, resources);
    assert.equal(b.settings[key], null);
    assert.equal(driver.bitrate, null);
    assert.deepEqual(a, before[0]);
    assert.equal(resources.length, 2);
    for (const speed of [null, undefined, 0, -1, NaN]) {
      b.settings[key] = null; driver.bitrate = speed;
      bindCustomDriverResource(driver, b.id, resources);
      assert.equal(b.settings[key], null);
      assert.equal(driver.bitrate, null);
    }
    delete b.settings[key];
    driver.bitrate = 3000000;
    bindCustomDriverResource(driver, b.id, resources);
    assert.equal(driver.bitrate, null);
    assert.equal(Object.hasOwn(b.settings, key), false);
  }
});

test('model auto binding and peripheral synchronization propagate explicit blank rates', () => {
  const parameters = builtin(), serial = port('uart', 'serial', 'USART2', null);
  const resources = [serial], before = structuredClone(resources);
  applyBuiltinDriverModel(parameters, 'motorEncoder', 'MC_ENCODER_JG', resources);
  assert.equal(parameters.motorEncoderResource, serial.id);
  assert.equal(parameters.motorEncoderBitrate, null);
  parameters.motorEncoderBitrate = 115200;
  syncSensorResource(parameters, resources);
  assert.equal(parameters.motorEncoderBitrate, null);
  serial.settings.bitrate = 230400;
  syncSensorResource(parameters, resources);
  assert.equal(parameters.motorEncoderBitrate, 230400);
  serial.settings.bitrate = null;
  syncSensorResource(parameters, resources);
  assert.equal(parameters.motorEncoderBitrate, null);
  assert.deepEqual(resources, before);
});

test('explicit binding preserves an invalid non-null configured rate so validation can report it', () => {
  const serial = port('uart', 'serial', 'USART2', 0), resources = [serial];
  const parameters = builtin(), custom = Object.assign(createCustomDriver('custom'), { bitrate: 115200 });
  bindBuiltinDriverResource(parameters, 'motorEncoder', serial.id, resources);
  bindCustomDriverResource(custom, serial.id, resources);
  assert.equal(parameters.motorEncoderBitrate, 0);
  assert.equal(custom.bitrate, 0);
  assert.equal(serial.settings.bitrate, 0);
  assert.equal(resources.length, 1);
});
