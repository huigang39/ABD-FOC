import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { createNativeClient } from '../web/src/features/device/client.mjs';
import { getFirmwareFlashState } from '../web/src/features/device/flash-state.mjs';
import { renderNativeFlash, renderNativeDebug } from '../web/src/features/device/view.mjs';
import { renderFlash } from '../web/src/features/build/view.mjs';

function fixture() {
  const project = createProject();
  const { state } = createNativeClient({ getProject: () => project, onUpdate() {}, onError() {} });
  const job = {
    id: 'built-one', name: '关节模组', status: 'built', fingerprint: configurationFingerprint(project), createdAt: '2026-11-15T04:00:00Z',
    manifest: { template:'abd-modular-v1', firmwareReady:true, profile: 'NEO_75_H_GW_KW', flashaddresses: { cm7: 0x08000000, cm4: 0x08100000 } },
    artifacts: [{ core: 'cm7', kind: 'bin', path: '/generated/cm7.bin' }, { core: 'cm4', kind: 'bin', path: '/generated/cm4.bin' }],
  };
  Object.assign(state, { job, jobs: [job], probes: [{ product: 'J-Link', serialNumber: 123 }], serialNumber: '123' });
  return { project, state };
}
const flashButton = html => html.match(/<button\b[^>]*data-native-action="flash"[^>]*>/)?.[0];

test('standalone flash step shows compiled firmware, explicit probe selection and both image addresses', () => {
  const { project, state } = fixture();
  state.jobs.push({ id: 'unfinished', status: 'generated', name: 'Not compiled' });
  state.jobs.push({ ...state.job, id: 'older', fingerprint: 'old-configuration' });
  const html = renderFlash(project, state);
  assert.ok(getFirmwareFlashState(project, state).ready);
  assert.ok(flashButton(html)); assert.doesNotMatch(flashButton(html), /disabled/);
  assert.match(html, /data-native-field="jobId"/); assert.match(html, /data-native-field="serialNumber"/); assert.match(html, /data-native-field="speedKHz"/);
  assert.match(html, /data-native-action="probe"/);
  assert.match(html, /value="built-one" selected/); assert.match(html, /value="123" selected/);
  assert.match(html, /0x8000000/); assert.match(html, /0x8100000/);
  assert.match(html, /cm7\.bin/); assert.match(html, /cm4\.bin/);
  assert.match(html, /对应当前配置/); assert.match(html, /其他配置/);
  assert.doesNotMatch(html, /value="unfinished"|<h1\b|data-native-action="connect"/);
  assert.match(html, /data-live="flash-gate"/);
});

test('flash step disables execution for stale or incomplete firmware, missing selection and every active task state', () => {
  for (const alter of [
    state => { state.job = null; },
    state => { state.job.status = 'generated'; },
    state => { state.job.manifest.template = 'retired'; },
    state => { state.job.manifest.firmwareReady = false; },
    state => { state.job.fingerprint = 'old'; },
    state => { state.job.artifacts.pop(); },
    state => { state.job.artifacts.push({ ...state.job.artifacts[0] }); },
    state => { delete state.job.manifest.flashaddresses.cm4; },
    state => { state.probes = []; },
    state => { state.serialNumber = ''; },
    state => { state.serialNumber = '999'; },
    state => { state.debug.connected = true; },
    state => { state.capturing = true; },
    state => { state.busy = true; },
    state => { state.pendingAction = 'probe'; },
    state => { state.speedKHz = 0; },
  ]) {
    const { project, state } = fixture(); alter(state);
    assert.equal(getFirmwareFlashState(project, state).ready, false);
    assert.match(flashButton(renderNativeFlash(project, state)), /disabled/);
  }
});

test('debug view links to the flash step and never embeds a flash button or flash log', () => {
  const { project, state } = fixture();
  state.flashResult = { logId: 3, output: 'FLASH RESULT', programmed: true };
  const html = renderNativeDebug(project, state);
  assert.match(html, /href="#\/project\/flash">前往烧录/);
  assert.doesNotMatch(html, /data-native-action="flash"|FLASH RESULT|native-flash-panel/);
  assert.match(renderNativeFlash(project, state), /data-log-key="flash:3" data-log-follow="end"/);
});

test('flash rendering escapes local metadata and reflects edits to the current configuration', () => {
  const { project, state } = fixture();
  state.job.artifacts[0].path = '/generated/<img>.bin';
  state.probes[0].product = '<script>probe</script>';
  project.build.optimization = 'O3';
  const html = renderNativeFlash(project, state);
  assert.match(html, /配置已调整/); assert.match(html, /href="#\/project\/build"/);
  assert.match(flashButton(html), /disabled/);
  assert.match(html, /&lt;img&gt;\.bin/); assert.match(html, /&lt;script&gt;probe&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
});
