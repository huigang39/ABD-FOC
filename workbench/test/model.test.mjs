import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYERS, MODULES, TARGET_FIELDS, createProject, createExampleProject, getDerived, validateProject, serializeProject, parseProject } from '../web/src/core/model.mjs';

const params = (project, moduleId) => project.instances[moduleId].parameters;
const issues = (project, id) => validateProject(project).filter(issue => issue.id === id);
const has = (project, id, level) => issues(project, id).some(issue => !level || issue.level === level);
const json = value => JSON.stringify(value);

test('目录定义了三层、十八个模块、元数据及有效依赖', () => {
  assert.deepEqual(LAYERS.map(layer => layer.id), ['app', 'foc', 'hardware']);
  assert.equal(MODULES.length, 18);
  assert.equal(new Set(MODULES.map(module => module.id)).size, 18);
  assert.deepEqual(TARGET_FIELDS.map(field => field.key), ['vendor', 'mcu', 'board']);
  for (const layer of LAYERS) {
    const orders = MODULES.filter(module => module.layer === layer.id).map(module => module.order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b), `${layer.id} 层 order 非降序`);
    assert.equal(orders[0], 1, `${layer.id} 层从 1 开始`);
  }
  for (const module of MODULES) {
    assert.ok(module.role && module.inputs && module.outputs && module.boundary);
    assert.ok(module.dependencies.every(id => MODULES.some(other => other.id === id)));
    assert.equal(new Set(module.params.map(param => param.key)).size, module.params.length);
    for (const param of module.params) {
      assert.ok(['compile', 'init', 'runtime'].includes(param.phase));
      assert.ok(param.description);
    }
  }
});

test('空白草案的未知数字为 null，必需模块默认启用', () => {
  const project = createProject();
  for (const module of MODULES) {
    assert.equal(project.instances[module.id].enabled, module.required);
    for (const param of module.params.filter(param => ['number', 'integer'].includes(param.type))) assert.equal(params(project, module.id)[param.key], param.defaultValue);
  }
  assert.deepEqual(getDerived(project), { fastHz: null, fastPeriodUs: null, observerHz: null });
  assert.deepEqual(project.target, { vendor: 'unselected', mcu: '', board: '' });
  assert.ok(validateProject(project).some(issue => issue.level === 'pending'));
});

test('各项目参数数组互不共享，也不会修改模块目录默认值', () => {
  const first = createProject(); const second = createProject();
  params(first, 'app-motion').supportedModes.push('speed');
  assert.deepEqual(params(second, 'app-motion').supportedModes, []);
  assert.deepEqual(MODULES.find(module => module.id === 'app-motion').params.find(param => param.key === 'supportedModes').defaultValue, []);
});

test('必需保护模块不能在 UI 配置或 JSON 导入中绕过关闭', () => {
  for (const module of MODULES.filter(module => module.required)) {
    const project = createExampleProject(); project.instances[module.id].enabled = false;
    assert.ok(has(project, `required-${module.id}`, 'error'), module.id);
    assert.throws(() => parseProject(json(project)), /必需模块.*不能关闭/);
    assert.throws(() => serializeProject(project), /必需模块.*不能关闭/);
  }
});

test('关闭可选模块是合法草案，不会被序列化重新启用', () => {
  const project = createProject();
  const decoded = parseProject(serializeProject(project));
  for (const id of ['app-comms', 'app-calibration', 'foc-observer']) assert.equal(decoded.instances[id].enabled, false);
});

test('必需模块不能通过运行期开关绕过，缺失快环环节时不显示有效频率', () => {
  for (const module of MODULES.filter(module => !module.runtimeSwitchable)) {
    const project = createExampleProject();
    project.instances[module.id].runtimeEnabled = false;
    assert.throws(() => parseProject(json(project)), /不能关闭/);
    assert.throws(() => serializeProject(project), /不能关闭/);
  }
  for (const id of ['hw-safety', 'foc-lifecycle', 'foc-feedback', 'foc-modulation', 'foc-current']) {
    const project = createExampleProject('observer');
    project.instances[id].runtimeEnabled = false;
    assert.deepEqual(getDerived(project), { fastHz: null, fastPeriodUs: null, observerHz: null });
  }
});

test('观测器角度源必须启用对应模块', () => {
  const project = createExampleProject(); params(project, 'foc-feedback').angleSource = 'observer';
  assert.ok(has(project, 'observer-module-required', 'error'));
  project.instances['foc-observer'].enabled = true;
  assert.equal(has(project, 'observer-module-required'), false);
});

test('快环和观察器频率共同派生自 PWM 与分频', () => {
  const project = createExampleProject('sensorless');
  assert.deepEqual(getDerived(project), { fastHz: 20000, fastPeriodUs: 50, observerHz: 20000 });
  params(project, 'hw-board').currentLoopDivider = 2;
  assert.deepEqual(getDerived(project), { fastHz: 10000, fastPeriodUs: 100, observerHz: 10000 });
  project.instances['foc-observer'].enabled = false;
  assert.equal(getDerived(project).observerHz, null);
  params(project, 'hw-board').pwmHz = null;
  assert.deepEqual(getDerived(project), { fastHz: null, fastPeriodUs: null, observerHz: null });
});

test('UI 的 observer 示例别名可直接使用', () => {
  const project = createExampleProject('observer');
  assert.equal(params(project, 'foc-feedback').angleSource, 'observer');
  assert.equal(project.instances['foc-observer'].enabled, true);
  assert.equal(getDerived(project).observerHz, 20000);
});

test('零分频、非整数分频及非法频率不会产生可用派生值', () => {
  for (const invalid of [0, -1, 1.5, NaN, Infinity, null]) {
    const project = createExampleProject('sensorless'); params(project, 'hw-board').currentLoopDivider = invalid;
    assert.equal(getDerived(project).fastHz, null);
  }
  for (const invalid of [0, -20000, Infinity, NaN, null, '20000']) {
    const project = createExampleProject(); params(project, 'hw-board').pwmHz = invalid;
    assert.equal(getDerived(project).fastHz, null);
  }
  const tiny = createExampleProject(); params(tiny, 'hw-board').pwmHz = Number.MIN_VALUE;
  assert.deepEqual(getDerived(tiny), { fastHz: null, fastPeriodUs: null, observerHz: null });
});

test('外环不得达到或超过快环频率，非整数分频需要额外定义', () => {
  const project = createExampleProject();
  params(project, 'app-motion').outerHz = 20000;
  assert.ok(has(project, 'outer-rate', 'error'));
  params(project, 'app-motion').outerHz = 21000;
  assert.ok(has(project, 'outer-rate', 'error'));
  params(project, 'app-motion').outerHz = 3000;
  assert.ok(has(project, 'outer-noninteger-ratio', 'warning'));
  params(project, 'app-motion').outerHz = 1000;
  assert.equal(has(project, 'outer-rate'), false);
  assert.equal(has(project, 'outer-noninteger-ratio'), false);
});

test('给定有效期不能短于正常更新周期', () => {
  const project = createExampleProject(); params(project, 'foc-lifecycle').referenceTimeoutMs = 0.5;
  assert.ok(has(project, 'reference-timeout', 'error'));
});

test('多个模式可同时支持，但当前模式须在支持列表中', () => {
  const project = createExampleProject();
  params(project, 'app-motion').supportedModes = ['current', 'speed', 'position', 'impedance'];
  assert.equal(has(project, 'active-mode-support'), false);
  params(project, 'app-motion').activeMode = 'torque_feedback';
  assert.ok(has(project, 'active-mode-support', 'error'));
});

test('通信来源与校准模式检查各自可选模块的条件依赖', () => {
  const project = createExampleProject();
  project.instances['app-comms'].enabled = false;
  assert.ok(has(project, 'communication-module-required', 'error'));
  params(project, 'app-motion').commandSource = 'local';
  assert.equal(has(project, 'communication-module-required'), false);
  params(project, 'app-motion').supportedModes.push('calibration');
  project.instances['app-calibration'].enabled = false;
  assert.ok(has(project, 'calibration-module-required', 'error'));
});

test('传感器明确不具备时为冲突，未知时保留待确认', () => {
  const project = createExampleProject();
  params(project, 'hw-drivers').encoderCapability = 'absent';
  assert.ok(has(project, 'capability-encoderCapability-foc-feedback', 'error'));
  params(project, 'hw-drivers').encoderCapability = 'unconfirmed';
  assert.ok(has(project, 'capability-encoderCapability-foc-feedback', 'pending'));
  params(project, 'app-motion').supportedModes.push('torque_feedback');
  assert.ok(has(project, 'capability-torqueCapability-app-motion', 'error'));
});

test('校准不会伪造校准结果，激励不允许超过正常限值', () => {
  const project = createExampleProject();
  assert.ok(has(project, 'calibration-results', 'pending'));
  params(project, 'app-calibration').maxCurrentA = 6;
  assert.ok(has(project, 'calibration-limit', 'error'));
  params(project, 'app-calibration').maxCurrentA = null;
  assert.ok(has(project, 'calibration-current', 'pending'));
});

test('控制限值、占空比和复位门控检查', () => {
  const project = createExampleProject();
  params(project, 'app-motion').currentLimitA = 9;
  params(project, 'foc-modulation').dutyMin = 0.99;
  params(project, 'hw-safety').resetOutputDisabled = false;
  assert.ok(has(project, 'current-limit', 'error'));
  assert.ok(has(project, 'duty-range', 'error'));
  assert.ok(has(project, 'reset-output', 'error'));
});

test('有限数字、数字类型和安全整数在导入及导出时验证', () => {
  for (const bad of [NaN, Infinity, -Infinity, '20000', {}]) {
    const project = createExampleProject(); params(project, 'hw-board').pwmHz = bad;
    assert.ok(has(project, 'project-format', 'error'));
    assert.throws(() => serializeProject(project), /有限数字/);
  }
  const project = createExampleProject(); params(project, 'hw-board').currentLoopDivider = 1.5;
  assert.throws(() => parseProject(json(project)), /安全整数/);
  assert.throws(() => parseProject(serializeProject(createExampleProject()).replace('20000,', '1e999,')), /有限数字/);
});

test('Flash 总量包含全部数据区和代码升级预留', () => {
  const project = createExampleProject();
  params(project, 'hw-platform').flashKiB = 292;
  assert.ok(has(project, 'storage-capacity', 'error'));
  params(project, 'hw-platform').flashKiB = 296;
  assert.equal(has(project, 'storage-capacity'), false);
});

test('三个数据区及代码预留均检查擦除粒度对齐', () => {
  for (const key of ['motionCalibrationKiB', 'parametersKiB', 'runtimeRecordsKiB']) {
    const project = createExampleProject(); params(project, 'app-params')[key] = 6;
    assert.ok(has(project, `alignment-${key}`, 'error'), key);
  }
  const project = createExampleProject(); params(project, 'hw-platform').firmwareReserveKiB = 257;
  assert.ok(has(project, 'alignment-firmwareReserveKiB', 'error'));
});

test('未知存储大小不能作为零参与容量通过判断', () => {
  const project = createExampleProject(); params(project, 'app-params').motionCalibrationKiB = null;
  assert.ok(has(project, 'storage-layout-incomplete', 'pending'));
  assert.equal(has(project, 'storage-capacity'), false);
});

test('允许小于 1 KiB 的擦除粒度和对齐分区', () => {
  const project = createExampleProject();
  params(project, 'hw-platform').eraseKiB = 0.25;
  params(project, 'app-params').parametersKiB = 0.75;
  assert.equal(has(project, 'alignment-parametersKiB'), false);
});

test('空白、示例以及有逻辑冲突的合法草案均可 JSON 往返', () => {
  for (const project of [createProject(), createExampleProject(), createExampleProject('sensorless')]) {
    params(project, 'app-motion').outerHz = 999999;
    assert.deepEqual(parseProject(serializeProject(project)), project);
    assert.equal(serializeProject(project), serializeProject(parseProject(serializeProject(project))));
  }
});

test('缺少的已知参数以未知默认值归一化，未知参数拒绝', () => {
  const project = createProject(); delete params(project, 'hw-board').pwmHz;
  assert.equal(params(parseProject(json(project)), 'hw-board').pwmHz, null);
  params(project, 'hw-board').surprise = 12;
  assert.throws(() => parseProject(json(project)), /未知字段.*surprise/);
});

test('错误 JSON、格式版本、未知模块和缺失实例拒绝导入', () => {
  assert.throws(() => parseProject('{oops'), /JSON 解析失败/);
  const version = createProject(); version.schemaVersion = 3;
  assert.throws(() => parseProject(json(version)), /schemaVersion/);
  const unknown = createProject(); unknown.instances['unknown-module'] = { enabled: true, parameters: {} };
  assert.throws(() => parseProject(json(unknown)), /未知字段.*unknown-module/);
  const missing = createProject(); delete missing.instances['hw-safety'];
  assert.throws(() => parseProject(json(missing)), /缺少必需结构/);
});

test('版本 1 自动迁移且保留已有项目资料、参数和来源', () => {
  const old = createExampleProject('observer');
  old.schemaVersion = 1;
  for (const key of ['design', 'commissioning', 'catalog', 'build', 'layerVersions', 'operation', 'memory', 'execution', 'compatibility']) delete old[key];
  for (const instance of Object.values(old.instances)) delete instance.runtimeEnabled;
  const migrated = parseProject(json(old));
  assert.equal(migrated.schemaVersion, 2);
  for (const key of ['id', 'name', 'revision', 'updatedAt', 'target', 'provenance']) assert.deepEqual(migrated[key], old[key]);
  for (const [id, instance] of Object.entries(old.instances)) {
    assert.deepEqual(migrated.instances[id].parameters, instance.parameters);
    assert.equal(migrated.instances[id].enabled, instance.enabled);
    assert.equal(migrated.instances[id].runtimeEnabled, instance.enabled);
  }
  assert.equal(migrated.design.structures.length, createProject().design.structures.length);
  assert.deepEqual(migrated.commissioning, { checks: {} });
  assert.deepEqual(migrated.build, { compiler: 'unselected', version: '', optimization: 'unselected', lto: false, encryptFirmware: false, moduleOptimizations: {} });
  assert.ok(migrated.catalog);
  assert.deepEqual(parseProject(serializeProject(old)), migrated);
});

test('编译包含与运行开关独立，关编译开运行作为可保存逻辑冲突报告', () => {
  const project = createProject();
  project.instances['foc-observer'].runtimeEnabled = true;
  assert.ok(has(project, 'runtime-without-build-foc-observer', 'error'));
  assert.deepEqual(parseProject(serializeProject(project)), project);
  assert.equal(MODULES.filter(m => m.runtimeSwitchable).length, 5);
  for (const module of MODULES) assert.equal(module.runtimeSwitchable, !module.required);
});

test('核心运行关闭报告错误，运行依赖观察器、通信和当前校准模式', () => {
  const observer = createExampleProject('observer');
  observer.instances['foc-observer'].runtimeEnabled = false;
  assert.ok(has(observer, 'observer-runtime-required', 'error'));
  assert.equal(getDerived(observer).observerHz, null);
  assert.equal(getDerived(observer).fastHz, 20000);
  observer.instances['foc-current'].runtimeEnabled = false;
  assert.ok(has(observer, 'required-runtime-foc-current', 'error'));
  assert.equal(getDerived(observer).fastHz, null);
  const comms = createExampleProject(); comms.instances['app-comms'].runtimeEnabled = false;
  assert.ok(has(comms, 'communication-runtime-required', 'error'));
  const calibration = createExampleProject();
  params(calibration, 'app-motion').supportedModes.push('calibration'); params(calibration, 'app-motion').activeMode = 'calibration';
  calibration.instances['app-calibration'].runtimeEnabled = false;
  assert.ok(has(calibration, 'calibration-runtime-disabled', 'error'));
});

test('版本 2 要求新字段且拒绝非法构建与运行类型', () => {
  const missing = createProject(); delete missing.design;
  assert.throws(() => parseProject(json(missing)), /design/);
  const runtime = createProject(); runtime.instances['foc-observer'].runtimeEnabled = 'false';
  assert.throws(() => parseProject(json(runtime)), /runtimeEnabled.*布尔值/);
  const build = createProject(); build.build.optimization = 'fastest';
  assert.throws(() => parseProject(json(build)), /optimization/);
  build.build.optimization = 'O3'; build.build.lto = true;
  assert.ok(has(build, 'build-verification', 'pending'));
  assert.equal(parseProject(serializeProject(build)).build.lto, true);
});

test('非法参数选项、多选重复及布尔类型拒绝导入', () => {
  const selection = createProject(); params(selection, 'foc-feedback').angleSource = 'magic';
  assert.throws(() => parseProject(json(selection)), /不是允许的选项/);
  const duplicate = createProject(); params(duplicate, 'app-motion').supportedModes = ['speed', 'speed'];
  assert.throws(() => parseProject(json(duplicate)), /不重复的合法选项数组/);
  const boolean = createProject(); params(boolean, 'hw-safety').resetOutputDisabled = 'false';
  assert.throws(() => parseProject(json(boolean)), /布尔值/);
});

test('额外属性与原型污染键不会被合并进项目', () => {
  const project = createProject();
  const imported = json(project).replace('"parameters":{', '"parameters":{"__proto__":{"polluted":true},');
  assert.throws(() => parseProject(imported), /未知字段/);
  assert.equal({}.polluted, undefined);
  project.provenance['unknown.key'] = 'user';
  assert.throws(() => parseProject(json(project)), /未知参数路径/);
});

test('示例及完整填写配置始终保留硬件和实时预算待确认', () => {
  for (const kind of ['encoder', 'sensorless', 'hall']) {
    const project = createExampleProject(kind);
    project.target = { vendor: 'other', mcu: '测试型号', board: '测试板 v1' };
    params(project, 'hw-safety').hardwareTripCapability = 'present';
    assert.ok(has(project, 'hardware-verification', 'pending'));
    assert.ok(has(project, 'realtime-budget', 'pending'));
    assert.ok(has(project, 'example-values', 'info'));
    assert.equal(validateProject(project).filter(issue => issue.level === 'error').length, 0);
    assert.ok(project.name.endsWith('控制方案'));
  }
  assert.throws(() => createExampleProject('unknown'), /未知预置方案/);
});

test('每条 issue 有稳定 ID、合法级别和清楚说明', () => {
  for (const project of [createProject(), createExampleProject('sensorless')]) {
    const report = validateProject(project);
    assert.equal(new Set(report.map(issue => issue.id)).size, report.length);
    for (const issue of report) {
      assert.ok(['error', 'warning', 'pending', 'info'].includes(issue.level));
      assert.ok(issue.id && issue.title && issue.message);
      if (issue.moduleId) assert.ok(MODULES.some(module => module.id === issue.moduleId));
    }
  }
});
