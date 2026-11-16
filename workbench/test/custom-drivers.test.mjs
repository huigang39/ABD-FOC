import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { createDriver, captureDriverHardware, applyDriver } from '../web/src/features/equipment/model.mjs';
import { createResource } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { createCustomDriver, checkCustomDriverShape, customDriverIssues, customDriverResources, syncCustomDriverResource, syncCustomDriverRates } from '../web/src/modules/hardware/hw-drivers/custom-drivers.mjs';

const params = project => project.instances['hw-drivers'].parameters;
const peripheral = (kind, id, instance = id) => ({ ...createResource(kind, id), instance });

test('custom driver definitions survive project and shelf round trips without enabling a protocol implementation', () => {
  const project = createProject(), driver = createCustomDriver('aux');
  Object.assign(driver, { name: '辅助器件', model: 'ABC', interface: 'spi', resource: 'SPI2', bitrate: 1000000 });
  params(project).customDrivers.push(driver);
  project.instances['hw-board'].parameters.resources.push(peripheral('spi', 'SPI2'));
  const loaded = parseProject(serializeProject(project));
  assert.deepEqual(params(loaded).customDrivers, [driver]);
  const savedDriver = createDriver();
  loaded.catalog.drivers.push(savedDriver);
  const captured = captureDriverHardware(loaded, savedDriver.id);
  assert.deepEqual(captured.catalog.drivers[0].hardware['hw-drivers'].customDrivers, [driver]);
  assert.deepEqual(params(applyDriver(captured, savedDriver.id)).customDrivers, [driver]);
  const issues = customDriverIssues(params(loaded), loaded.instances['hw-board'].parameters.resources);
  assert.deepEqual(issues.map(issue => [issue.id, issue.level]), [['custom-driver-aux-adapter', 'pending']]);
});

test('older projects missing custom drivers normalize to independent empty lists', () => {
  const project = createProject();
  delete params(project).customDrivers;
  const a = parseProject(serializeProject(project)), b = createProject();
  assert.deepEqual(params(a).customDrivers, []);
  params(a).customDrivers.push(createCustomDriver('only-a'));
  assert.deepEqual(params(b).customDrivers, []);
});

test('custom driver schema rejects malformed shape, duplicate IDs and unsupported interface names', () => {
  const fixture = () => [createCustomDriver('one')];
  for (const mutate of [
    drivers => drivers.push(createCustomDriver('one')),
    drivers => { drivers[0].id = ' '; },
    drivers => { drivers[0].enabled = 'true'; },
    drivers => { drivers[0].name = 123; },
    drivers => { drivers[0].interface = 'ethercat'; },
    drivers => { delete drivers[0].resource; },
    drivers => { drivers[0].command = 'invented'; },
    drivers => { drivers[0].bitrate = '1000000'; },
    drivers => { drivers[0].bitrate = Infinity; },
  ]) {
    const drivers = fixture(); mutate(drivers);
    assert.throws(() => checkCustomDriverShape(drivers));
    assert(customDriverIssues({ customDrivers: drivers }).some(issue => issue.id === 'custom-driver-format' && issue.level === 'error'));
  }
  assert.throws(() => checkCustomDriverShape(Array.from({ length: 65 }, (_, i) => createCustomDriver(String(i)))));
  assert.throws(() => checkCustomDriverShape({}));
});

test('model and rate omissions are pending without a separate name field and unresolved interfaces do not invent bindings', () => {
  const driver = createCustomDriver('one'), parameters = { customDrivers: [driver] };
  const missing = customDriverIssues(parameters);
  for (const field of ['model', 'bitrate', 'resource']) assert(missing.some(issue => issue.id === `custom-driver-one-${field}` && issue.level === 'pending'));
  assert(!missing.some(issue => issue.id === 'custom-driver-one-name'));
  Object.assign(driver, { model: 'ABC', interface: 'rs485', resource: 'serial', bitrate: 115200 });
  assert(customDriverIssues(parameters).some(issue => issue.id === 'custom-driver-one-resource' && issue.level === 'pending'));
  const uart = peripheral('uart', 'serial', 'USART2');
  uart.settings.physical = 'ttl';
  assert(customDriverIssues(parameters, [uart]).some(issue => issue.id === 'custom-driver-one-resource' && issue.level === 'pending'));
  uart.settings.physical = 'rs485';
  assert.deepEqual(customDriverResources([uart], 'rs485'), [uart]);
  assert.deepEqual(customDriverIssues(parameters, [uart]).map(issue => issue.id), ['custom-driver-one-adapter']);
  driver.enabled = false;
  const before = structuredClone(parameters);
  assert.deepEqual(customDriverIssues(parameters), []);
  assert.deepEqual(parameters, before);
});

test('old custom driver entries missing a bitrate remain importable and unset rather than invented', () => {
  const project = createProject(), driver = createCustomDriver('legacy');
  delete driver.bitrate;
  params(project).customDrivers.push(driver);
  const loaded = parseProject(serializeProject(project));
  assert.equal(params(loaded).customDrivers[0].bitrate ?? null, null);
  assert(customDriverIssues(params(loaded)).some(issue => issue.id === 'custom-driver-legacy-bitrate' && issue.level === 'pending'));
});

test('custom rate diagnostics direct missing and invalid values to the peripheral page', () => {
  const driver = Object.assign(createCustomDriver('rate'), { model: 'ABC' });
  for (const [value, level, title] of [[null, 'pending', '外设速率待配置'], [0, 'error', '外设速率无效'], [-1, 'error', '外设速率无效']]) {
    driver.bitrate = value;
    const issue = customDriverIssues({ customDrivers: [driver] }).find(issue => issue.id === 'custom-driver-rate-bitrate');
    assert.equal(issue.level, level);
    assert.equal(issue.title, `ABC · ${title}`);
    assert.match(issue.message, /在外设页/);
    assert.equal(issue.paramKey, 'customDrivers');
    assert.equal(issue.itemId, driver.id);
    assert.equal(driver.bitrate, value);
  }
});

test('auto binding retains a compatible reference, chooses only a unique candidate, and writes rates only explicitly', () => {
  const driver = createCustomDriver('spi-driver', 'spi');
  driver.bitrate = 2000000;
  const spi1 = peripheral('spi', 'port1', 'SPI1'), spi2 = peripheral('spi', 'port2', 'SPI2');
  spi1.settings.clockHz = 1000000;
  spi2.settings.clockHz = 4000000;
  assert.equal(syncCustomDriverResource(driver, [spi1]), spi1);
  assert.equal(driver.resource, 'port1');
  assert.equal(spi1.settings.clockHz, 1000000, 'binding does not overwrite the existing peripheral clock');
  assert.equal(syncCustomDriverResource(driver, [spi1, spi2]), spi1, 'an explicit compatible reference wins over ambiguity');
  syncCustomDriverResource(driver, [spi1, spi2], { writeRate: true });
  assert.equal(spi1.settings.clockHz, 2000000);
  assert.equal(spi2.settings.clockHz, 4000000);
  driver.resource = 'removed';
  assert.equal(syncCustomDriverResource(driver, [spi1, spi2]), null);
  assert.equal(driver.resource, '');
  assert.equal(syncCustomDriverResource(driver, []), null);
  const uart = peripheral('uart', 'serial', 'USART2');
  const serial = createCustomDriver('serial-driver'); serial.bitrate = 115200;
  syncCustomDriverResource(serial, [uart], { writeRate: true });
  assert.equal(uart.settings.bitrate, 115200);
  driver.bitrate = -1;
  assert(customDriverIssues({ customDrivers: [driver] }).some(issue => issue.id === 'custom-driver-spi-driver-bitrate' && issue.level === 'error'));
});


test('explicitly clearing a custom rate clears the bound peripheral and synchronizes shared peers', () => {
  const uart = peripheral('uart', 'serial', 'USART2');
  uart.settings.bitrate = 115200;
  const first = Object.assign(createCustomDriver('first'), { resource: uart.id, bitrate: 115200 });
  const second = Object.assign(createCustomDriver('second'), { resource: uart.id, bitrate: 115200 });
  const parameters = { customDrivers: [first, second] };
  first.bitrate = 230400;
  syncCustomDriverResource(first, [uart], { writeRate: true });
  assert.equal(syncCustomDriverRates(parameters, [uart]), parameters);
  assert.deepEqual(parameters.customDrivers.map(driver => driver.bitrate), [230400, 230400]);
  first.bitrate = null;
  syncCustomDriverResource(first, [uart], { writeRate: true });
  syncCustomDriverRates(parameters, [uart]);
  assert.equal(uart.settings.bitrate, null);
  assert.deepEqual(parameters.customDrivers.map(driver => driver.bitrate), [null, null]);
});

test('rate propagation uses only existing compatible bindings and never creates settings or selects a peripheral', () => {
  const spi = peripheral('spi', 'spi', 'SPI2'); spi.settings.clockHz = 2000000;
  const uart = peripheral('uart', 'uart', 'USART2'); uart.settings.bitrate = 115200;
  const bound = Object.assign(createCustomDriver('bound', 'spi'), { resource: 'spi', bitrate: 1 });
  const unbound = Object.assign(createCustomDriver('unbound', 'spi'), { bitrate: 2 });
  const missing = Object.assign(createCustomDriver('missing', 'spi'), { resource: 'removed', bitrate: 3 });
  const incompatible = Object.assign(createCustomDriver('incompatible', 'spi'), { resource: 'uart', bitrate: 4 });
  const rs485 = Object.assign(createCustomDriver('rs485', 'rs485'), { resource: 'uart', bitrate: 5 });
  const parameters = { customDrivers: [bound, unbound, missing, incompatible, rs485] };
  syncCustomDriverRates(parameters, [spi, uart]);
  assert.deepEqual(parameters.customDrivers.map(driver => driver.bitrate), [2000000, 2, 3, 4, 5]);
  assert.equal(unbound.resource, ''); assert.equal(missing.resource, 'removed');
  delete spi.settings.clockHz;
  bound.bitrate = null;
  syncCustomDriverResource(bound, [spi], { writeRate: true });
  assert.equal(Object.hasOwn(spi.settings, 'clockHz'), false);
  syncCustomDriverRates(parameters, [spi, uart]);
  assert.equal(bound.bitrate, null);
});
