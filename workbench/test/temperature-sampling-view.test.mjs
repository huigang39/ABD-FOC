import test from 'node:test';
import assert from 'node:assert/strict';
import { renderResourceEditor, TEMPERATURE_LOCATIONS } from '../web/src/features/configuration/hardware-view.mjs';
import { createPresetResource } from '../web/src/modules/hardware/hw-board/resources.mjs';

const mcu = 'STM32H745IIK6';

test('default temperature sampling has a selectable location and three add actions without renaming stored data', () => {
  const resource = createPresetResource('temperature', 'temp');
  const before = structuredClone(resource);
  const html = renderResourceEditor(mcu, [resource], { owner: 'driver-owner' });
  assert.equal((html.match(/class="resource-disclosure hardware-resource temperature-sampling"/g) || []).length, 1);
  assert.equal((html.match(/data-temperature-channel=/g) || []).length, 1);
  assert.match(html, /<h4>逆变器温度<\/h4>/);
  assert.match(html, /<select[^>]*data-key="name"[^>]*aria-label="测量位置"/);
  assert.doesNotMatch(html, /<input[^>]*data-key="name"|data-action="remove-pcba-resource"/);
  for (const name of TEMPERATURE_LOCATIONS) assert.ok(html.includes(`data-preset="temperature" data-kind="adc" data-name="${name}" data-owner="driver-owner"`));
  assert.match(html, /data-key="channel"/);
  assert.match(html, /data-key="samplingPin"[^>]*disabled/);
  assert.deepEqual(resource, before);
});

test('multiple temperature measurements retain independent ADC channel bindings and can remove extras', () => {
  const resources = TEMPERATURE_LOCATIONS.map((name, index) => ({ ...createPresetResource('temperature', `temp-${index}`), name, instance: 'ADC1', pins: { [`INP${[0,9,10][index]}`]: ['PA0_C','PB0','PC0'][index] } }));
  const before = structuredClone(resources);
  const html = renderResourceEditor(mcu, resources);
  assert.equal((html.match(/data-temperature-channel=/g) || []).length, 3);
  assert.equal((html.match(/data-action="remove-pcba-resource"/g) || []).length, 3);
  for (const [index, resource] of resources.entries()) {
    assert.ok(html.includes(`data-id="${resource.id}" data-owner="" data-key="channel"`));
    assert.ok(html.includes(`data-id="${resource.id}" data-owner="" data-key="INP${[0,9,10][index]}" data-section="pins"`));
    assert.ok(html.includes(`<h4>${resource.name}</h4>`));
  }
  assert.doesNotMatch(html, /data-key="trigger"|data-key="currentGain"|<input[^>]*data-key="name"/);
  assert.deepEqual(resources, before);
});
