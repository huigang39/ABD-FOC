import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createExampleProject } from '../web/src/core/model.mjs';
import { MODULES } from '../web/src/core/catalog.mjs';
import { createLayerVersions, checkLayerVersionsShape, validateLayerVersions, saveLayerVersion, selectLayerVersion, applyLayerVersion, applySelectedLayerVersions, getSelectedLayerRelease, getLayerVersionState, layerMatchesRelease } from '../web/src/features/configuration/versions.mjs';

const fresh = () => ({ ...createExampleProject(), layerVersions: createLayerVersions() });
const params = (project, module) => project.instances[module].parameters;
const has = (project, id, level) => validateLayerVersions(project).some(issue => issue.id === `layer-version-${id}` && (!level || issue.level === level));
function saveAll(project = fresh()) {
  for (const layer of ['hardware', 'foc', 'app']) project = saveLayerVersion(project, { layer, version: `${layer} 自定义版本`, interfaceVersion: `${layer} 接口`, requires: Object.fromEntries(['hardware', 'foc', 'app'].filter(other => other !== layer).map(other => [other, `${other} 接口`])) });
  return project;
}

test('三个独立版本选择初始为空，调用之间没有共享状态', () => {
  const first = createLayerVersions();
  assert.deepEqual(first, { selected: { hardware: '', foc: '', app: '' }, releases: [] });
  assert.equal(checkLayerVersionsShape(first), true);
  first.selected.hardware = 'changed';
  assert.equal(createLayerVersions().selected.hardware, '');
  const project = fresh();
  assert.ok(has(project, 'unselected-hardware', 'pending'));
  assert.ok(has(project, 'runtime-unverified', 'pending'));
  assert.equal(validateLayerVersions(project).filter(issue => issue.level === 'error').length, 0);
});

test('版本号接受任意非空文本，跨层允许同名，保存纯函数生成确定性 id', () => {
  const original = fresh(), before = structuredClone(original);
  const next = saveLayerVersion(original, { layer: 'foc', version: '  原型/β 甲版  ', notes: '独立快环配置' });
  assert.deepEqual(original, before);
  assert.deepEqual(next, saveLayerVersion(original, { layer: 'foc', version: '  原型/β 甲版  ', notes: '独立快环配置' }));
  assert.equal(next.layerVersions.releases[0].version, '  原型/β 甲版  ');
  assert.equal(next.layerVersions.selected.foc, 'foc-release-1');
  assert.equal(saveLayerVersion(next, { layer: 'hardware', version: '  原型/β 甲版  ' }).layerVersions.releases.length, 2);
  assert.throws(() => saveLayerVersion(next, { layer: 'foc', version: '  原型/β 甲版  ' }), /已存在版本/);
  for (const version of ['', ' \n ', 1, null]) assert.throws(() => saveLayerVersion(original, { layer: 'app', version }), /非空文本/);
});

test('每层快照包含自己的模块开关与参数，只有硬件层捕捉 target', () => {
  let project = fresh();
  project.instances['foc-observer'].enabled = true;
  project.instances['foc-observer'].runtimeEnabled = false;
  project.target = { vendor: 'st', mcu: 'STM32 test', board: 'PCB 甲' };
  project = saveAll(project);
  for (const layer of ['hardware', 'foc', 'app']) {
    const release = getSelectedLayerRelease(project, layer);
    assert.deepEqual(Object.keys(release.snapshot.instances), MODULES.filter(module => module.layer === layer).map(module => module.id));
    assert.equal(Object.hasOwn(release.snapshot, 'target'), layer === 'hardware');
    assert.ok(Object.keys(release.snapshot.provenance).every(path => Object.keys(release.snapshot.instances).some(id => path.startsWith(`${id}.`))));
    for (const key of ['design', 'catalog', 'build', 'commissioning']) assert.equal(Object.hasOwn(release.snapshot, key), false);
  }
  assert.deepEqual(getSelectedLayerRelease(project, 'hardware').snapshot.target, project.target);
  assert.equal(getSelectedLayerRelease(project, 'foc').snapshot.instances['foc-observer'].runtimeEnabled, false);
  const detached = getSelectedLayerRelease(project, 'foc');
  detached.snapshot.instances['foc-current'].parameters.bandwidthHz = 77;
  assert.equal(getSelectedLayerRelease(project, 'foc').snapshot.instances['foc-current'].parameters.bandwidthHz, 1000);
});

test('选择组合不修改参数，应用单层仅恢复该层，完整组合可独立排列', () => {
  let project = saveAll();
  const first = { ...project.layerVersions.selected };
  params(project, 'foc-current').bandwidthHz = 1700;
  project.instances['foc-observer'].enabled = true;
  project.instances['foc-observer'].runtimeEnabled = true;
  project = saveLayerVersion(project, { layer: 'foc', version: '算法乙版' });
  const secondFoc = project.layerVersions.selected.foc;
  params(project, 'hw-board').pwmHz = 10000; project.target.board = '硬件乙板';
  project = saveLayerVersion(project, { layer: 'hardware', version: '硬件乙版' });
  const secondHardware = project.layerVersions.selected.hardware;
  params(project, 'app-motion').outerHz = 123;
  project = saveLayerVersion(project, { layer: 'app', version: '应用乙版' });
  project.design.structures[0].description = '共用接口描述保留';
  project.design.protocol.messages[0].payload = project.design.structures[0].id;
  const shared = structuredClone({ design: project.design, catalog: project.catalog, build: project.build, commissioning: project.commissioning });
  const selected = selectLayerVersion(project, 'foc', first.foc);
  assert.equal(params(selected, 'foc-current').bandwidthHz, 1700);
  assert.equal(project.layerVersions.selected.foc, secondFoc);
  assert.ok(has(selected, 'modified-foc', 'warning'));
  const applied = applyLayerVersion(selected, 'foc');
  assert.equal(params(applied, 'foc-current').bandwidthHz, 1000);
  assert.equal(applied.instances['foc-observer'].runtimeEnabled, false);
  assert.equal(params(applied, 'hw-board').pwmHz, 10000);
  assert.equal(applied.target.board, '硬件乙板');
  assert.equal(params(applied, 'app-motion').outerHz, 123);
  let combination = selectLayerVersion(applied, 'hardware', first.hardware);
  combination = selectLayerVersion(combination, 'foc', secondFoc);
  combination = applySelectedLayerVersions(combination);
  assert.equal(params(combination, 'hw-board').pwmHz, 20000);
  assert.equal(params(combination, 'foc-current').bandwidthHz, 1700);
  assert.equal(params(combination, 'app-motion').outerHz, 123);
  assert.deepEqual({ design: combination.design, catalog: combination.catalog, build: combination.build, commissioning: combination.commissioning }, shared);
  combination = applyLayerVersion(combination, 'hardware', secondHardware);
  assert.equal(combination.target.board, '硬件乙板');
  assert.equal(combination.layerVersions.selected.hardware, secondHardware);
});

test('保存与恢复后修改嵌套参数不会改变历史快照或输入项目', () => {
  const original = fresh();
  let project = saveLayerVersion(original, { layer: 'app', version: '应用 v1' });
  params(project, 'app-motion').supportedModes.push('impedance');
  assert.equal(params(original, 'app-motion').supportedModes.includes('impedance'), false);
  assert.equal(getSelectedLayerRelease(project, 'app').snapshot.instances['app-motion'].parameters.supportedModes.includes('impedance'), false);
  const beforeApply = structuredClone(project);
  const applied = applyLayerVersion(project, 'app');
  assert.deepEqual(project, beforeApply);
  params(applied, 'app-motion').supportedModes.push('torque_feedback');
  assert.equal(getSelectedLayerRelease(applied, 'app').snapshot.instances['app-motion'].parameters.supportedModes.includes('torque_feedback'), false);
});

test('单层恢复参数来源，仅重置该层来源，来源标签本身不造成配置偏离', () => {
  let project = saveLayerVersion(fresh(), { layer: 'foc', version: 'FOC v1' });
  project.provenance['foc-current.bandwidthHz'] = 'user';
  assert.equal(layerMatchesRelease(project, 'foc'), true);
  project.provenance['foc-current.decoupling'] = 'user';
  project.provenance['hw-platform.architecture'] = 'user';
  project = applyLayerVersion(project, 'foc');
  assert.equal(project.provenance['foc-current.bandwidthHz'], 'example');
  assert.equal(project.provenance['foc-current.decoupling'], undefined);
  assert.equal(project.provenance['hw-platform.architecture'], 'user');
});

test('当前版本状态同时提供选择与配置是否一致，不把旧标签当作当前配置版本', () => {
  let project = fresh();
  assert.deepEqual(getLayerVersionState(project, 'foc'), { selectedId: '', release: null, matches: false });
  project = saveLayerVersion(project, { layer: 'foc', version: '算法草案 A' });
  assert.equal(getLayerVersionState(project, 'foc').matches, true);
  params(project, 'foc-current').bandwidthHz = 3;
  const state = getLayerVersionState(project, 'foc');
  assert.equal(state.selectedId, project.layerVersions.selected.foc);
  assert.equal(state.release.version, '算法草案 A');
  assert.equal(state.matches, false);
  assert.equal(getLayerVersionState(applyLayerVersion(project, 'foc'), 'foc').matches, true);
});

test('空选择保留当前层，悬空或跨层选择报告错误且不会部分应用', () => {
  let project = saveAll();
  const hardware = project.layerVersions.selected.hardware;
  project = selectLayerVersion(project, 'hardware', '');
  project.target.board = '保留此工作副本';
  assert.equal(applySelectedLayerVersions(project).target.board, '保留此工作副本');
  assert.equal(getSelectedLayerRelease(project, 'hardware'), null);
  assert.throws(() => selectLayerVersion(project, 'foc', hardware), /不属于/);
  assert.throws(() => selectLayerVersion(project, 'hardware', 'missing'), /不存在/);
  project.layerVersions.selected.hardware = hardware;
  project.layerVersions.selected.app = 'missing';
  const before = structuredClone(project);
  assert.equal(checkLayerVersionsShape(project.layerVersions), true);
  assert.ok(has(project, 'selection-app', 'error'));
  assert.throws(() => applySelectedLayerVersions(project), /不存在/);
  assert.deepEqual(project, before);
  project.layerVersions.selected.app = hardware;
  assert.ok(has(project, 'selection-app', 'error'));
});

test('接口按显式标识精确核对，不按任何层版本号大小判断，匹配也不代表运行验证', () => {
  const project = saveAll();
  assert.ok(has(project, 'compatibility-foc-hardware', 'info'));
  assert.ok(has(project, 'runtime-unverified', 'pending'));
  const foc = project.layerVersions.releases.find(release => release.layer === 'foc');
  foc.version = '1';
  const hardware = project.layerVersions.releases.find(release => release.layer === 'hardware');
  hardware.version = '9999';
  assert.ok(has(project, 'compatibility-foc-hardware', 'info'));
  foc.requires.hardware = '硬件接口/旧';
  assert.ok(has(project, 'compatibility-foc-hardware', 'error'));
  foc.requires.hardware = '';
  assert.ok(has(project, 'compatibility-foc-hardware', 'pending'));
  foc.requires.hardware = hardware.interfaceVersion;
  hardware.interfaceVersion = '';
  assert.ok(has(project, 'compatibility-foc-hardware', 'pending'));
  for (const issue of validateLayerVersions(project)) {
    assert.ok(issue.id && issue.title && issue.message);
    assert.ok(['error', 'warning', 'pending', 'info'].includes(issue.level));
    assert.equal(issue.designPage, 'versions');
  }
  assert.equal(new Set(validateLayerVersions(project).map(issue => issue.id)).size, validateLayerVersions(project).length);
});

test('严格格式拒绝跨层快照、未知字段、重复 ID、非法参数和非文本版本', () => {
  const base = saveAll();
  const mutations = [
    value => { value.extra = true; },
    value => { delete value.selected.app; },
    value => { value.releases[0].id = value.releases[1].id; },
    value => { value.releases[0].version = ''; },
    value => { value.releases[0].layer = 'other'; },
    value => { value.releases[0].requires.hardware = 'self'; },
    value => { value.releases[0].requires.app = 1; },
    value => { value.releases[0].interfaceVersion = '   '; },
    value => { value.releases[0].snapshot.instances['foc-current'] = base.instances['foc-current']; },
    value => { value.releases[1].snapshot.target = base.target; },
    value => { delete value.releases[0].snapshot.target; },
    value => { delete value.releases[0].snapshot.instances['hw-board']; },
    value => { value.releases[0].snapshot.instances['hw-board'].runtimeEnabled = 'false'; },
    value => { value.releases[0].snapshot.instances['hw-board'].parameters.busVoltageV = Infinity; },
    value => { value.releases[0].snapshot.provenance['foc-current.bandwidthHz'] = 'user'; },
    value => { value.releases[0].snapshot.design = base.design; },
  ];
  for (const mutate of mutations) {
    const versions = structuredClone(base.layerVersions); mutate(versions);
    assert.throws(() => checkLayerVersionsShape(versions));
    assert.ok(has({ ...base, layerVersions: versions }, 'format', 'error'));
  }
  const poison = JSON.parse(JSON.stringify(base.layerVersions).replace('"selected":{', '"selected":{"__proto__":{},'));
  assert.throws(() => checkLayerVersionsShape(poison), /未知字段/);
});

test('较旧快照缺少已知参数时恢复默认值，不覆盖当前其他层', () => {
  const project = saveAll();
  const foc = project.layerVersions.releases.find(release => release.layer === 'foc');
  delete foc.snapshot.instances['foc-current'].parameters.decoupling;
  params(project, 'foc-current').decoupling = true;
  assert.doesNotThrow(() => checkLayerVersionsShape(project.layerVersions));
  const restored = applyLayerVersion(project, 'foc');
  assert.equal(params(restored, 'foc-current').decoupling, false);
  assert.equal(layerMatchesRelease(restored, 'foc'), true);
  assert.deepEqual(restored.instances['hw-board'], project.instances['hw-board']);
});

test('没有版本目录的旧项目可以直接另存首个层版本', () => {
  const project = createProject(); delete project.layerVersions;
  const next = saveLayerVersion(project, { layer: 'hardware', version: '初始硬件' });
  assert.equal(next.layerVersions.releases.length, 1);
  assert.equal(project.layerVersions, undefined);
});

test('另存选项拒绝非法元数据且不会用空默认值隐藏输入错误', () => {
  const project = fresh();
  for (const options of [{ id: null }, { interfaceVersion: null }, { notes: null }, { requires: null }, { requires: [] }, { requires: { foc: 123 } }, { requires: { hardware: 'self' } }]) {
    assert.throws(() => saveLayerVersion(project, { layer: 'hardware', version: 'v1', ...options }));
  }
});
