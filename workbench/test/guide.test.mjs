import { createCoreConfigs } from '../web/src/modules/hardware/hw-platform/cores.mjs';
import { createTripPath } from '../web/src/modules/hardware/hw-safety/paths.mjs';
import { createResource } from '../web/src/modules/hardware/hw-board/resources.mjs';
import { createLayerInterface } from '../web/src/core/module-contracts.mjs';
import { neo75hProtocols } from '../web/src/profiles/neo75h-protocols.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createExampleProject, validateProject } from '../web/src/core/model.mjs';
import { createActuator, createAssembly, createDriver, validateEquipment } from '../web/src/features/equipment/model.mjs';
import { GUIDE_STEPS, getGuide } from '../web/src/features/configuration/guide.mjs';
import { beginCustomHardware } from '../web/src/features/configuration/workspace.mjs';

function configuredProject() {
  const project = createExampleProject();
  const actuator = createActuator('已选执行器');
  project.catalog.actuators.push(actuator);
  project.catalog.activeActuatorId = actuator.id;
  project.target = { vendor: 'st', mcu: 'STM32H745IIK6', board: 'PCB-A' };
  const coreConfigs=createCoreConfigs(project.target.mcu);
  Object.assign(coreConfigs.cm7,{clockHz:400000000,systemTickHz:1000,controlIrqPriority:'realtime',floatAbi:'hard',instructionCache:'enabled',dataCache:'enabled'});
  Object.assign(coreConfigs.cm4,{clockHz:200000000,systemTickHz:1000,communicationIrqPriority:'high',floatAbi:'hard'});
  Object.assign(project.instances['hw-platform'].parameters,{architecture:'arm',clockSource:'external',oscillatorHz:25000000,busClockHz:200000000,timerClockHz:200000000,coreConfigs});
  Object.assign(project.instances['hw-drivers'].parameters,neo75hProtocols('KW'));
  project.instances['hw-safety'].parameters.hardwareTripCapability = 'present';
  Object.assign(project.instances['hw-drivers'].parameters, { motorEncoderInterface: 'spi', motorEncoderResource: 'SPI2', motorEncoderBitrate: 1000000, motorEncoderTiming: 'fast', motorEncoderTimeoutUs: 100 });
  project.instances['hw-board'].parameters.resources=[
    {...createResource('spi','SPI2'),instance:'SPI2',pins:{SCK:'PB13',MISO:'PB14',MOSI:'PB15',NSS:'PB12'},settings:{clockHz:1000000,mode:'0',wordBits:8}},
    {...createResource('pwm','PWM'),instance:'HRTIM1',pins:{A1:'PC6',A2:'PC7',B1:'PC8',B2:'PA8',C1:'PA9',C2:'PA10'},settings:{alignment:'center',polarity:'high'}},
    {...createResource('gpio','FAULT'),instance:'GPIO',pins:{IO:'PD1'},settings:{direction:'input',pull:'up',initialLevel:'low'}},
  ];
  project.instances['hw-safety'].parameters.tripPaths=[{...createTripPath('fault'),inputResource:'FAULT',pwmResource:'PWM'}];
  Object.assign(project.design.protocol, { transport: 'canfd', integrity: 'transport_crc', nodeId: 1, bitrate: 1000000, timeoutMs: 100 });
  project.instances['app-comms'].parameters.bus = 'canfd';
  return project;
}
test('workflow combines build checks and flashing after four configuration steps', () => {
  assert.deepEqual(GUIDE_STEPS.map(step => step.id), ['actuator', 'hardware', 'algorithm', 'application', 'build']);
  assert.deepEqual(GUIDE_STEPS.map(step => step.title), ['选型', '硬件', '算法', '应用', '构建']);
  const guide = getGuide(createProject());
  assert.equal(guide.totalSteps, 5);
  assert.equal(guide.nextStepId, 'actuator');
  assert.equal(guide.configuredCount, 0);
  assert.equal(Object.hasOwn(guide, 'checks'), false);
  assert.equal(guide.steps.some(step => step.state === 'verified'), false);
  assert.equal(guide.summary, '已完成 0/5 个步骤。');
});

test('algorithm exception configuration is omitted while its issues remain in global build checks', () => {
  const project=createProject(),before=structuredClone(project);
  const issue={id:'lifecycle-check',moduleId:'foc-lifecycle',level:'error',message:'保护配置无效'};
  const guide=getGuide(project,[issue]),algorithm=guide.steps.find(step=>step.id==='algorithm');
  assert.deepEqual(algorithm.modules,['foc-current','foc-modulation','foc-observer','foc-filter','foc-compensation']);
  assert.ok(!algorithm.children.some(child=>child.id==='foc-lifecycle'));
  assert.doesNotMatch(algorithm.summary,/异常/);
  assert.ok(guide.steps.find(step=>step.id==='build').issues.includes(issue));
  assert.deepEqual(project,before);
});

test('field progress ends at dependency checks after the four configuration steps', () => {
  const project = configuredProject();
  const guide = getGuide(project);
  assert.equal(guide.configuredCount, 4);
  assert.equal(guide.nextStepId, 'build');
  assert.ok(guide.steps.slice(0, 4).every(step => step.state === 'configured' && step.completed === step.total));
  assert.equal(guide.summary, '已完成 4/5 个步骤。');
  const originalPwm = project.instances['hw-board'].parameters.pwmHz;
  project.instances['hw-board'].parameters.pwmHz = null;
  assert.equal(getGuide(project).nextStepId, 'hardware');
  project.instances['hw-board'].parameters.pwmHz = originalPwm;
  const originalBandwidth = project.instances['foc-current'].parameters.bandwidthHz;
  project.instances['foc-current'].parameters.bandwidthHz = null;
  assert.equal(getGuide(project).nextStepId, 'algorithm');
  project.instances['foc-current'].parameters.bandwidthHz = originalBandwidth;
  project.design.faults = [];
  assert.equal(getGuide(project).nextStepId, 'application');
});

test('real configuration errors and pending parameters stay in their owning steps', () => {
  const project = configuredProject();
  project.instances['foc-modulation'].parameters.dutyMin = 0.8;
  project.instances['foc-modulation'].parameters.dutyMax = 0.2;
  project.design.protocol.nodeId = null;
  const issues = validateProject(project);
  assert.ok(issues.some(issue => issue.id === 'duty-range' && issue.level === 'error'));
  assert.ok(issues.some(issue => issue.id === 'design-protocol-nodeId' && issue.level === 'pending'));
  const guide = getGuide(project, issues);
  const byId = Object.fromEntries(guide.steps.map(step => [step.id, step]));
  assert.equal(byId.algorithm.state, 'blocked');
  assert.equal(byId.application.state, 'todo');
  assert.ok(byId.algorithm.issues.some(issue => issue.id === 'duty-range'));
  assert.ok(byId.application.issues.some(issue => issue.id === 'design-protocol-nodeId'));
  assert.ok(!byId.hardware.issues.some(issue => ['duty-range', 'design-protocol-nodeId'].includes(issue.id)));
  assert.ok(byId.hardware.issues.some(issue => issue.id === 'memory-layout-missing'));
  assert.ok(byId.algorithm.issues.some(issue => issue.id === 'current-loop-motor-parameters'));
});

test('physical verification remains in global checks without blocking configuration progress', () => {
  const project = configuredProject();
  const issues = validateProject(project);
  const verificationIds = ['build-verification', 'hardware-verification', 'realtime-budget', 'calibration-results', 'current-loop-runtime-unverified', 'layer-version-runtime-unverified'];
  const verification = issues.filter(issue => verificationIds.includes(issue.id));
  assert.equal(verification.length, verificationIds.length);
  const before = structuredClone(verification);
  const guide = getGuide(project, verification);
  assert.equal(guide.configuredCount, 4);
  assert.equal(guide.nextStepId, 'build');
  assert.ok(guide.steps.slice(0, 4).every(step => step.issues.length === 0 && step.state === 'configured'));
  assert.deepEqual(verification, before);
  assert.ok(verification.every(issue => issue.level === 'pending'));
  assert.ok(getGuide(project, issues).steps.slice(0, 4).every(step => !step.issues.some(issue => verificationIds.includes(issue.id))));
});

test('previous commissioning records are preserved but do not determine configuration completion', () => {
  const project = configuredProject();
  project.commissioning.checks = {
    build: { status: 'passed', note: '原构建记录', fingerprint: 'previous-configuration', updatedAt: '2026-11-15T10:00:00.000Z' },
    timing: { status: 'failed', note: '原时序记录', fingerprint: 'previous-configuration', updatedAt: '2026-11-15T10:00:00.000Z' },
  };
  const before = structuredClone(project);
  const guide = getGuide(project);
  assert.equal(guide.nextStepId, 'build');
  assert.equal(guide.configuredCount, 4);
  assert.equal(Object.hasOwn(guide, 'checks'), false);
  assert.deepEqual(project, before);
  project.instances['app-comms'].runtimeEnabled = false;
  assert.equal(getGuide(project, validateProject(project)).steps.find(step => step.id === 'application').state, 'blocked');
  assert.deepEqual(project.commissioning, before.commissioning);
});

test('编码器分辨率按所选硬件类型检查，不由观测器运行开关隐去', () => {
  const project = configuredProject();
  project.instances['hw-drivers'].parameters.encoderBits = null;
  project.instances['foc-observer'].enabled = true;
  project.instances['foc-observer'].runtimeEnabled = false;
  project.instances['foc-observer'].parameters.startupStrategy = 'encoder_assist';
  assert.equal(getGuide(project).steps.find(step => step.id === 'hardware').state, 'todo');
  project.instances['foc-observer'].runtimeEnabled = true;
  assert.equal(getGuide(project).steps.find(step => step.id === 'hardware').state, 'todo');
  Object.assign(project.instances['hw-drivers'].parameters, { motorEncoderType: 'hall', motorEncoderHallMode: 'digital' });
  assert.equal(getGuide(project).steps.find(step => step.id === 'hardware').state, 'configured');
});

test('未包含通信模块时无需选择协议，但已设计的协议仍检查引用冲突', () => {
  const project = configuredProject();
  project.instances['app-comms'].enabled = false;
  project.instances['app-comms'].runtimeEnabled = false;
  project.instances['app-motion'].parameters.commandSource = 'local';
  project.design.protocol.transport = 'unselected';
  const state = () => getGuide(project, validateProject(project)).steps.find(step => step.id === 'application').state;
  assert.equal(state(), 'configured');
  project.design.protocol.messages[0].payload = 'removed-structure';
  assert.equal(state(), 'blocked');
});


test('层间数据连接问题归入端点所在配置步骤', () => {
  const project=createProject();
  const link=createLayerInterface('guide-link');
  Object.assign(link,{fromModule:'hw-board',toModule:'foc-feedback',sourceStructure:project.design.moduleContracts['hw-board'].state,targetStructure:project.design.moduleContracts['foc-feedback'].input});
  project.design.layerInterfaces.push(link);
  const guide=getGuide(project,validateProject(project));
  for(const id of ['hardware','algorithm']) {
    const step=guide.steps.find(item=>item.id===id);
    assert.equal(step.state,'blocked');
    assert.ok(step.issues.some(issue=>issue.designPage==='interfaces'&&issue.itemId===link.id));
  }
});

test('独立执行器选型不要求先创建关节模组，自行配置硬件无需货架驱动器', () => {
  const project = configuredProject();
  assert.equal(project.catalog.activeAssemblyId, '');
  assert.equal(project.catalog.activeDriverId, '');
  const selection = getGuide(project).steps.find(step => step.id === 'actuator');
  assert.equal(selection.state, 'configured');
  assert.equal(selection.total, 2);
  assert.equal(selection.completed, 2);
  assert.equal(getGuide(project).steps.find(step => step.id === 'hardware').state, 'configured');
  project.catalog.activeActuatorId = '';
  assert.equal(getGuide(project).nextStepId, 'actuator');
  assert.equal(getGuide(createProject()).steps[0].completed, 1, '旧工程与空白工程的空驱动器引用继续表示自行配置');
});

test('执行器和驱动器独立计入选型，失效驱动器引用不能算自行配置', () => {
  const project = configuredProject(), driver = createDriver('已选驱动器');
  project.catalog.drivers.push(driver); project.catalog.activeDriverId = driver.id;
  const before = structuredClone(project), selection = getGuide(project).steps[0];
  assert.equal(selection.state, 'configured');
  assert.equal(selection.completed, 2);
  assert.deepEqual(project, before, '读取进度不应用货架参数或改变选型');
  project.catalog.activeDriverId = 'removed-driver';
  assert.equal(getGuide(project).steps[0].completed, 1);
  assert.equal(getGuide(project).steps[0].state, 'todo');
  const guide = getGuide(project, validateEquipment(project));
  assert.equal(guide.steps[0].state, 'blocked');
  assert.ok(guide.steps[0].issues.some(issue => issue.id === 'equipment-driver-reference'));
  assert.ok(!guide.steps[1].issues.some(issue => issue.id === 'equipment-driver-reference'));
  const custom = beginCustomHardware(project);
  assert.equal(getGuide(custom).steps[0].state, 'configured');
  assert.equal(getGuide(custom).steps[0].completed, 2);
  assert.deepEqual(custom.instances, project.instances, '改为自行配置不会覆盖当前硬件参数');
});

test('已选驱动器与组合的问题归入选型，项目硬件问题仍归硬件', () => {
  const project = configuredProject(), driver = createDriver('已选驱动器'), unused = createDriver('未选驱动器');
  driver.adcBits = -1; unused.adcBits = -2;
  project.catalog.drivers.push(driver, unused); project.catalog.activeDriverId = driver.id;
  const assembly = { ...createAssembly(), actuatorId: project.catalog.activeActuatorId, driverId: driver.id };
  project.catalog.assemblies.push(assembly); project.catalog.activeAssemblyId = assembly.id;
  project.instances['hw-board'].parameters.pwmHz = null;
  const hardwareIssue = { id: 'selected-hardware-pwm', level: 'pending', moduleId: 'hw-board', paramKey: 'pwmHz' };
  const guide = getGuide(project, [...validateEquipment(project), hardwareIssue]);
  assert.equal(guide.steps[0].state, 'blocked');
  assert.ok(guide.steps[0].issues.some(issue => issue.id === `equipment-range-${driver.id}-adcBits`));
  assert.ok(guide.steps[0].issues.some(issue => issue.id === 'equipment-current-unknown' && issue.itemId === assembly.id));
  assert.ok(!guide.steps[0].issues.some(issue => issue.itemId === unused.id || issue.id === hardwareIssue.id));
  assert.equal(guide.steps[1].state, 'todo');
  assert.deepEqual(guide.steps[1].issues, [hardwareIssue]);
});

test('当前组合引用失效或与独立选型冲突时选型不能完成', () => {
  const project = configuredProject(), driver = createDriver('驱动器');
  project.catalog.drivers.push(driver); project.catalog.activeDriverId = driver.id;
  project.catalog.activeAssemblyId = 'missing-assembly';
  let guide = getGuide(project, validateEquipment(project));
  assert.equal(guide.steps[0].completed, 0);
  assert.equal(guide.steps[0].state, 'blocked');
  assert.ok(guide.steps[0].issues.some(issue => issue.id === 'equipment-active-reference'));
  const other = createActuator('其他执行器'); project.catalog.actuators.push(other);
  const assembly = { ...createAssembly(), actuatorId: other.id, driverId: driver.id };
  project.catalog.assemblies.push(assembly); project.catalog.activeAssemblyId = assembly.id;
  guide = getGuide(project, validateEquipment(project));
  assert.equal(guide.steps[0].completed, 1);
  assert.equal(guide.steps[0].state, 'blocked');
  assert.ok(guide.steps[0].issues.some(issue => issue.id === 'equipment-active-selection'));
  assert.ok(!guide.steps[1].issues.some(issue => issue.designPage === 'equipment'));
});

test('构建集成检查，只有当前配置检查并编译完成才算完成此步骤', () => {
  const project = configuredProject();
  const context = { inspection: { current: true, supported: true, issues: [] } };
  let guide = getGuide(project, [], context);
  assert.equal(guide.nextStepId, 'build');
  assert.equal(guide.configuredCount, 4);
  assert.equal(guide.steps[4].statusLabel, '待构建');
  guide = getGuide(project, [], { ...context, buildStatus: 'built' });
  assert.equal(guide.nextStepId, null);
  assert.equal(guide.configuredCount, 5);
  assert.equal(guide.steps[4].statusLabel, '已构建');
  guide = getGuide(project, [], { inspection: { current: false, supported: true }, buildStatus: 'built' });
  assert.equal(guide.nextStepId, 'build');
  assert.equal(guide.steps[4].state, 'todo');
  guide = getGuide(project, [], { inspection: { current: true, supported: false } });
  assert.equal(guide.steps[4].state, 'blocked');
  assert.equal(guide.steps.some(step => step.id === 'flash'), false);
});

test('烧录状态要求当前构建与真实写入结果，历史结果不算本次已烧录', () => {
  const project = configuredProject();
  const built = { inspection: { current: true, supported: true }, buildStatus: 'built' };
  const buildStep = context => getGuide(project, [], context).steps.find(step => step.id === 'build');
  assert.equal(buildStep({}).statusLabel, '待构建');
  assert.equal(buildStep(built).statusLabel, '已构建');
  for (const flashStatus of [{ programmed: true }, { current: false, programmed: true }, { current: true, programmed: false }]) {
    assert.equal(buildStep({ ...built, flashStatus }).statusLabel, '已构建');
  }
  const flashStatus = { current: true, programmed: true };
  assert.equal(buildStep({ flashStatus }).state, 'todo');
  const guide = getGuide(project, [], { ...built, flashStatus });
  assert.equal(guide.steps.at(-1).statusLabel, '已烧录');
  assert.equal(guide.nextStepId, null);
  assert.equal(guide.configuredCount, 5);
  assert.equal(guide.steps.some(step => step.id === 'flash'), false);
});
