import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOptions,isBinaryChoice,binaryChoice} from '../web/src/shared/forms/select-control.mjs';
import {edit} from '../web/src/features/configuration/view.mjs';

test('未配置状态不作为菜单选项，也不默认选择真实硬件',()=>{
  const html=selectOptions([['','选择 Flash'],['one','Flash 1'],['two','Flash 2']], '');
  assert.match(html,/<option value="" selected hidden disabled>—<\/option>/);
  assert.doesNotMatch(html,/选择 Flash/);
  assert.doesNotMatch(html,/<option value="(?:one|two)" selected/);
  const selected=selectOptions([['unselected','待选择'],['one','Flash 1']], 'one');
  assert.doesNotMatch(selected,/unselected|待选择/);
  assert.match(selected,/<option value="one" selected>Flash 1/);
});
test('两种真实能力直接选择，未知值不冒充已确认能力',()=>{
  const choices=[['unconfirmed','未确认'],['yes','支持'],['no','不支持']];
  assert(isBinaryChoice(choices));
  const html=binaryChoice(choices,'unconfirmed','id="field" data-edit="memory-bank" aria-label="可执行代码"',{name:'executable',label:'可执行代码'});
  assert.match(html,/role="radiogroup"/);assert.doesNotMatch(html,/\bchecked\b|未确认|unconfirmed|id="field"/);
  assert.equal((html.match(/type="radio"/g)||[]).length,2);
  assert.match(edit('可执行代码','yes','memory-bank','executable',{choices}),/value="yes" checked/);
});
test('未知引用保持原值且不可重新选择，选项内容正确转义',()=>{
  const html=selectOptions([['removed','已移除',true],['safe','<img src=x>']], 'removed');
  assert.match(html,/<option value="removed" selected disabled hidden>/);
  assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img/);
});
