import test from 'node:test';
import assert from 'node:assert/strict';
import { renderResourceEditor } from '../web/src/features/configuration/hardware-view.mjs';
import { createPresetResource } from '../web/src/modules/hardware/hw-board/resources.mjs';

const resource = (preset, id, instance) => ({ ...createPresetResource(preset, id), instance });
const headers = html => [...html.matchAll(/<header class="hardware-resource-heading"[^>]*>([\s\S]*?)<\/header>/g)].map(match=>match[1]);
const tags = header => [...header.matchAll(/<span class="attribute-tag">([^<]*)<\/span>/g)].map(match=>match[1]);

test('resource headers show actual assigned peripheral tags and deduplicate grouped ADC instances', () => {
  const resources = [resource('phase-current','cur1','ADC1'),resource('phase-current','cur2','ADC1'),resource('phase-current','cur3','ADC2'),resource('temperature','temp1','ADC3'),resource('temperature','temp2','ADC3'),resource('pwm','bridge','HRTIM1')];
  resources.at(-1).pins = { A1:'PC6',A2:'PC7' };
  const before = structuredClone(resources);
  const output = headers(renderResourceEditor('STM32H745IIK6', resources));
  assert.deepEqual(tags(output.find(header=>header.includes('<strong>相电流采样</strong>'))), ['ADC1','ADC2']);
  assert.deepEqual(tags(output.find(header=>header.includes('<strong>温度采样</strong>'))), ['ADC3']);
  const pwm = output.find(header=>header.includes('<strong>PWM</strong>'));
  assert.deepEqual(tags(pwm), ['HRTIM1']);
  assert.doesNotMatch(pwm, /PC6|PC7|hardware-resource-meta/);
  assert.deepEqual(resources, before);
});

test('unassigned sampling never invents an instance tag and stored identifiers are escaped', () => {
  const resources = [resource('phase-current','blank',''),resource('temperature','temp',''),resource('bus-voltage','bus','<ADC>')];
  const output = headers(renderResourceEditor('STM32H745IIK6', resources));
  assert.deepEqual(tags(output.find(header=>header.includes('<strong>相电流采样</strong>'))), []);
  assert.deepEqual(tags(output.find(header=>header.includes('<strong>温度采样</strong>'))), []);
  assert.deepEqual(tags(output.find(header=>header.includes('<strong>母线电压采样</strong>'))), ['&lt;ADC&gt;']);
});
