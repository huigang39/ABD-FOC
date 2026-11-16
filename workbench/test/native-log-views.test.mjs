import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { createNativeClient } from '../web/src/features/device/client.mjs';
import { renderNativeBuild, renderNativeFlash } from '../web/src/features/device/view.mjs';

function fixture() {
  const project = createProject();
  const { state } = createNativeClient({ getProject: () => project, onUpdate() {}, onError() {} });
  state.job = { id: 'build-one', status: 'building', log: Array.from({ length: 100 }, (_, i) => `日志行 ${i + 1}`) };
  return { project, state };
}

test('构建日志保留服务端历史，完成后仍使用同一滚动身份，新任务独立跟随', () => {
  const { project, state } = fixture();
  const before = renderNativeBuild(project, state);
  assert.match(before, /日志行 1\n日志行 2/);
  assert.match(before, /日志行 100/);
  assert.match(before, /data-log-key="build:build-one" data-log-follow="end"/);
  state.job.status = 'built';
  assert.match(renderNativeBuild(project, state), /data-log-key="build:build-one"/);
  state.job.id = 'build-two';
  assert.match(renderNativeBuild(project, state), /data-log-key="build:build-two"/);
});

test('源码文件与烧录结果分别标识滚动位置，源码不跟随末尾', () => {
  const { project, state } = fixture();
  state.job.manifest = { generatedFiles: [{ path: 'modules/current.c', layer: 'algorithm', moduleId: 'foc-current', kind: 'c' }] };
  state.sourcePreview = { path: 'modules/current.c', content: 'void current(void) {}' };
  const code = renderNativeBuild(project, state).match(/<pre[^>]*data-log-key="source:[^>]*>/)?.[0];
  assert.ok(code.includes('source:build-one:modules/current.c'));
  assert.ok(!code.includes('data-log-follow'));
  state.sourcePreview.path = 'modules/feedback.c';
  assert.match(renderNativeBuild(project, state), /data-log-key="source:build-one:modules\/feedback.c"/);
  state.flashResult = { logId: 1, output: 'Verified' };
  assert.match(renderNativeFlash(project, state), /data-log-key="flash:1" data-log-follow="end"/);
  state.flashResult.logId = 2;
  assert.match(renderNativeFlash(project, state), /data-log-key="flash:2"/);
});
