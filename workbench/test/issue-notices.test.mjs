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
  assert.match(html, /aria-label="&lt;script&gt;&quot;检查&quot;&lt;\/script&gt;，1 项"/);
  assert.match(html, /title="&lt;script&gt;&quot;检查&quot;&lt;\/script&gt;，1 项"/);
  assert.equal(issueNoticeButton([]), '');
});

test('issue actions use a check icon, exact accessible count and the highest relevant severity', () => {
  for (const [levels, level] of [
    [['info', 'warning', 'error'], 'error'],
    [['success', 'pending'], 'warning'],
    [['warning', 'info'], 'warning'],
    [['info', 'success'], 'normal'],
  ]) {
    const issues = levels.map((value, index) => ({ id: `issue-${index}`, level: value }));
    const html = issueNoticeButton(issues, { label: '查看分区检查' });
    assert.match(html, new RegExp(`data-level="${level}"`));
    assert.match(html, /<use href="\/assets\/icons\.svg#check"/);
    assert.match(html, new RegExp(`aria-label="查看分区检查，${issues.length} 项"`));
    assert.match(html, new RegExp(`<span class="notification-action-count" aria-hidden="true">${issues.length}<\\/span>`));
    assert.deepEqual(issueGroups(html), [issues.map(issue => issue.id)]);
    assert.doesNotMatch(html, /<\/svg>查看分区检查/);
  }
  const many = Array.from({ length: 120 }, (_, index) => ({ id: `issue-${index}`, level: 'info' }));
  assert.match(issueNoticeButton(many), />120<\/span>/);
  assert.match(issueNoticeButton([], { showEmpty: true }), /data-level="normal"[^>]*aria-label="查看检查结果，0 项"/);
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
