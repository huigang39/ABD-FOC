import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newModuleProject } from './support/new-project.mjs';
import { MODULE_CODE } from '../native/generator/modules.mjs';
import { inspectFirmwareSupport, generateFirmware } from '../native/firmware.mjs';

const newGainKeys = ['torqueKp','torqueKi','torqueKd','speedKd','positionKp','positionKi','positionKd','pdKp','pdKd'];
const motion = project => project.instances['app-motion'].parameters;
const values = project => MODULE_CODE['app-motion'].values(project);
function speedProject() {
  const project = newModuleProject();
  Object.assign(motion(project), { supportedModes: ['current','speed'], activeMode: 'speed', speedKp: 0.3, speedKi: 0.8, speedFilterHz: 75, profileVelocityRadS: 4, profileAccelerationRadS2: 3 });
  return project;
}

test('absent, null and zero new gains preserve legacy current and speed PI generator configuration', () => {
  for (const project of [newModuleProject(), speedProject()]) {
    for (const key of newGainKeys) delete motion(project)[key];
    const original = values(project);
    for (const value of [null, 0]) {
      for (const key of newGainKeys) motion(project)[key] = value;
      assert.deepEqual(values(project), original);
      assert.equal(inspectFirmwareSupport(project).sourceReady, true);
    }
  }
  const project = speedProject(), generated = values(project);
  assert.equal(generated.speed_kp, 0.3);
  assert.equal(generated.speed_ki, 0.8);
  assert.equal(generated.speed_filter_hz, 75);
  assert.equal(generated.speed_limit, 4);
  assert.equal(generated.acceleration, 3);
  motion(project).speedKp = 0.6;
  motion(project).speedKi = 1.2;
  assert.equal(values(project).speed_kp, 0.6);
  assert.equal(values(project).speed_ki, 1.2);
});

test('each nonzero new gain blocks native support even when legacy current mode would not consume it', () => {
  for (const key of newGainKeys) {
    const project = newModuleProject();
    motion(project)[key] = 0.25;
    const before = structuredClone(project);
    assert.throws(() => values(project), /尚未接入固件生成.*不能忽略新增增益/);
    const report = inspectFirmwareSupport(project);
    assert.equal(report.sourceReady, false, key);
    assert(report.sourceIssues.some(issue => issue.moduleId === 'app-motion' && issue.code === 'implementation' && /不能忽略新增增益/.test(issue.message)), key);
    assert.deepEqual(project, before);
  }
});

test('unsupported gain guards do not coerce invalid values into zero', () => {
  for (const value of [-1, false, '', '0', NaN, Infinity]) {
    const project = newModuleProject();
    motion(project).speedKd = value;
    assert.throws(() => values(project), /速度微分增益尚未接入/);
  }
});

test('nonzero new controller gains stop public generation before any artifacts are written', async t => {
  const project = newModuleProject();
  motion(project).positionKp = 2;
  motion(project).pdKd = 0.4;
  const outputRoot = await mkdtemp(join(tmpdir(), 'abd-motion-gains-boundary-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await assert.rejects(generateFirmware({ project, outputRoot }), /位置比例增益、PD 微分增益尚未接入/);
  assert.deepEqual(await readdir(outputRoot), []);
});
