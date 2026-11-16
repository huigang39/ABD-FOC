import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { getBuildInspectionState } from '../web/src/features/build/gate.mjs';
import { renderNativeBuild } from '../web/src/features/device/view.mjs';
import { renderBuild } from '../web/src/features/build/view.mjs';

const passed = project => ({ fingerprint: configurationFingerprint(project), supported: true, issues: [] });
const state = inspection => ({ inspection, pendingAction: '', busy: false, debug: { connected: false }, job: null });
function disabledActions(html) {
  return Object.fromEntries([...html.matchAll(/<button\b[^>]*data-native-action="(build|generate)"([^>]*)>/g)].map(([, action, attrs]) => [action, /\bdisabled\b/.test(attrs)]));
}

test('build inspection states require current successful reports and reject stale, checking or contradictory reports', () => {
  const project = createProject(), fingerprint = configurationFingerprint(project);
  assert.equal(getBuildInspectionState(project).status, 'unchecked');
  assert.equal(getBuildInspectionState(project, state(passed(project))).status, 'passed');
  for (const [inspection, expected] of [
    [{ ...passed(project), supported: false }, 'failed'],
    [{ ...passed(project), supported: 'true' }, 'failed'],
    [{ ...passed(project), issues: [{ level: 'error', message: 'Invalid' }] }, 'failed'],
    [{ ...passed(project), fingerprint: 'other' }, 'stale'],
    [{ ...passed(project), stale: true }, 'stale'],
    [{ ...passed(project), projectId: 'another-configuration' }, 'stale'],
  ]) {
    const result = getBuildInspectionState(project, state(inspection));
    assert.equal(result.status, expected); assert.equal(result.supported, false);
  }
  const checking = getBuildInspectionState(project, { ...state(passed(project)), pendingAction: 'inspect' });
  assert.equal(checking.status, 'checking'); assert.equal(checking.supported, false);
  const saved = state(passed(project));
  project.build.optimization = 'O3';
  assert.notEqual(configurationFingerprint(project), fingerprint);
  assert.equal(getBuildInspectionState(project, saved).status, 'stale');
});

test('measurement records and display metadata do not invalidate otherwise identical firmware checks', () => {
  const project = { id: 'one', name: 'Name', build: { optimization: 'O2' } };
  const saved = state({ ...passed(project), projectId: project.id });
  project.name = 'Renamed'; project.revision = 9;
  project.performance = { records: [{ samples: [{ currentA: 2, torqueNm: 5 }] }] };
  assert.equal(getBuildInspectionState(project, saved).supported, true);
});

test('build buttons perform fresh checks on click without a separate check navigation', () => {
  const project = createProject();
  for (const [input, disabled] of [
    [state(null), false], [state(passed(project)), false],
    [state({ ...passed(project), supported: false }), false],
    [state({ ...passed(project), fingerprint: 'old' }), false],
    [{ ...state(passed(project)), pendingAction: 'inspect' }, true],
    [{ ...state(passed(project)), busy: true }, true],
    [{ ...state(passed(project)), debug: { connected: true } }, true],
  ]) {
    const html = renderNativeBuild(project, input);
    assert.deepEqual(disabledActions(html), { build: disabled, generate: disabled });
    assert.match(html, /data-live="build-gate"/);
    assert.doesNotMatch(html, /data-native-action="(?:inspect|review-inspection)"|new-neo75h|native-product-picker/);
    assert.doesNotMatch(html, /href="#\/project\/validation"/);
    assert.match(html, /检查并构建|正在构建/);
  }
  assert.doesNotMatch(renderBuild(project, state(null)), /<h1\b/);
});
