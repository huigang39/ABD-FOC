import test from 'node:test';
import assert from 'node:assert/strict';
import { numericDraftIssues } from '../web/src/features/configuration/draft-issues.mjs';
import { getGuide } from '../web/src/features/configuration/guide.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';

test('rejected core draft turns only its module red without modifying the project', () => {
  const project = createNeo75hProject(), before = structuredClone(project);
  const issues = numericDraftIssues([{scope:'platform-core', moduleId:'hw-platform', child:'cm7', key:'clockHz', label:'内核时钟', message:'数值不能大于 480 MHz。'}]);
  const hardware = getGuide(project,issues).steps.find(step=>step.id==='hardware');
  assert.equal(hardware.state,'blocked');
  assert.equal(hardware.children.find(child=>child.id==='hw-platform').state,'blocked');
  assert.equal(hardware.children.find(child=>child.id==='hw-platform').issues[0].coreId,'cm7');
  assert(!hardware.children.find(child=>child.id==='hw-drivers').issues.some(issue=>issue.id.startsWith('input-draft:')));
  assert.deepEqual(project,before);
  assert(!getGuide(project,[]).steps.find(step=>step.id==='hardware').children.find(child=>child.id==='hw-platform').issues.some(issue=>issue.id.startsWith('input-draft:')));
});

test('draft diagnostics keep field identity and route to the edited asset', () => {
  const issues = numericDraftIssues([{scope:'driver', id:'driver-1', key:'pwmHz', label:'PWM 频率', message:'请输入有效数值。'}],{page:'equipment',itemId:'driver-1'});
  assert.equal(issues[0].level,'error');
  assert.equal(issues[0].designPage,'equipment');
  assert.equal(issues[0].itemId,'driver-1');
  assert.equal(issues[0].paramKey,'pwmHz');
  assert.match(issues[0].message,/请输入有效数值/);
});
