import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../web/src/core/model.mjs';
import { createActuator, createDriver, createJointModule, createAssembly } from '../web/src/features/equipment/model.mjs';
import { createPerformanceDraft, savePerformanceRecord } from '../web/src/features/performance/model.mjs';
import { renderPerformance, renderPerformanceCurve, renderAssemblyPerformance } from '../web/src/features/performance/view.mjs';

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function fixture(kind = 'kt') {
  const project = createProject();
  project.catalog.actuators.push(createActuator('执行器 <A>'));
  project.catalog.drivers.push(createDriver('驱动器 B'));
  const assembly = createJointModule(project, { name: '关节模组 A', actuatorId: project.catalog.actuators[0].id, driverId: project.catalog.drivers[0].id });
  project.catalog.assemblies.push(assembly); project.catalog.activeAssemblyId = assembly.id;
  const draft = createPerformanceDraft(project, assembly.id, kind);
  draft.measuredAt = '2026-11-15T13:15:00+08:00';
  draft.firmwareId = 'release-A';
  draft.samples = kind === 'kt'
    ? [{ currentA: -1, torqueNm: -8, series: '负向' }, { currentA: 0, torqueNm: .1, series: '正向' }, { currentA: 1, torqueNm: 9, series: '正向' }]
    : [{ speedRpm: 0, torqueNm: 20, series: '' }, { speedRpm: 100, torqueNm: 15, series: '' }, { speedRpm: 250, torqueNm: 8, series: '' }];
  return { project, draft, assembly };
}

test('editor lists complete joint assemblies only and starts without invented measurements', () => {
  const { project, assembly } = fixture();
  const incomplete = createAssembly('不完整搭配'); project.catalog.assemblies.push(incomplete);
  const draft = createPerformanceDraft(project, assembly.id);
  const html = renderPerformance(freeze(project), freeze(draft));
  assert.match(html, new RegExp(`value="${assembly.id}"`));
  assert.doesNotMatch(html, new RegExp(`value="${incomplete.id}"`));
  assert.match(html, /暂无测量记录/);
  assert.match(html, /填写或导入测量点后显示曲线/);
  assert.doesNotMatch(html, /<circle|<polyline|自动测试|连接设备|R²|拟合/);
  assert.match(html, /data-performance-field="measuredAt"/);
  assert.match(html, /data-performance-field="csvText"/);
  assert.match(html, /首行填写表头/);
  assert.match(html, /使用逗号分隔/);
  assert.match(html, /data-action="performance-parse"[^>]*>替换测量点<\/button>/);
  assert.doesNotMatch(html, />导入测量点<\/button>/);
});

test('numeric samples use grouped numeric controls, group text is escaped, and draft actions retain stable bindings', () => {
  const { project, draft } = fixture();
  draft.samples[0].series = '<img src=x onerror="bad">';
  draft.csvText = '</textarea><script>bad()</script>';
  const html = renderPerformance(freeze(project), freeze(draft));
  assert.equal([...html.matchAll(/data-number-input="true"[^>]+data-performance-row=/g)].length, 6);
  assert.match(html, /data-performance-key="currentA"/);
  assert.match(html, /data-performance-key="torqueNm"/);
  assert.match(html, /&lt;img src=x onerror=&quot;bad&quot;&gt;/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
  for (const action of ['new', 'add-row', 'remove-row', 'parse', 'calculate', 'save']) assert.match(html, new RegExp(`data-action="performance-${action}"`));
});

test('plots exactly the measured points, keeps series separate and uses the correct physical axes', () => {
  const { draft } = fixture();
  const kt = renderPerformanceCurve(draft);
  assert.equal([...kt.matchAll(/<circle\b/g)].length, 3);
  assert.equal([...kt.matchAll(/<polyline\b/g)].length, 1);
  assert.match(kt, /Iq 电流 · A/);
  assert.match(kt, /输出力矩 · N·m/);
  assert.match(kt, /按各组记录顺序连线/);
  assert.doesNotMatch(kt, /NaN|Infinity/);
  const tn = renderPerformanceCurve(fixture('tn_curve').draft);
  assert.equal([...tn.matchAll(/<circle\b/g)].length, 3);
  assert.match(tn, /输出转速 · rpm/);
  assert.doesNotMatch(tn, /Iq 电流/);
});

test('partial or invalid RMS draft rows do not crash rendering or turn blanks into zero samples', () => {
  const { project, draft } = fixture();
  draft.currentBasis = 'phase_rms';
  draft.samples = [{ currentA: null, torqueNm: null, series: '' }, { currentA: -1, torqueNm: 8, series: '' }, { currentA: 2, torqueNm: 12, series: '' }];
  const html = renderPerformance(project, draft);
  assert.equal([...html.matchAll(/<circle\b/g)].length, 1);
  assert.match(html, /data-number-input="true"[^>]+step="any" min="0" data-performance-row="0" data-performance-key="currentA"/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('finite extreme ranges and repeated points retain finite SVG coordinates', () => {
  const { draft } = fixture();
  for (const samples of [
    [{ currentA: -Number.MAX_VALUE, torqueNm: -Number.MAX_VALUE, series: '' }, { currentA: Number.MAX_VALUE, torqueNm: Number.MAX_VALUE, series: '' }],
    [{ currentA: 0, torqueNm: 0, series: '' }, { currentA: 0, torqueNm: 0, series: '' }],
  ]) assert.doesNotMatch(renderPerformanceCurve({ ...draft, samples }), /NaN|Infinity/);
});

test('saved record detail and shelf summary show original pairing after configuration changes', () => {
  const { project, draft, assembly } = fixture();
  const saved = savePerformanceRecord(project, draft), record = saved.performance.records[0];
  saved.catalog.drivers[0].name = '驱动器改名';
  saved.catalog.drivers[0].maxCurrentA = 25;
  const html = renderPerformance(freeze(saved), freeze(createPerformanceDraft(saved)), record.id);
  assert.match(html, /历史配置/);
  assert.match(html, /驱动器 B/);
  assert.match(html, /执行器 &lt;A&gt;/);
  assert.match(html, /release-A/);
  assert.match(html, /原始测量点 · 3/);
  assert.doesNotMatch(html, /data-action="performance-save"/);
  const shelf = renderAssemblyPerformance(saved, assembly.id);
  assert.match(shelf, new RegExp(`href="#/performance/${record.id}"`));
  assert.ok(shelf.includes(`href="#/performance?assembly=${assembly.id}"`));
  assert.match(shelf, /历史配置/);
  assert.doesNotMatch(renderAssemblyPerformance(saved, 'different-assembly'), new RegExp(record.id));
});

test('history and latest shelf record compare actual instants across ISO time zones', () => {
  const { project, draft, assembly } = fixture();
  draft.name = '较早测量';
  draft.measuredAt = '2026-11-15T16:00:00+08:00';
  const earlier = savePerformanceRecord(project, draft);
  draft.name = '较晚测量';
  draft.measuredAt = '2026-11-15T01:00:00-08:00';
  const saved = savePerformanceRecord(earlier, draft);
  const older = saved.performance.records.find(record => record.name === '较早测量');
  const newer = saved.performance.records.find(record => record.name === '较晚测量');
  const html = renderPerformance(freeze(saved), freeze(draft));
  const historyIds = [...html.matchAll(/href="#\/performance\/([^"]+)" class="performance-history-item/g)].map(match => match[1]);
  assert.deepEqual(historyIds, [newer.id, older.id]);
  const shelf = renderAssemblyPerformance(saved, assembly.id);
  assert.match(shelf, new RegExp(`href="#/performance/${newer.id}"`));
  assert.doesNotMatch(shelf, new RegExp(`href="#/performance/${older.id}"`));
});

test('new record action keeps the viewed historical assembly instead of an unrelated draft', () => {
  const { project, draft, assembly } = fixture();
  project.catalog.assemblies.push({ ...assembly, id: 'assembly-b', name: '关节模组 B' });
  const saved = savePerformanceRecord(project, draft), record = saved.performance.records[0];
  const otherDraft = createPerformanceDraft(saved, 'assembly-b');
  const history = renderPerformance(freeze(saved), freeze(otherDraft), record.id);
  assert.match(history, new RegExp(`data-action="performance-new" data-assembly="${assembly.id}"`));
  assert.doesNotMatch(history, /data-action="performance-new" data-assembly="assembly-b"/);
  const editor = renderPerformance(saved, otherDraft);
  assert.match(editor, /data-action="performance-new" data-assembly="assembly-b"/);
});
