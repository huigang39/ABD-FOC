import test from 'node:test';
import assert from 'node:assert/strict';
import { issueNoticeButton } from '../web/src/shared/ui/issue-notices.mjs';
import { createProject } from '../web/src/core/model.mjs';
import { createActuator } from '../web/src/features/equipment/model.mjs';
import { renderEquipment } from '../web/src/features/equipment/view.mjs';
import { renderMemory } from '../web/src/features/deployment/flash-view.mjs';
import { renderModuleData } from '../web/src/features/configuration/view.mjs';
import { MODULES } from '../web/src/core/catalog.mjs';

const unescape = value => value.replace(/&(quot|#39|lt|gt|amp);/g, (_, entity) => ({ quot: '"', '#39': "'", lt: '<', gt: '>', amp: '&' }[entity]));
const issueGroups = html => [...html.matchAll(/data-issue-ids="([^"]*)"/g)].map(match => JSON.parse(unescape(match[1])));

test('issue dialog entry points safely preserve IDs and titles containing HTML delimiters', () => {
  const id = '\"><img src=x onerror=alert(1)> & \'', label = '<script>"检查"</script>';
  const html = issueNoticeButton([{ id }], { label, liveKey: 'a"b' });
  assert.deepEqual(issueGroups(html), [[id]]);
  assert(!html.includes('<img'));
  assert(!html.includes('<script>'));
  assert.match(html, /data-live="a&quot;b"/);
  assert.match(html, /type="button"/);
  assert.equal(issueNoticeButton([]), '');
});

test('shelf diagnostics keep the selected scope without truncating or rendering detailed feedback inline', () => {
  const project = createProject(), first = createActuator('一号'), other = createActuator('二号');
  project.catalog.actuators.push(first, other);
  const relevant = Array.from({ length: 12 }, (_, index) => ({ id: `selected-${index}`, designPage: 'equipment', itemId: first.id, level: 'warning', title: 'DIAGNOSTIC_TITLE', message: 'DIAGNOSTIC_DETAIL' }));
  const issues = [...relevant, { ...relevant[0], id: 'other-item', itemId: other.id }, { ...relevant[0], id: 'other-page', designPage: 'protocol' }];
  const html = renderEquipment(project, issues, 'actuators', first.id);
  assert.deepEqual(issueGroups(html), [relevant.map(issue => issue.id)]);
  assert(!html.includes('DIAGNOSTIC_DETAIL'));
  assert(!html.includes('DIAGNOSTIC_TITLE'));
  assert.match(html, /data-live="equipment-health"/);
});

test('memory and missing module bindings expose real issue IDs and preserve empty live containers', () => {
  const project = createProject();
  const issues = [{ id: 'memory-range', level: 'error', title: 'INLINE_TITLE', message: 'INLINE_DETAIL' }, { id: 'execution-other', level: 'error' }];
  const memory = renderMemory(project, issues);
  assert.deepEqual(issueGroups(memory), [['memory-range']]);
  assert(!memory.includes('INLINE_DETAIL'));
  assert.match(renderMemory(project, []), /data-live="memory-issues"><\/div>/);
  project.design.moduleContracts['foc-current'].input = 'missing-structure';
  const data = renderModuleData(project, MODULES.find(module => module.id === 'foc-current'));
  assert.deepEqual(issueGroups(data), [['contract-foc-current-input-unknown']]);
  assert(!data.includes('class="design-warning'));
});
