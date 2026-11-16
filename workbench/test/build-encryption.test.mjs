import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { createNeo75hProject } from '../web/src/profiles/neo75h.mjs';
import { renderBuild } from '../web/src/features/build/view.mjs';
import { inspectFirmwareSupport, generateFirmware, buildFirmware } from '../native/firmware.mjs';

test('固件加密默认关闭，缺省字段经项目规范化后为 false', () => {
  assert.equal(createProject().build.encryptFirmware, false);
  assert.equal(createNeo75hProject('KW').build.encryptFirmware, false);
  const project = createProject();
  delete project.build.encryptFirmware;
  const loaded = parseProject(JSON.stringify(project));
  assert.equal(loaded.build.encryptFirmware, false);
  assert.equal(Object.hasOwn(project.build, 'encryptFirmware'), false);
});

test('固件加密可保存加载并影响配置指纹，不改变编译器或优化选项', () => {
  const project = createNeo75hProject('KW');
  const fingerprint = configurationFingerprint(project);
  const original = structuredClone(project.build);
  project.build.encryptFirmware = true;
  assert.notEqual(configurationFingerprint(project), fingerprint);
  const loaded = parseProject(serializeProject(project));
  assert.equal(loaded.build.encryptFirmware, true);
  assert.equal(configurationFingerprint(loaded), configurationFingerprint(project));
  assert.deepEqual(loaded.build, { ...original, encryptFirmware: true });
  loaded.build.encryptFirmware = false;
  assert.equal(configurationFingerprint(loaded), fingerprint);
  for (const value of [null, 0, 1, 'true', 'false', {}, []]) {
    project.build.encryptFirmware = value;
    assert.throws(() => parseProject(JSON.stringify(project)), /encryptFirmware.*布尔值/);
    assert.throws(() => serializeProject(project), /encryptFirmware.*布尔值/);
  }
});

test('构建页将固件交付与优化配置分开，开关使用现有布尔编辑器', () => {
  const project = createProject();
  const html = renderBuild(project);
  assert.match(html, /<h2>固件交付<\/h2>/);
  assert.match(html, /type="checkbox"[^>]*data-edit="build"[^>]*data-key="encryptFirmware"[^>]*data-value-type="boolean"/);
  assert.match(html, /服务器签名加密服务与设备 Bootloader/);
  assert.match(html, /当前尚未接入，生成和编译会被阻止/);
});

test('加密配置在所有型号上明确为不支持，关闭后不影响原支持判断', () => {
  for (const project of [createProject(), createNeo75hProject('KW')]) {
    const before = inspectFirmwareSupport(project).issues;
    project.build.encryptFirmware = true;
    const report = inspectFirmwareSupport(project);
    assert.equal(report.supported, false);
    const issue = report.issues.find(issue => issue.code === 'encryption-unsupported');
    assert.equal(issue.path, 'build.encryptFirmware');
    assert.match(issue.message, /尚未接入服务器签名加密服务与设备 Bootloader/);
    assert.match(issue.message, /不能生成或编译明文固件/);
    project.build.encryptFirmware = false;
    assert.deepEqual(inspectFirmwareSupport(project).issues, before);
  }
});

test('加密开启时生成、直接编译与已有任务编译均不会落地明文产物', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'abd-encryption-'));
  const project = createNeo75hProject('KW');
  project.build.encryptFirmware = true;
  try {
    const rejectsEncryption = error => error.issues.some(issue => issue.code === 'encryption-unsupported');
    await assert.rejects(generateFirmware({ project, outputRoot }), rejectsEncryption);
    await assert.rejects(buildFirmware({ project, outputRoot }), rejectsEncryption);
    await assert.rejects(buildFirmware({ project, jobId: 'existing-job', outputRoot }), rejectsEncryption);
    assert.deepEqual(await readdir(outputRoot), []);
    const root = join(outputRoot, 'existing-job');
    await mkdir(root);
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ id: 'existing-job' }));
    await writeFile(join(root, 'project.json'), JSON.stringify(project));
    await assert.rejects(buildFirmware({ jobId: 'existing-job', outputRoot }), rejectsEncryption);
    assert.deepEqual((await readdir(root)).sort(), ['manifest.json', 'project.json']);
  } finally { await rm(outputRoot, { recursive: true, force: true }); }
});
