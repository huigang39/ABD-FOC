import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { serializeProject, parseProject, validateProject } from '../web/src/core/model.mjs';
import { hardwareFieldOptions, resourceSettingOptions } from '../web/src/modules/hardware/hw-platform/options.mjs';
import { createResource, selectResourceInstance, resourceIssues } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { renderResourceEditor, renderTripEditor } from '../web/src/features/configuration/hardware-view.mjs';
import { createTripPath } from '../web/src/modules/hardware/hw-safety/paths.mjs';
import { fieldHelp } from '../web/src/shared/ui/field-help.mjs';
import { renderEquipment } from '../web/src/features/equipment/view.mjs';
const mcu='STM32H745IIK6';

test('ADC and IRQ selectors expose supported H745 values without assuming other chips',()=>{
  assert.deepEqual(hardwareFieldOptions(mcu,'hw-board','adcBits').map(item=>item.value),[8,10,12,14,16]);
  assert.deepEqual(hardwareFieldOptions(mcu,'hw-platform','controlIrqPriority').map(item=>item.value),['emergency','realtime','high','normal','background']);
  assert.equal(hardwareFieldOptions('HPM5361','hw-board','adcBits'),undefined);
  assert.equal(hardwareFieldOptions('STM32G474RE','hw-board','adcBits'),undefined);
  assert.deepEqual(resourceSettingOptions(mcu,{kind:'adc'},'sampleCycles').map(item=>item.value),[1.5,2.5,8.5,16.5,32.5,64.5,387.5,810.5]);
});
test('SPI word length follows the peripheral instance and rejects invalid imported choices',()=>{
  const resource=createResource('spi','spi');selectResourceInstance(resource,mcu,'SPI2');
  assert.equal(resourceSettingOptions(mcu,resource,'wordBits').at(-1).value,32);
  resource.settings={clockHz:1000000,mode:'0',wordBits:32};
  selectResourceInstance(resource,mcu,'SPI5');
  assert.equal(resourceSettingOptions(mcu,resource,'wordBits').at(-1).value,16);
  assert(resourceIssues(mcu,[resource]).some(issue=>issue.id.endsWith('wordBits-choice')));
  resource.settings.wordBits=16;
  assert(!resourceIssues(mcu,[resource]).some(issue=>issue.level==='error'));
});
test('numeric choices stay numeric through save and import and capability validation still runs',()=>{
  const p=createNeo75hProject();p.instances['hw-board'].parameters.adcBits=12;
  p.instances['hw-board'].parameters.resources.find(r=>r.kind==='adc').settings.sampleCycles=8.5;
  const q=parseProject(serializeProject(p));
  assert.equal(q.instances['hw-board'].parameters.adcBits,12);
  assert.equal(q.instances['hw-board'].parameters.resources.find(r=>r.kind==='adc').settings.sampleCycles,8.5);
  q.instances['hw-board'].parameters.adcBits=13;
  assert(validateProject(q).some(issue=>issue.id==='hardware-adcBits-choice'&&issue.level==='error'));
});
test('both board editors and shelf use constrained selects; continuous values remain numeric',()=>{
  const p=createNeo75hProject(), resources=p.instances['hw-board'].parameters.resources;
  const html=renderResourceEditor(mcu,resources);
  assert.match(html,/<select[^>]+data-key="sampleCycles"[^>]+data-value-type="number"/);
  assert.match(html,/<select[^>]+data-key="trigger"/);
  assert.match(html,/<input[^>]+data-key="bitrate"[^>]+type="number"/);
  assert.match(renderTripEditor([createTripPath('fault')],resources,{mcu}),/<select[^>]+data-key="priority"[^>]+data-value-type="select"/);
  assert.match(renderEquipment(p,[],'drivers'),/<select[^>]+data-key="adcBits"[^>]+data-value-type="integer"/);
});
test('help metadata escapes HTML and does not become an action or form submission',()=>{
  const html=fieldHelp('A < B "quote" <img src=x>','ADC');
  assert.match(html,/type="button"/);assert.match(html,/aria-label="ADC说明"/);
  assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img|data-action=/);
});
