import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { createResource, getMcuResources, selectResourceInstance, selectResourcePin, resourceSignalLayout, resourceSettingLayout, resourceIssues, checkResourceShape } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { bindSensorField, renderResourceEditor, renderTripEditor } from '../web/src/features/configuration/hardware-view.mjs';
import { createTripPath } from '../web/src/modules/hardware/hw-safety/paths.mjs';

const mcu = 'STM32H745IIK6';
const resource = (kind, instance) => { const value = createResource(kind, `${kind}-test`); selectResourceInstance(value, mcu, instance); return value; };

test('three-phase PWM shows three main pins, retains six NEO outputs and only displays connected auxiliary signals', () => {
  const project = createNeo75hProject('KW'), pwm = project.instances['hw-board'].parameters.resources.find(item => item.instance === 'HRTIM1');
  const before = structuredClone(pwm), layout = resourceSignalLayout(mcu, pwm);
  assert.deepEqual(layout.primary, ['A1', 'B1', 'C1']);
  assert.deepEqual(layout.advanced.slice(0, 3), ['A2', 'B2', 'C2']);
  assert.deepEqual(layout.pairs.map(pair => pair.phase), ['U', 'V', 'W']);
  const html = renderResourceEditor(mcu, [pwm]);
  const main = html.split('<details class="hardware-resource-advanced"')[0];
  for (const phase of ['U', 'V', 'W']) assert.match(main, new RegExp(`${phase} 相主输出`));
  for (const pin of ['PC6', 'PC7', 'PC8', 'PA8', 'PA9', 'PA10']) assert.ok(main.includes(pin), pin);
  assert.doesNotMatch(main, /data-key="(?:EEV\d+|FLT\d+|A2|B2|C2)"/);
  assert.doesNotMatch(html, /data-key="EEV8"|hardware-resource-advanced|添加信号|高级配置|<details class="resource-disclosure/);
  assert.doesNotMatch(html, /配置采样与 PWM/);
  assert.deepEqual(pwm, before);
  selectResourceInstance(pwm, mcu, 'HRTIM1');
  assert.deepEqual(pwm, before, '重新选择同一实例不会清空保存映射');
  pwm.pins.FLT1 = 'PA15';
  assert.deepEqual(resourceSignalLayout(mcu, pwm).primary, ['A1', 'B1', 'C1']);
  assert.ok(resourceSignalLayout(mcu, pwm).advanced.includes('FLT1'), '已配置辅助信号仍可在高级设置中编辑');
  assert.equal(pwm.pins.FLT1, 'PA15');
  assert.match(renderResourceEditor(mcu, [pwm]), /data-key="FLT1"/);
});

test('gate enable pin binds only to the selected MCU GPIO pin list', () => {
  const field = { key: 'gateDriverEnablePin', type: 'text', label: '旧标签' };
  const bound = bindSensorField(field, {}, [], { mcu });
  assert.equal(bound.type, 'select');
  assert.equal(bound.label, '使能引脚');
  assert.deepEqual(bound.options.map(option=>option.value), getMcuResources(mcu).find(route=>route.kind==='gpio').pins.IO);
  assert.deepEqual(bindSensorField(field, {}, [], { mcu: 'UNSUPPORTED' }).options, []);
  assert.equal(field.type, 'text');
});

test('new HRTIM resources infer only unique available complementary pins after explicit main selection', () => {
  const pwm = resource('pwm', 'HRTIM1');
  assert.deepEqual(pwm.pins, { A1: '', B1: '', C1: '' });
  assert.equal(pwm.settings.mode, 'pwm');
  for (const [main, pin, complement, expected] of [['A1', 'PC6', 'A2', 'PC7'], ['B1', 'PC8', 'B2', 'PA8'], ['C1', 'PA9', 'C2', 'PA10']]) {
    selectResourcePin(pwm, mcu, main, pin, [pwm]);
    assert.equal(pwm.pins[complement], expected);
  }
  assert.doesNotThrow(() => checkResourceShape([pwm]));
  const occupied = resource('gpio', 'GPIO'); occupied.pins.IO = 'PC7';
  const other = resource('pwm', 'HRTIM1');
  selectResourcePin(other, mcu, 'A1', 'PC6', [other, occupied]);
  assert.equal(other.pins.A2, undefined, '已占用的互补引脚不会被自动抢占');
  assert.equal(resourceIssues(mcu, [other, occupied]).some(issue => issue.title === '引脚重复分配'), false);
});

test('ambiguous timer complementary routes require manual choice and existing assignments remain untouched', () => {
  const timer = resource('timer', 'TIM1'); timer.settings.mode = 'pwm';
  assert.deepEqual(resourceSignalLayout(mcu, timer).primary, ['CH1', 'CH2', 'CH3']);
  selectResourcePin(timer, mcu, 'CH1', 'PA8');
  assert.equal(timer.pins.CH1N, undefined);
  assert.ok(resourceSignalLayout(mcu, timer).advanced.includes('CH1N'));
  selectResourcePin(timer, mcu, 'CH1N', 'PE8');
  selectResourcePin(timer, mcu, 'CH1', 'PE9');
  assert.equal(timer.pins.CH1N, 'PE8');
  const before = structuredClone(timer);
  assert.throws(() => selectResourcePin(timer, 'UNKNOWN_MCU', 'CH1', 'PA8'), /不支持/);
  assert.deepEqual(timer, before);
});

test('unused legacy pin slots stay hidden while optional connected pins and conflicts remain visible', () => {
  const uart = resource('uart', 'USART2');
  const route = getMcuResources(mcu).find(item => item.instance === 'USART2');
  uart.pins = Object.fromEntries(Object.keys(route.pins).map(signal => [signal, '']));
  assert.deepEqual(resourceSignalLayout(mcu, uart).primary, ['TX', 'RX']);
  uart.settings.physical = 'rs485';
  assert.deepEqual(resourceSignalLayout(mcu, uart).primary, ['TX', 'RX', 'DE']);
  uart.pins.CK = 'PA4';
  assert.ok(resourceSignalLayout(mcu, uart).primary.includes('CK'));
  uart.pins.TX = 'PA4';
  assert.ok(resourceIssues(mcu, [uart]).some(issue => issue.title === '引脚重复分配'));
  assert.match(renderResourceEditor(mcu, [uart]), /引脚已由/);
});

test('empty ADC and normal serial resources remain configurable without listing all optional channels by default', () => {
  const adc = resource('adc', 'ADC1');
  assert.deepEqual(adc.pins, {});
  assert.deepEqual(resourceSignalLayout(mcu, adc).primary, []);
  assert.match(renderResourceEditor(mcu, [adc]), /data-key="channel"/);
  assert.doesNotMatch(renderResourceEditor(mcu, [adc]), /添加采样通道 \/ 高级配置/);
  selectResourcePin(adc, mcu, 'INP9', 'PB0');
  assert.deepEqual(resourceSignalLayout(mcu, adc).primary, ['INP9']);
  assert.deepEqual(resourceSignalLayout(mcu, resource('spi', 'SPI1')).primary, ['SCK', 'MISO', 'MOSI']);
  assert.deepEqual(resourceSignalLayout(mcu, resource('i2c', 'I2C1')).primary, ['SCL', 'SDA']);
  const uart = resource('uart', 'USART2');
  assert.deepEqual(resourceSettingLayout(uart).primary.map(field => field[0]), ['bitrate', 'physical']);
  assert.deepEqual(resourceSettingLayout(uart).advanced.map(field => field[0]), ['parity', 'stopBits']);
});

test('ADC sampling pins offer actual routes without disconnect choices and use the sampling-duration label', () => {
  const adc = resource('adc', 'ADC1');
  for (const value of ['', 'none', 'PB0']) {
    adc.pins = { INP9: value, INP10: 'PC0' };
    const before = structuredClone(adc), html = renderResourceEditor(mcu, [adc]);
    const pinSelects = [...html.matchAll(/<select\b[^>]*data-section="pins"[^>]*>[\s\S]*?<\/select>/g)].map(match => match[0]);
    assert.equal(pinSelects.length, 2);
    for (const select of pinSelects) assert.doesNotMatch(select, /value="none"|不连接/);
    assert.match(pinSelects[0], /<option value="PB0"/);
    if (value !== 'PB0') assert.match(pinSelects[0], /<option value="" selected hidden disabled>/);
    assert.match(html, /采样时长/);
    assert.doesNotMatch(html, /采样时间/);
    assert.deepEqual(adc, before);
  }
  assert.match(renderResourceEditor(mcu, [resource('spi', 'SPI1')]), /<option value="none">不连接<\/option>/);
});

test('protection editor renders one explicit enable switch and never changes a saved disabled path', () => {
  const path = { ...createTripPath('protect'), compiled: true, enabled: false };
  const before = structuredClone(path), html = renderTripEditor([path], [], { mcu });
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1);
  assert.match(html, /data-key="compiled"/);
  assert.doesNotMatch(html, /运行期|编译期|data-phase=|data-key="enabled"/);
  assert.doesNotMatch(/<input type="checkbox"[^>]+>/.exec(html)[0], /checked/);
  assert.deepEqual(path, before);
});
