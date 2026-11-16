import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibleUnits, convertUnit, defaultDisplayUnit, normalizeUnit } from '../web/src/shared/forms/units.mjs';

test('unit families convert only compatible physical quantities and accept common micro/ohm notation', () => {
  for (const [value, from, to, expected] of [
    [1.5, 'ms', 'us', 1500], [400, 'MHz', 'Hz', 400000000], [25, 'mA', 'A', 0.025],
    [3300, 'mV', 'V', 3.3], [25, 'mΩ', 'Ohm', 0.025], [250, 'μH', 'H', 0.00025],
    [2, 'MiB', 'KiB', 2048], [180, '°', 'rad', Math.PI], [30, 'rpm', 'rad/s', Math.PI],
    [1500, 'N·mm', 'N·m', 1.5], [1, 'Mbit/s', 'bit/s', 1000000], [1024, 'byte', 'KiB', 1],
  ]) assert.equal(convertUnit(value, from, to), expected, `${from} → ${to}`);
  assert.equal(normalizeUnit('µs'), 'μs');
  assert.equal(normalizeUnit('uH'), 'μH');
  assert.deepEqual(compatibleUnits('Ohm'), ['mΩ', 'Ω']);
  for (const unit of ['bit', '个', '%', 'unrecognized']) assert.deepEqual(compatibleUnits(unit), []);
  assert.ok(Number.isNaN(convertUnit(1, 'A', 'V')));
  assert.ok(Number.isNaN(convertUnit(Infinity, 'A', 'mA')));
  assert.equal(convertUnit(null, 'A', 'mA'), null);
});

test('decimal prefixes preserve integer base values and fractional precision without arithmetic noise', () => {
  for (const [value, from, to, expected] of [
    [0.001, 'ms', 'μs', 1], [0.000001, 'MHz', 'Hz', 1], [0.1, 's', 'ns', 100000000],
    [123.4567890123456, 'A', 'mA', 123456.7890123456], [1e-7, 'H', 'μH', 0.1],
  ]) {
    assert.equal(convertUnit(value, from, to), expected);
    assert.equal(convertUnit(expected, to, from), value);
  }
});

test('MHz is the initial clock display while lower-frequency non-clock fields retain their base unit', () => {
  assert.equal(defaultDisplayUnit('Hz', 400000000, '内核主频'), 'MHz');
  assert.equal(defaultDisplayUnit('Hz', null, '输入时钟'), 'MHz');
  assert.equal(defaultDisplayUnit('Hz', 8000000, '采样频率'), 'MHz');
  assert.equal(defaultDisplayUnit('Hz', 20000, 'PWM 频率'), 'Hz');
  assert.equal(defaultDisplayUnit('kHz', 20, 'PWM 频率'), 'kHz');
  assert.equal(defaultDisplayUnit('us', 1500, '任务周期'), 'μs');
});

test('temperature conversions include the offset and handle zero and negative values', () => {
  for(const [value,from,to,expected] of [[0,'°C','°F',32],[-40,'°C','°F',-40],[-40,'°F','°C',-40],[32,'°F','K',273.15],[0,'K','°C',-273.15],[20,'°C','K',293.15],[293.15,'K','°F',68]]) {
    assert.ok(Math.abs(convertUnit(value,from,to)-expected)<1e-10,`${from} → ${to}`);
  }
  assert.deepEqual(compatibleUnits('°C'),['°C','°F','K']);
  assert.ok(Number.isNaN(convertUnit(1,'K','s')));
  assert.ok(Number.isFinite(convertUnit(1e308,'°F','°C')));
});

test('composite motor and control units preserve their denominators and physical dimensions', () => {
  for(const [base,smaller] of [['A/rad','mA/rad'],['A/(rad/s)','mA/(rad/s)'],['V/A','mV/A'],['V/(A·s)','mV/(A·s)'],['N·m/(rad/s)','N·mm/(rad/s)'],['N·m/s','N·mm/s'],['N·m/原始单位','N·mm/原始单位'],['N·m/A','N·mm/A']]) {
    assert.equal(convertUnit(1.5,base,smaller),1500);
    assert.equal(convertUnit(1500,smaller,base),1.5);
  }
  assert.equal(convertUnit(180,'°/s²','rad/s²'),Math.PI);
  assert.ok(Number.isNaN(convertUnit(1,'N·m/原始单位','N·m/A')));
  assert.ok(Number.isNaN(convertUnit(1,'A/rad','A/(rad/s)')));
});
