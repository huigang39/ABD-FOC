import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { createActuator, createDriver, createJointModule } from '../web/src/features/equipment/model.mjs';
import { saveLayerVersion } from '../web/src/features/configuration/versions.mjs';
import { PERFORMANCE_LIMITS, createPerformance, createPerformanceDraft, createPerformanceRecord, checkPerformanceRecordShape, checkPerformanceShape, savePerformanceRecord, removePerformanceRecord, getAssemblyTests, summarizePerformance, parsePerformanceCsv, serializePerformanceCsv } from '../web/src/features/performance/model.mjs';

function fixture(kind = 'kt') {
  let project = createProject();
  project.catalog.actuators.push(createActuator('NEO_75_H_GW_KW'));
  project.catalog.drivers.push(createDriver('驱动器 A'));
  const assembly = createJointModule(project, { actuatorId: project.catalog.actuators[0].id, driverId: project.catalog.drivers[0].id });
  project.catalog.assemblies.push(assembly); project.catalog.activeAssemblyId = assembly.id;
  project = saveLayerVersion(project, { layer: 'foc', version: 'control-2026.rc1' });
  project.performance = createPerformance();
  const draft = createPerformanceDraft(project, assembly.id, kind);
  draft.measuredAt = '2026-11-15T14:30:00+08:00'; draft.firmwareId = 'neo75-1215-sha256:abcd';
  draft.conditions = { ...draft.conditions, busVoltageV: 48, ambientTemperatureC: 25, windingTemperatureC: 55, durationS: 10, notes: '转矩台实测' };
  draft.samples = kind === 'kt'
    ? [{ currentA: -2, torqueNm: -17, series: '负向' }, { currentA: 0, torqueNm: 0.3, series: '正向' }, { currentA: 1, torqueNm: 9, series: '正向' }, { currentA: 2, torqueNm: 15, series: '正向' }]
    : [{ speedRpm: 0, torqueNm: 10, series: '正向' }, { speedRpm: 100, torqueNm: 9, series: '正向' }, { speedRpm: 80, torqueNm: 9.5, series: '正向' }, { speedRpm: -100, torqueNm: -8, series: '反向' }];
  return { project, draft, assembly };
}

test('performance drafts have no invented samples, dates, ratings or fit results', () => {
  const { project, assembly } = fixture();
  const before = structuredClone(project);
  const draft = createPerformanceDraft(project, assembly.id);
  assert.equal(draft.measurementSide, 'output'); assert.equal(draft.currentBasis, 'iq');
  assert.equal(draft.measuredAt, ''); assert.equal(draft.firmwareId, '');
  assert.deepEqual(draft.samples, []); assert.equal(draft.conditions.busVoltageV, null);
  assert.deepEqual(summarizePerformance(draft), { sampleCount: 0, seriesCount: 0, xField: 'currentA', xRange: null, torqueRange: null, peakTorqueNm: null, series: [] });
  assert.deepEqual(project, before);
  assert.throws(() => createPerformanceDraft(project, assembly.id, 'rated_torque'), /测试类型/);
});

test('saving captures detached components, layer versions, configuration and build settings', () => {
  const { project, draft } = fixture(), before = structuredClone(project);
  const saved = savePerformanceRecord(project, draft), record = saved.performance.records[0];
  assert.equal(checkPerformanceShape(saved.performance), true);
  assert.deepEqual(project, before);
  assert.equal(record.snapshot.layers.foc.version, 'control-2026.rc1');
  assert.equal(record.snapshot.layers.foc.configuration['foc-current'].enabled, true);
  assert.deepEqual(record.snapshot.build, project.build);
  assert.equal(record.snapshot.actuator.name, 'NEO_75_H_GW_KW');
  assert.equal(record.firmwareId, draft.firmwareId);
  project.catalog.actuators[0].motor.polePairs = 11;
  draft.samples[0].torqueNm = 999;
  project.layerVersions.releases[0].version = 'changed';
  assert.equal(record.snapshot.actuator.motor.polePairs, null);
  assert.equal(record.samples[0].torqueNm, -17);
  assert.equal(record.snapshot.layers.foc.version, 'control-2026.rc1');
});

test('records are append-only and caller views cannot mutate stored history', () => {
  const { project, draft, assembly } = fixture();
  const saved = savePerformanceRecord(savePerformanceRecord(project, draft), { ...draft, name: '复测' });
  assert.equal(saved.performance.records.length, 2);
  assert.notEqual(saved.performance.records[0].id, saved.performance.records[1].id);
  const records = getAssemblyTests(saved, assembly.id);
  records[0].snapshot.driver.name = '修改'; records[0].samples[0].torqueNm = 99; records[0].summary.series[0].samples[0].torqueNm = 100;
  assert.equal(saved.performance.records[0].snapshot.driver.name, '驱动器 A');
  assert.equal(saved.performance.records[0].samples[0].torqueNm, -17);
  const removed = removePerformanceRecord(saved, saved.performance.records[0].id);
  assert.equal(removed.performance.records.length, 1); assert.equal(saved.performance.records.length, 2);
  assert.throws(() => removePerformanceRecord(saved, 'absent'), /不存在/);
});

test('a test requires a complete known joint assembly, not just one catalog component', () => {
  for (const mutate of [
    (project, draft) => { draft.assemblyId = 'missing'; },
    project => { project.catalog.assemblies[0].driverId = ''; },
    project => { project.catalog.actuators = []; },
    project => { project.catalog.drivers = []; },
  ]) {
    const { project, draft } = fixture(); mutate(project, draft);
    assert.throws(() => savePerformanceRecord(project, draft), /关节模组/);
  }
});

test('historical records survive component removal and remain linked to the original assembly', () => {
  const { project, draft, assembly } = fixture(), saved = savePerformanceRecord(project, draft);
  assert.equal(getAssemblyTests(saved, assembly.id)[0].historical, false);
  saved.catalog.drivers = [];
  assert.equal(checkPerformanceShape(saved.performance), true);
  assert.equal(getAssemblyTests(saved, assembly.id)[0].historical, true);
  assert.match(getAssemblyTests(saved, assembly.id)[0].historyReason, /移除/);
  assert.deepEqual(getAssemblyTests(saved, 'other'), []);
});

test('changed pair, component parameters, module configuration and build flags mark historical data', () => {
  const { project, draft, assembly } = fixture(), original = savePerformanceRecord(project, draft);
  for (const mutate of [
    saved => { const second = createDriver('B'); saved.catalog.drivers.push(second); saved.catalog.assemblies[0].driverId = second.id; },
    saved => { saved.catalog.actuators[0].reducer.ratio = 80; },
    saved => { saved.catalog.drivers[0].maxCurrentA = 12; },
    saved => { saved.instances['foc-current'].parameters.bandwidthHz = 500; },
    saved => { saved.layerVersions.releases[0].version = 'beta-string'; },
    saved => { saved.build.optimization = 'O3'; },
  ]) {
    const saved = structuredClone(original); mutate(saved);
    assert.equal(getAssemblyTests(saved, assembly.id)[0].historical, true);
    assert.deepEqual(saved.performance.records[0], original.performance.records[0]);
  }
  const renamed = structuredClone(original);
  renamed.catalog.assemblies[0].name = 'renamed'; renamed.catalog.actuators[0].name = 'renamed';
  assert.equal(getAssemblyTests(renamed, assembly.id)[0].historical, false);
});

test('Kt preserves nonlinear measured points, signs, groups and recording order', () => {
  const { draft } = fixture(), summary = summarizePerformance(draft);
  assert.deepEqual(summary.xRange, { min: -2, max: 2 });
  assert.deepEqual(summary.torqueRange, { min: -17, max: 15 });
  assert.equal(summary.sampleCount, 4); assert.equal(summary.peakTorqueNm, 17); assert.equal(summary.seriesCount, 2);
  assert.deepEqual(summary.series[1].samples.map(sample => sample.torqueNm), [0.3, 9, 15]);
  assert.equal(Object.hasOwn(summary, 'kt'), false); assert.equal(Object.hasOwn(summary, 'rSquared'), false);
});

test('TN records measured curve points without sorting or inferring a continuous torque rating', () => {
  const { project, draft } = fixture('tn_curve'), saved = savePerformanceRecord(project, draft), summary = summarizePerformance(saved.performance.records[0]);
  assert.deepEqual(summary.xRange, { min: -100, max: 100 });
  assert.deepEqual(summary.series[0].samples.map(sample => sample.speedRpm), [0, 100, 80]);
  assert.equal(summary.peakTorqueNm, 10); assert.equal(Object.hasOwn(summary, 'ratedTorqueNm'), false);
  assert.deepEqual(saved.performance.records[0].samples, draft.samples);
});

test('invalid numeric samples, empty measurements and inappropriate current definitions are rejected', () => {
  for (const mutate of [
    draft => { draft.samples = []; },
    draft => { draft.samples[0].currentA = NaN; },
    draft => { draft.samples[0].torqueNm = Infinity; },
    draft => { draft.samples[0].currentA = '2'; },
    draft => { draft.samples[0].currentA = null; },
    draft => { draft.samples[0].busCurrentA = 2; },
    draft => { draft.currentBasis = 'dc_bus'; },
    draft => { draft.currentBasis = 'phase_rms'; },
    draft => { draft.measuredAt = ''; },
    draft => { draft.measuredAt = 'not-a-date'; },
    draft => { draft.measuredAt = '2026-02-31'; },
    draft => { draft.samples[0].series = 'group\nline'; },
    draft => { draft.conditions.busVoltageV = -48; },
    draft => { draft.conditions.durationS = 0; },
    draft => { draft.conditions.windingTemperatureC = -300; },
  ]) {
    const { project, draft } = fixture(); mutate(draft);
    assert.throws(() => savePerformanceRecord(project, draft));
  }
  const { project, draft } = fixture(); draft.currentBasis = 'phase_rms'; draft.samples = [{ currentA: 2, torqueNm: -15, series: '反向' }];
  assert.equal(savePerformanceRecord(project, draft).performance.records[0].currentBasis, 'phase_rms');
});

test('shape checks reject unknown or malicious imported fields and mismatched snapshots', () => {
  const { project, draft } = fixture(), record = createPerformanceRecord(project, draft);
  for (const mutate of [
    r => { r.ratedTorqueNm = 100; },
    r => { r.snapshot.actuatorId = 'fake'; },
    r => { r.snapshot.assembly.driverId = 'fake'; },
    r => { r.snapshot.layers.foc.configuration['foc-current'].parameters.constructor = {}; },
    r => { r.samples[0].result = '<script>bad()</script>'; },
    r => { r.snapshot.build.command = 'rm -rf'; },
    r => { r.snapshot.driver.hardware['hw-drivers'].fake = true; },
  ]) {
    const changed = structuredClone(record); mutate(changed);
    assert.throws(() => checkPerformanceRecordShape(changed));
  }
  const malicious = JSON.parse(JSON.stringify(record).replace('"name":', '"__proto__":{"polluted":true},"name":'));
  assert.throws(() => checkPerformanceRecordShape(malicious), /不允许|未知/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => checkPerformanceShape({ records: [record, record] }), /重复/);
  assert.throws(() => checkPerformanceShape({ records: [], generator: true }), /未知/);
});

test('sample, record, text and total history limits bound imported data', () => {
  const { project, draft } = fixture();
  assert.throws(() => savePerformanceRecord(project, { ...draft, samples: Array.from({ length: PERFORMANCE_LIMITS.samplesPerRecord + 1 }, () => draft.samples[0]) }), /样本/);
  const record = createPerformanceRecord(project, draft);
  assert.throws(() => checkPerformanceShape({ records: Array.from({ length: PERFORMANCE_LIMITS.records + 1 }, (_, i) => ({ ...record, id: `${i}` })) }), /最多/);
  assert.throws(() => checkPerformanceShape({ records: Array.from({ length: 11 }, (_, i) => ({ ...record, id: `${i}`, samples: Array.from({ length: 2000 }, () => draft.samples[0]) })) }), /样本总数/);
  assert.throws(() => parsePerformanceCsv(' '.repeat(PERFORMANCE_LIMITS.csvCharacters + 1), 'kt'), /最多/);
});

test('CSV reads exact decimal values and groups and round-trips a measured table', () => {
  assert.deepEqual(parsePerformanceCsv('\uFEFF电流(A),力矩(Nm),分组\r\n-2,-17,负向\r\n0,0.3,"正向,回程"\r\n1e0,9,"组""二"\r\n', 'kt'), [
    { currentA: -2, torqueNm: -17, series: '负向' }, { currentA: 0, torqueNm: 0.3, series: '正向,回程' }, { currentA: 1, torqueNm: 9, series: '组"二' },
  ]);
  const { draft } = fixture('tn_curve');
  assert.deepEqual(parsePerformanceCsv(serializePerformanceCsv(draft), draft.kind), draft.samples);
  assert.deepEqual(parsePerformanceCsv('torqueNm,currentA\n-3,-1', 'kt'), [{ currentA: -1, torqueNm: -3, series: '' }]);
});

test('CSV rejects missing/unknown headers, bus current, blank cells and malformed rows', () => {
  for (const input of [
    '1,2\n2,3', 'currentA,torqueNm', 'busCurrentA,torqueNm\n1,2', 'speedRpm,torqueNm\n1,2',
    'currentA,torqueNm,currentA\n1,2,3', 'currentA,torqueNm,__proto__\n1,2,bad',
    'currentA,torqueNm\n,2', 'currentA,torqueNm\n0x10,2', 'currentA,torqueNm\n1,Infinity',
    'currentA,torqueNm\n1,2,3', 'currentA,torqueNm,series\n1,2,"unclosed',
    'currentA,torqueNm,series\n1,2,"name"bad',
  ]) assert.throws(() => parsePerformanceCsv(input, 'kt'));
});

test('saved Kt and TN tables retain their measured values, series and curve order across project export/import', () => {
  for (const kind of ['kt', 'tn_curve']) {
    const { project, draft, assembly } = fixture(kind), saved = savePerformanceRecord(project, draft);
    const loaded = parseProject(serializeProject(saved));
    assert.deepEqual(loaded.performance, saved.performance);
    assert.deepEqual(getAssemblyTests(loaded, assembly.id)[0].summary, summarizePerformance(draft));
    assert.deepEqual(loaded.performance.records[0].samples, draft.samples);
  }
});

test('adding and removing measured performance records does not invalidate a firmware build fingerprint', () => {
  const { project, draft } = fixture(), fingerprint = configurationFingerprint(project);
  const saved = savePerformanceRecord(project, draft);
  assert.equal(configurationFingerprint(saved), fingerprint);
  saved.performance.records[0].samples[0].torqueNm = -18.5;
  assert.equal(configurationFingerprint(saved), fingerprint);
  assert.equal(configurationFingerprint(parseProject(serializeProject(saved))), fingerprint);
  const removed = removePerformanceRecord(saved, saved.performance.records[0].id);
  assert.equal(configurationFingerprint(removed), fingerprint);
});

test('removed shelf combinations leave exportable and loadable historical measurements with immutable snapshots', () => {
  const { project, draft, assembly } = fixture(), saved = savePerformanceRecord(project, draft);
  const snapshot = structuredClone(saved.performance.records[0].snapshot);
  saved.catalog.assemblies = []; saved.catalog.actuators = []; saved.catalog.drivers = [];
  saved.catalog.activeAssemblyId = ''; saved.catalog.activeDriverId = '';
  const loaded = parseProject(serializeProject(saved)), records = getAssemblyTests(loaded, assembly.id);
  assert.equal(records.length, 1); assert.equal(records[0].historical, true);
  assert.deepEqual(records[0].snapshot, snapshot);
  assert.deepEqual(records[0].samples, draft.samples);
});
