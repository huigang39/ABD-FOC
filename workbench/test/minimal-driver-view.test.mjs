import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { renderSensorConfig } from '../web/src/modules/hardware/hw-drivers/view.mjs';
import { createCustomDriver } from '../web/src/modules/hardware/hw-drivers/custom-drivers.mjs';

const parameters = () => createProject().instances['hw-drivers'].parameters;
const render = (params, resources=[]) => {
  const fields = [];
  const html = renderSensorConfig(params, field => { fields.push(field); return `<input data-key="${field.key}">`; }, {resources});
  return { fields, html };
};

test('built-in drivers show model and peripheral dropdown while rates remain in peripheral configuration', () => {
  const params = parameters();
  Object.assign(params, { motorEncoderModel: 'MC_ENCODER_GW_OUTER', torqueSensorModel: 'MC_TOR_SENSOR_KW', gateDriverModel: 'DRV8353S' });
  const before = structuredClone(params), { fields, html } = render(params);
  assert.deepEqual(fields.map(field => field.key), ['motorEncoderModel','motorEncoderResource','torqueSensorModel','torqueSensorResource','gateDriverModel','gateDriverResource','gateDriverEnablePin']);
  for(const field of fields.filter(field=>field.key.endsWith('Resource'))) {
    assert.equal(field.type,'select');
    assert.equal(field.label,'外设');
  }
  assert.doesNotMatch(html, /type="checkbox"|data-key="(?:encoderCapability|gateDriverCapability|motorEncoderInterface|\w+Bitrate)"|sensor-communication|data-edit="driver-command"|波特率|时钟频率/);
  assert.deepEqual(params, before);
});

const resource=(id,instance,kind='uart',physical='rs485')=>({id,instance,kind,name:instance,settings:{physical}});
const card=(html,key,value)=>html.match(new RegExp(`<section class="sensor-card" data-${key}="${value}"[^>]*>([\\s\\S]*?)<\\/section>`))[1];
const header=html=>html.split('<div class="sensor-fields">')[0];

test('driver header tags are read-only while the dropdown offers compatible configured alternatives', () => {
  const params=parameters();
  Object.assign(params,{motorEncoderModel:'MC_ENCODER_JG',motorEncoderResource:'serial-2'});
  const resources=[resource('serial-1','USART1'),resource('serial-2','USART2'),resource('ttl','USART3','uart','ttl'),resource('spi','SPI2','spi')];
  const before=structuredClone({params,resources});
  const {fields,html}=render(params,resources),motor=card(html,'sensor-role','motor');
  assert.match(header(motor),/<span class="attribute-tag[^>]*>USART2<\/span>/);
  assert.deepEqual(fields.find(field=>field.key==='motorEncoderResource').options.map(option=>option.value),['','serial-1','serial-2']);
  assert.doesNotMatch(header(motor),/<details|<select|data-action=|USART3|SPI2/);
  assert.deepEqual({params,resources},before);
});

test('missing or stale references never appear as bound tags even with a unique compatible candidate', () => {
  const params=parameters();
  Object.assign(params,{gateDriverModel:'DRV8353S',gateDriverResource:'removed-spi'});
  const single=card(render(params,[resource('spi','SPI2','spi')]).html,'sensor-role','gate');
  assert.match(header(single),/<span class="attribute-tag[^>]*>未关联<\/span>/);
  assert.doesNotMatch(single,/removed-spi/);
  const ambiguous=card(render(params,[resource('spi-1','SPI1','spi'),resource('spi-2','SPI2','spi')]).html,'sensor-role','gate');
  assert.match(header(ambiguous),/<span class="attribute-tag[^>]*>未关联<\/span>/);
  assert.doesNotMatch(ambiguous,/<details/);
  const missing=card(render(params,[resource('uart','USART2')]).html,'sensor-role','gate');
  assert.match(header(missing),/<span class="attribute-tag[^>]*>未关联<\/span>/);
  assert.doesNotMatch(missing,/<details|USART2|removed-spi/);
});

test('custom drivers use a resource dropdown and keep a static tag at the right edge of the header', () => {
  const params=parameters();
  params.customDrivers=[{...createCustomDriver('custom-1','spi'),model:'Custom',resource:'spi-2'}];
  const custom=card(render(params,[resource('spi-1','SPI1','spi'),resource('spi-2','SPI2','spi')]).html,'custom-driver','custom-1');
  const head=header(custom);
  assert.match(head,/<span class="attribute-tag[^>]*>SPI2<\/span>/);
  assert.match(custom,/<select[^>]*data-edit="custom-driver" data-id="custom-1" data-key="resource" aria-label="外设">/);
  assert.match(custom,/<option value="spi-2" selected>SPI2<\/option>/);
  assert.ok(head.indexOf('data-action="remove-custom-driver"')<head.indexOf('class="attribute-tag driver-resource-tag"'));
  assert.doesNotMatch(custom,/bind-driver-resource|data-prefix=|data-instance=/);
  assert.doesNotMatch(head,/<details|<select/);
});

test('discrete gate tag uses its enable GPIO and ignores retained serial bindings', () => {
  const params=parameters();
  Object.assign(params,{gateDriverModel:'discrete',gateDriverInterface:'spi',gateDriverResource:'spi-2',gateDriverEnablePin:'PE1'});
  const gate=card(render(params,[resource('spi-2','SPI2','spi')]).html,'sensor-role','gate');
  assert.match(header(gate),/>GPIO · PE1<\/span>/);
  assert.doesNotMatch(gate,/SPI2|data-action="bind-driver-resource"|gateDriverBitrate/);
});

test('fresh driver configuration shows unassociated tags until peripherals are configured', () => {
  const params=parameters();
  Object.assign(params,{motorEncoderModel:'MC_ENCODER_GW_OUTER',gateDriverModel:'DRV8353S'});
  const before=structuredClone(params),{html}=render(params);
  const motor=card(html,'sensor-role','motor'),gate=card(html,'sensor-role','gate');
  for(const driver of [motor,gate]) {
    assert.match(header(driver),/<span class="attribute-tag[^>]*>未关联<\/span>/);
    assert.doesNotMatch(driver,/data-resource=|data-instance=|data-action="bind-driver-resource"|<details/);
  }
  assert.deepEqual(params,before);
});

test('built-in dropdowns offer only compatible configured peripherals with assigned instances', () => {
  const params=parameters();
  Object.assign(params,{motorEncoderModel:'MC_ENCODER_GW_OUTER',motorEncoderResource:'serial-2'});
  const resources=[resource('serial-2','USART2'),resource('serial-6','USART6'),resource('ttl','USART3','uart','ttl'),resource('spi','SPI2','spi'),resource('draft','','uart')];
  const {fields,html}=render(params,resources),motor=card(html,'sensor-role','motor');
  assert.match(header(motor),/<span class="attribute-tag[^>]*>USART2<\/span>/);
  assert.deepEqual(fields.find(field=>field.key==='motorEncoderResource').options.map(option=>option.value),['','serial-2','serial-6']);
  assert.doesNotMatch(motor,/data-instance=|USART1|bind-driver-resource/);
});

test('custom driver dropdowns offer only configured interfaces of their transport type', () => {
  const params=parameters();
  params.customDrivers=[createCustomDriver('serial','uart'),createCustomDriver('spi','spi')];
  const resources=[resource('configured-uart','USART2'),resource('configured-spi','SPI2','spi'),resource('draft-uart',''),resource('draft-spi','','spi')];
  const {html}=render(params,resources);
  const serial=card(html,'custom-driver','serial'),spi=card(html,'custom-driver','spi');
  assert.match(serial,/<option value="configured-uart">USART2<\/option>/);
  assert.doesNotMatch(serial,/data-instance=|value="(?:configured-spi|draft-uart|draft-spi)"/);
  assert.match(spi,/<option value="configured-spi">SPI2<\/option>/);
  assert.doesNotMatch(spi,/data-instance=|value="(?:configured-uart|draft-uart|draft-spi)"/);
  for(const driver of [serial,spi])assert.match(header(driver),/>未关联<\/span>/);
});

test('invalid custom bindings remain stored but only show a disabled empty placeholder', () => {
  const params=parameters();
  params.customDrivers=[{...createCustomDriver('serial','uart'),resource:'removed-resource'}];
  const before=structuredClone(params);
  const custom=card(render(params,[resource('serial-2','USART2')]).html,'custom-driver','serial');
  assert.match(custom,/<option value="" selected hidden disabled>—<\/option>/);
  assert.match(custom,/<option value="serial-2">USART2<\/option>/);
  assert.doesNotMatch(custom,/removed-resource/);
  assert.match(header(custom),/>未关联<\/span>/);
  assert.deepEqual(params,before);
});

test('built-in and custom dropdowns disable each other’s occupied peripherals without hiding current tags', () => {
  const params=parameters();
  Object.assign(params,{motorEncoderModel:'MC_ENCODER_GW_OUTER',encoderCapability:'present',motorEncoderResource:'serial-2'});
  params.customDrivers=[{...createCustomDriver('custom-uart','uart'),model:'Custom',resource:'serial-2'}];
  const resources=[resource('serial-2','USART2'),resource('serial-3','USART3')];
  const before=structuredClone({params,resources}),{fields,html}=render(params,resources);
  const options=fields.find(field=>field.key==='motorEncoderResource').options;
  assert.deepEqual(options.find(option=>option.value==='serial-2'),{value:'serial-2',label:'USART2（已占用）',disabled:true,hidden:false});
  assert.ok(!options.find(option=>option.value==='serial-3').disabled);
  const custom=card(html,'custom-driver','custom-uart');
  assert.match(custom,/<option value="serial-2" selected disabled>USART2（已占用）<\/option>/);
  assert.match(custom,/<span class="field-error"><span class="attribute-tag issue-reference-tag">USART2<\/span>/);
  assert.match(custom,/<span class="attribute-tag issue-reference-tag">Custom<\/span>/);
  assert.match(custom,/<span class="attribute-tag issue-reference-tag">角度编码器<\/span>/);
  assert.match(custom,/data-key="resource" aria-label="外设" aria-invalid="true"/);
  for(const driver of [custom,card(html,'sensor-role','motor')])assert.match(header(driver),/>USART2<\/span>/);
  assert.deepEqual({params,resources},before);
});

test('active built-in roles reserve their peripherals from other built-in dropdowns', () => {
  const params=parameters();
  Object.assign(params,{motorEncoderModel:'MC_ENCODER_GW_OUTER',encoderCapability:'present',motorEncoderResource:'serial-2',torqueSensorModel:'MC_TOR_SENSOR_KW',torqueCapability:'present',torqueSensorResource:'serial-3'});
  const {fields}=render(params,[resource('serial-2','USART2'),resource('serial-3','USART3')]);
  const motor=fields.find(field=>field.key==='motorEncoderResource').options;
  const torque=fields.find(field=>field.key==='torqueSensorResource').options;
  assert.ok(!motor.find(option=>option.value==='serial-2').disabled);
  assert.equal(motor.find(option=>option.value==='serial-3').disabled,true);
  assert.equal(torque.find(option=>option.value==='serial-2').disabled,true);
  assert.ok(!torque.find(option=>option.value==='serial-3').disabled);
});

test('inactive roles, disabled custom drivers and discrete gate serial leftovers do not occupy peripherals', () => {
  const params=parameters();
  Object.assign(params,{motorEncoderModel:'MC_ENCODER_GW_OUTER',encoderCapability:'absent',motorEncoderResource:'serial-2',torqueSensorModel:'MC_TOR_SENSOR_KW',torqueCapability:'present',gateDriverModel:'discrete',gateDriverCapability:'present',gateDriverResource:'spi-2',gateDriverInterface:'spi'});
  params.customDrivers=[{...createCustomDriver('disabled-uart','uart'),enabled:false,resource:'serial-2'},{...createCustomDriver('custom-spi','spi'),resource:'spi-2'}];
  const {fields,html}=render(params,[resource('serial-2','USART2'),resource('spi-2','SPI2','spi')]);
  const torque=fields.find(field=>field.key==='torqueSensorResource').options;
  assert.ok(!torque.find(option=>option.value==='serial-2').disabled);
  const custom=card(html,'custom-driver','custom-spi');
  assert.match(custom,/<option value="spi-2" selected>SPI2<\/option>/);
  assert.doesNotMatch(custom,/已占用|aria-invalid="true"/);
});

test('discrete gate driver shows only model and enable pin with no phantom communication rate', () => {
  const params = parameters(); params.gateDriverModel = 'discrete';
  const { fields } = render(params);
  assert.deepEqual(fields.filter(field => field.key.startsWith('gateDriver')).map(field => field.key), ['gateDriverModel','gateDriverEnablePin']);
});

test('custom drivers show only model and peripheral dropdown while preserving stored rates and metadata', () => {
  const params = parameters();
  params.customDrivers = ['uart','spi'].map((type, index) => ({ ...createCustomDriver(`custom-${index}`, type), model: `Device ${index}`, name: 'kept metadata', bitrate: 115200 }));
  const before = structuredClone(params), { html } = render(params);
  for (const driver of params.customDrivers) {
    const card = html.match(new RegExp(`<section class="sensor-card" data-custom-driver="${driver.id}">([\\s\\S]*?)<\\/section>`))[1];
    assert.deepEqual([...card.matchAll(/<input[^>]+data-key="([^"]+)"/g)].map(match => match[1]), ['model']);
    assert.match(card,/<select[^>]*data-key="resource"/);
    assert.doesNotMatch(card, /<details|type="checkbox"|data-key="bitrate"|波特率|时钟频率|bit\/s|Hz/);
  }
  assert.deepEqual(params, before);
});
