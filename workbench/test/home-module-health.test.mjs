import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { getModuleHealth } from '../web/src/features/architecture/module-health.mjs';

const now = 10000;
function diagnostic(project, status = 'ok') {
  return {
    source: 'device', connected: true, projectId: project.id,
    fingerprint: configurationFingerprint(project), observedAt: now,
    modules: Object.fromEntries(['application', 'algorithm', 'hardware', 'motor', 'reducer'].map(key => [key, { status }])),
  };
}

test('modules without real device diagnostics retain the neutral default border', () => {
  const project = createNeo75hProject('KW');
  for (const key of ['application', 'algorithm', 'hardware', 'motor', 'reducer']) {
    assert.equal(getModuleHealth(project, key, null, now).state, 'unknown');
    assert.equal(getModuleHealth(project, key).state, 'unknown');
  }
  assert.equal(getModuleHealth(null, 'application', diagnostic(project), now).state, 'unknown');
});

test('configuration completeness and issues never determine homepage border colors', () => {
  for (const [moduleId, key, value] of [
    ['hw-board', 'pwmHz', 20000], ['hw-board', 'pwmHz', null], ['hw-board', 'pwmHz', -1],
    ['app-motion', 'currentLimitA', null], ['app-motion', 'currentLimitA', -1],
  ]) {
    const project = createNeo75hProject('KW');
    project.instances[moduleId].parameters[key] = value;
    const live = diagnostic(project);
    assert.equal(getModuleHealth(project, 'application', null, now).state, 'unknown', '配置问题保留在参数检查页，未连接时主页为默认边框');
    assert.equal(getModuleHealth(project, 'application', live, now).state, 'ok', '主页仅显示真实设备连接诊断');
  }
});

test('only an explicit fresh device ok for the same project and fingerprint is green', () => {
  const project = createNeo75hProject('KW'), live = diagnostic(project);
  for (const key of Object.keys(live.modules)) assert.equal(getModuleHealth(project, key, live, now).state, 'ok');
  assert.equal(getModuleHealth(project, 'application', { ...live, observedAt: now - 1000 }, now).state, 'ok');
  for (const [reason, altered] of [
    ['未连接', { connected: false }], ['连接标记不是布尔值', { connected: 1 }],
    ['其他工程', { projectId: 'another-project' }], ['不同配置', { fingerprint: 'outdated' }],
    ['缺少配置指纹', { fingerprint: undefined }], ['非设备诊断', { source: 'configuration' }],
    ['过期', { observedAt: now - 1001 }], ['未来时间', { observedAt: now + 1 }],
    ['缺少采样时间', { observedAt: undefined }], ['时间不是数值', { observedAt: String(now) }],
    ['缺少模块结果', { modules: {} }], ['未明确正常', { modules: { application: { status: 'connected' } } }],
  ]) assert.equal(getModuleHealth(project, 'application', { ...live, ...altered }, now).state, 'unknown', reason);
  project.instances['hw-board'].parameters.pwmHz += 1000;
  assert.equal(getModuleHealth(project, 'application', live, now).state, 'unknown', '工程修改后旧诊断失效');
});

test('only fresh real device warning or error diagnoses color modules yellow or red', () => {
  const project = createNeo75hProject('KW'), live = diagnostic(project, 'error');
  const projectBefore = structuredClone(project), diagnosticBefore = structuredClone(live);
  assert.equal(getModuleHealth(project, 'hardware', live, now).state, 'error');
  assert.equal(getModuleHealth(project, 'hardware', { ...live, observedAt: 0 }, now).state, 'unknown');
  assert.equal(getModuleHealth(project, 'motor', diagnostic(project, 'warning'), now).state, 'warning');
  for (const status of ['warning', 'error']) {
    const diagnosis = diagnostic(project, status);
    for (const altered of [{ connected: false }, { source: 'configuration' }, { fingerprint: 'outdated' }, { projectId: 'other' }, { observedAt: now - 1001 }]) {
      assert.equal(getModuleHealth(project, 'hardware', { ...diagnosis, ...altered }, now).state, 'unknown');
    }
  }
  assert.deepEqual(project, projectBefore);
  assert.deepEqual(live, diagnosticBefore);
});
