import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { formatProjectTimestamp, normalizeProjectName } from '../web/src/core/project-name.mjs';

test('timestamp project names use local calendar fields and preserve second precision', () => {
  assert.equal(formatProjectTimestamp(new Date(2031, 1, 3, 4, 5, 6)), '20310203_040506');
  const moduleUrl = new URL('../web/src/core/project-name.mjs', import.meta.url).href;
  const source = `import { formatProjectTimestamp } from ${JSON.stringify(moduleUrl)}; process.stdout.write(formatProjectTimestamp(new Date('2031-02-03T04:05:06Z')));`;
  const output = zone => execFileSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
  assert.equal(output('Asia/Shanghai'), '20310203_120506');
  assert.equal(output('America/New_York'), '20310202_230506');
});

test('same-second automatic names get suffixes and avoid known occupied names', () => {
  const date = new Date(2032, 2, 4, 5, 6, 7), stamp = formatProjectTimestamp(date);
  assert.equal(normalizeProjectName('未命名工程', { date }), stamp);
  assert.equal(normalizeProjectName(' ', { date }), `${stamp}_2`);
  assert.equal(normalizeProjectName('', { date, existingNames: [`${stamp}_3`, `${stamp}_4`] }), `${stamp}_5`);
  assert.equal(normalizeProjectName('未命名工程 · 电机台架', { date }), '未命名工程 · 电机台架');
  assert.equal(normalizeProjectName('  用户方案  ', { date }), '  用户方案  ');
});

test('new projects use their current local creation time and remain independently named', t => {
  const date = new Date(2033, 3, 5, 6, 7, 8);
  t.mock.timers.enable({ apis: ['Date'], now: date.getTime() });
  const first = createProject(), second = createProject();
  assert.equal(first.name, '20330405_060708');
  assert.equal(second.name, '20330405_060708_2');
  assert.equal(first.updatedAt, date.toISOString());
  assert.notEqual(first.id, second.id);
  assert.equal(parseProject(serializeProject(first)).name, first.name);
});

test('imports normalize blank and exact legacy unnamed labels, without renaming user projects', () => {
  const project = createProject();
  for (const name of ['', ' \t ', '未命名', '未命名工程', '未命名配置', '未命名驱动方案']) {
    project.name = name;
    const loaded = parseProject(JSON.stringify(project));
    assert.match(loaded.name, /^\d{8}_\d{6}(?:_\d+)?$/);
    assert.equal(project.name, name);
    assert.equal(parseProject(serializeProject(loaded)).name, loaded.name);
  }
  for (const name of ['台架 A', '未命名工程试验', '20261001_120000', ' 用户命名 ']) {
    project.name = name;
    assert.equal(parseProject(JSON.stringify(project)).name, name);
  }
  project.name = null;
  assert.throws(() => parseProject(JSON.stringify(project)), /项目名称/);
});
