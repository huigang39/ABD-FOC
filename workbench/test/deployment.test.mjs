import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createExampleProject, parseProject, serializeProject, validateProject } from '../web/src/core/model.mjs';
import { createMemoryPlan, createMemoryLayout, createMemoryBank, generateUniformSectors, validateMemory, MEMORY_REGIONS } from '../web/src/features/deployment/flash.mjs';
import { createDriver, createActuator, createAssembly, captureDriverHardware, applyDriver, applyAssembly, hardwareMatchesDriver, validateEquipment } from '../web/src/features/equipment/model.mjs';
import { saveLayerVersion, applyLayerVersion, layerMatchesRelease } from '../web/src/features/configuration/versions.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';

function deployment() {
  const project = createExampleProject();
  project.target = { vendor: 'st', mcu: 'STM32G474', board: 'Flash 布局验证板' };
  project.instances['hw-platform'].parameters.architecture = 'arm';
  project.memory = createMemoryPlan(project.target);
  const bank = Object.assign(createMemoryBank(), { id: 'declared-flash', name: '用户声明 Flash', baseAddress: 0x08000000, sizeKiB: 64, executable: true });
  bank.sectors = generateUniformSectors(bank, 4);
  project.memory.layout.banks.push(bank);
  Object.assign(project.instances['app-params'].parameters, { motionCalibrationKiB: 8, parametersKiB: 8, runtimeRecordsKiB: 8 });
  MEMORY_REGIONS.forEach((region, index) => {
    project.memory.placements[region.id] = { bankId: bank.id, sectorIds: bank.sectors.slice(index * 2, index * 2 + 2).map(sector => sector.id), budgetKiB: region.kind === 'firmware' ? 8 : null };
  });
  return project;
}
function captured(project = deployment()) {
  const driver = createDriver('可复用布局驱动器'); driver.maxCurrentA = 8;
  project.catalog.drivers.push(driver);
  return { project: captureDriverHardware(project, driver.id), driverId: driver.id };
}

test('旧项目缺少新布局时只补空结构，不推断物理扇区或迁移旧容量为事实', () => {
  let legacy = captured().project;
  legacy = saveLayerVersion(legacy, { layer: 'hardware', version: '旧硬件版本' });
  delete legacy.memory; delete legacy.execution;
  delete legacy.catalog.drivers[0].memoryLayout;
  delete legacy.layerVersions.releases[0].snapshot.memoryLayout;
  const loaded = parseProject(JSON.stringify(legacy));
  assert.deepEqual(loaded.memory, createMemoryPlan());
  assert.deepEqual(loaded.catalog.drivers[0].memoryLayout, createMemoryLayout());
  assert.equal(loaded.instances['hw-platform'].parameters.flashKiB, 512);
  assert.deepEqual(parseProject(serializeProject(loaded)), loaded);
  assert.doesNotThrow(() => applyLayerVersion(loaded, 'hardware'));
  for (const value of [null, [], { layout: null, placements: {} }]) {
    assert.throws(() => parseProject(JSON.stringify({ ...legacy, memory: value })), /memory/);
  }
});

test('新项目的完整布局、预算与悬空引用可以保存往返，原数据不被覆盖', () => {
  const project = deployment();
  project.memory.placements.hardware.sectorIds.push('保留的旧引用');
  const original = structuredClone(project);
  const loaded = parseProject(serializeProject(project));
  assert.deepEqual(loaded.memory, project.memory);
  assert.deepEqual(project, original);
  assert.ok(validateProject(loaded).some(issue => issue.id.includes('memory-region-hardware-sector-dangling')));
});

test('货架保存及复用物理布局，当前项目的分配和执行计划保持各自独立', () => {
  const source = deployment(), { project: saved, driverId } = captured(source);
  const driver = saved.catalog.drivers[0];
  assert.deepEqual(driver.memoryLayout, source.memory.layout);
  assert.equal(Object.hasOwn(driver, 'placements'), false);
  assert.equal(Object.hasOwn(driver, 'execution'), false);
  const target = createProject();
  target.catalog.drivers.push(structuredClone(driver));
  target.memory.placements.hardware = { bankId: '先前存储区', sectorIds: ['先前扇区'], budgetKiB: 123 };
  target.execution.assignments['app-motion'] = '保留此配置';
  const before = structuredClone(target), reused = applyDriver(target, driverId);
  assert.deepEqual(reused.memory.layout, driver.memoryLayout);
  assert.deepEqual(reused.memory.placements, before.memory.placements);
  assert.deepEqual(reused.execution, before.execution);
  assert.deepEqual(target, before);
  assert.equal(hardwareMatchesDriver(reused), true);
  assert.ok(validateMemory(reused).some(issue => issue.id === 'memory-region-hardware-bank-dangling'));
  reused.memory.layout.banks[0].name = '当前布局调整';
  assert.notEqual(driver.memoryLayout.banks[0].name, reused.memory.layout.banks[0].name);
  assert.equal(hardwareMatchesDriver(reused), false);
});

test('旧货架驱动器不携带扇区时保留项目分配并显示失效引用', () => {
  const project = deployment(), driver = createDriver('旧驱动器');
  Object.assign(driver, { vendor: 'st', mcu: 'STM32G474', board: '旧板卡' });
  delete driver.memoryLayout;
  project.catalog.drivers.push(driver);
  const originalPlacements = structuredClone(project.memory.placements);
  const applied = applyDriver(project, driver.id);
  assert.deepEqual(applied.memory.layout, createMemoryLayout());
  assert.deepEqual(applied.memory.placements, originalPlacements);
  assert.equal(validateMemory(applied).filter(issue => issue.id.endsWith('bank-dangling')).length, 6);
});

test('关节模组选型沿用驱动器物理布局，软件分区分配不随货架自动改变', () => {
  const { project, driverId } = captured();
  const actuator = createActuator('执行器');
  Object.assign(actuator.motor, { polePairs: 7, maxCurrentA: 4 });
  const assembly = Object.assign(createAssembly('关节模组'), { driverId, actuatorId: actuator.id });
  project.catalog.actuators.push(actuator); project.catalog.assemblies.push(assembly);
  const placement = structuredClone(project.memory.placements);
  const applied = applyAssembly(project, assembly.id);
  assert.deepEqual(applied.memory.layout, project.catalog.drivers[0].memoryLayout);
  assert.deepEqual(applied.memory.placements, placement);
  assert.equal(hardwareMatchesDriver(applied), true);
});

test('硬件版本保存物理布局而非部署分配，应用旧版后保留分配供复核', () => {
  let project = deployment();
  project = saveLayerVersion(project, { layer: 'hardware', version: '板级布局 A' });
  project = saveLayerVersion(project, { layer: 'app', version: '应用 A' });
  const hardware = project.layerVersions.releases.find(release => release.layer === 'hardware');
  const app = project.layerVersions.releases.find(release => release.layer === 'app');
  assert.deepEqual(hardware.snapshot.memoryLayout, project.memory.layout);
  assert.equal(Object.hasOwn(hardware.snapshot, 'placements'), false);
  assert.equal(Object.hasOwn(app.snapshot, 'memoryLayout'), false);
  project.memory.layout.banks[0].id = '新物理布局';
  project.memory.placements.hardware.bankId = '新物理布局';
  const placement = structuredClone(project.memory.placements);
  assert.equal(layerMatchesRelease(project, 'hardware'), false);
  const restored = applyLayerVersion(project, 'hardware');
  assert.deepEqual(restored.memory.layout, hardware.snapshot.memoryLayout);
  assert.deepEqual(restored.memory.placements, placement);
  assert.ok(validateMemory(restored).some(issue => issue.id === 'memory-region-hardware-bank-dangling'));
  assert.equal(layerMatchesRelease(restored, 'hardware'), true);
  restored.memory.layout.banks[0].name = '工作副本';
  assert.notEqual(restored.memory.layout.banks[0].name, hardware.snapshot.memoryLayout.banks[0].name);
});

test('老硬件版本没有物理布局时不会从当前项目借用布局', () => {
  let project = deployment();
  project = saveLayerVersion(project, { layer: 'hardware', version: '旧版' });
  delete project.layerVersions.releases[0].snapshot.memoryLayout;
  const before = structuredClone(project.memory.placements);
  const restored = applyLayerVersion(project, 'hardware');
  assert.deepEqual(restored.memory.layout, createMemoryLayout());
  assert.deepEqual(restored.memory.placements, before);
  assert.equal(validateMemory(restored).filter(issue => issue.id.endsWith('bank-dangling')).length, 6);
});

test('布局、分配及执行配置改变联调指纹，不受配置键顺序影响', () => {
  const project = deployment(), baseline = configurationFingerprint(project);
  for (const mutate of [
    next => { next.memory.layout.banks[0].sectors[0].reserved = true; },
    next => { next.memory.layout.banks[0].baseAddress += 1024; },
    next => { next.memory.placements.hardware.sectorIds.pop(); },
    next => { next.memory.placements.hardware.budgetKiB = 9; },
    next => { next.execution.assignments['app-motion'] = 'cm4'; },
  ]) {
    const changed = structuredClone(project); mutate(changed);
    assert.notEqual(configurationFingerprint(changed), baseline);
  }
  const reordered = structuredClone(project);
  reordered.memory.placements = Object.fromEntries(Object.entries(reordered.memory.placements).reverse());
  assert.equal(configurationFingerprint(reordered), baseline);
});

test('明确物理布局优先于旧的统一容量和擦除预估，驱动器复用遵循同一规则', () => {
  const source = deployment();
  Object.assign(source.instances['hw-platform'].parameters, { flashKiB: 1, eraseKiB: 128, firmwareReserveKiB: 3 });
  const projectIssues = validateProject(source);
  assert.equal(projectIssues.some(issue => issue.id === 'storage-capacity' || issue.id.startsWith('alignment-')), false);
  const { project, driverId } = captured(source);
  const legacyErrors = validateEquipment(project).filter(issue => issue.level === 'error' && (issue.id.startsWith('equipment-flash-') || issue.id.startsWith('equipment-erase-')));
  assert.deepEqual(legacyErrors, []);
  assert.doesNotThrow(() => applyDriver(project, driverId));
});

test('旧均匀规划未知或为零不会阻断已定义的物理布局', () => {
  for (const value of [null, 0]) {
    const source = deployment();
    Object.assign(source.instances['hw-platform'].parameters, { flashKiB: value, eraseKiB: value, firmwareReserveKiB: value });
    const messages = validateProject(source).filter(issue => /^(?:(?:missing|positive)-hw-platform-(?:flashKiB|eraseKiB|firmwareReserveKiB)|storage-layout-incomplete)/.test(issue.id));
    assert.deepEqual(messages, []);
    const { project, driverId } = captured(source);
    assert.doesNotThrow(() => applyDriver(project, driverId));
  }
});

test('数据区容量为零时可以不分配，项目主校验与物理分区校验保持一致', () => {
  const project = deployment();
  project.instances['app-params'].parameters.runtimeRecordsKiB = 0;
  project.memory.placements['fault-records'] = { bankId: '', sectorIds: [], budgetKiB: null };
  assert.equal(validateMemory(project).some(issue => issue.id.startsWith('memory-region-fault-records')), false);
  assert.equal(validateProject(project).some(issue => issue.id === 'positive-app-params-runtimeRecordsKiB'), false);
});

test('货架中的物理布局逻辑错误在选型前可见，不只验证 JSON 类型', () => {
  const { project, driverId } = captured();
  project.catalog.drivers[0].memoryLayout.banks[0].sectors[1].offsetKiB = 2;
  const issues = validateEquipment(project).filter(issue => issue.level === 'error' && issue.itemId === driverId);
  assert.ok(issues.some(issue => /重叠/.test(issue.title)));
  assert.throws(() => applyDriver(project, driverId));
});
