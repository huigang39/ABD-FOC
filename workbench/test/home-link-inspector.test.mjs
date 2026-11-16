import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHomeLinkDetails } from '../web/src/features/architecture/link-inspector.mjs';
import { newModuleProject } from './support/new-project.mjs';

const fixture = () => {
  const project = newModuleProject();
  project.instances['app-comms'].enabled = project.instances['app-comms'].runtimeEnabled = false;
  return project;
};

test('layer links expose project mappings, units and current contract bindings without mutation', () => {
  const project = fixture(), before = JSON.stringify(project);
  const control = renderHomeLinkDetails(project, 'control').html;
  assert.match(control, /reference_dq/);
  assert.match(control, /f32\[2\]/);
  assert.match(control, /run_permitted/);
  assert.doesNotMatch(control, /duty_request/);
  const sampling = renderHomeLinkDetails(project, 'sampling').html;
  assert.match(sampling, /value\[0\]/);
  assert.match(sampling, /motor_angle/);
  assert.match(sampling, /rad/);
  assert.match(sampling, /20000 Hz/);
  assert.equal(JSON.stringify(project), before);

  const source = project.design.structures.find(structure => structure.id === project.design.moduleContracts['app-motion'].output);
  source.fields.find(field => field.name === 'reference_dq').name = 'requested_current';
  assert.match(renderHomeLinkDetails(project, 'control').html, /requested_current/);
  project.design.moduleContracts['app-motion'].output = 'missing-output';
  assert.match(renderHomeLinkDetails(project, 'control').html, /未解析字段/);
});

test('direction filters report only actual boundary mappings', () => {
  const project = fixture();
  const modulation = renderHomeLinkDetails(project, 'modulation').html;
  assert.match(modulation, /duty_request/);
  assert.match(modulation, /gate_request/);
  assert.doesNotMatch(modulation, /voltage_dq/);
  const feedback = renderHomeLinkDetails(project, 'feedback').html;
  assert.match(feedback, /algorithm_faults/);
  assert.doesNotMatch(feedback, /joint_rpm|motor_velocity/);
});

test('sampling distinguishes configured currents and bus voltage from absent phase voltage', () => {
  const project = fixture();
  assert.match(renderHomeLinkDetails(project, 'current-sampling').html, /phase_current/);
  assert.match(renderHomeLinkDetails(project, 'bus-voltage-sampling').html, /bus_voltage/);
  const voltage = renderHomeLinkDetails(project, 'phase-voltage-sampling').html;
  assert.match(voltage, /未定义相电压采样字段/);
  assert.match(voltage, /ADC3/);
  assert.match(voltage, /未取得实时采样值/);
});

test('transport details distinguish the selected link and read real payload fields', () => {
  const project = fixture();
  project.design.protocol.transport = 'ethercat';
  project.design.protocol.messages = [{ id: 'speed', name: '速度命令', opcode: 16, direction: 'command', payload: 'app-motion-output', periodMs: 10 }];
  const result = renderHomeLinkDetails(project, 'can');
  assert.match(result.html, /查看链路：CAN · 工程协议：EtherCAT/);
  assert.match(result.html, /当前工程未使用此链路/);
  assert.match(result.html, /速度命令/);
  assert.match(result.html, /reference_dq/);
  assert.match(result.html, /0x10/);
  assert.match(result.html, /10 ms/);
  assert.match(result.html, /应用通信模块未启用/);
});

test('dynamic names, field metadata, resources and transport labels are escaped', () => {
  const project = fixture();
  project.design.layerInterfaces.find(link => link.id === 'link-reference').name = '<img src=x onerror=alert(1)>';
  const field = project.design.structures.find(structure => structure.id === 'app-motion-output').fields[0];
  field.meaning = '<script>bad()</script>';
  const html = renderHomeLinkDetails(project, 'control').html;
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /&lt;img/);
  project.instances['hw-board'].parameters.resources[0].name = '<svg onload=x>';
  assert.doesNotMatch(renderHomeLinkDetails(project, 'power-u').html, /<svg/);
  project.design.protocol.transport = '<a onclick=x>';
  assert.doesNotMatch(renderHomeLinkDetails(project, 'can').html, /<a onclick/);
});

test('power line configuration never fabricates phase health or measurements', () => {
  const project = fixture();
  for (const phase of ['u', 'v', 'w']) {
    const { html } = renderHomeLinkDetails(project, `power-${phase}`);
    assert.match(html, /未检测/);
    assert.doesNotMatch(html, /class="home-link-health ok"|相正常|24 V|0 A/);
  }
  const context = { now: 5000, phaseDiagnostics: { source: 'device', connected: true, projectId: project.id, observedAt: 4900, phases: { U: { status: 'missing', message: 'U 相缺相' } } } };
  assert.match(renderHomeLinkDetails(project, 'power-u', context).html, /U 相缺相/);
  assert.match(renderHomeLinkDetails(project, 'power-u', context).html, /home-link-health error/);
  context.now = 9000;
  assert.match(renderHomeLinkDetails(project, 'power-u', context).html, /未检测/);
});

test('each power wire exposes only its own current and voltage contract elements', () => {
  const project = fixture();
  const output = project.design.structures.find(structure => structure.id === project.design.moduleContracts['hw-board'].output);
  for (const [index, phase] of ['u', 'v', 'w'].entries()) {
    const html = renderHomeLinkDetails(project, `power-${phase}`).html;
    assert.match(html, new RegExp(`phase_current\\[${index}\\]`));
    assert.match(html, new RegExp(`未定义 ${phase.toUpperCase()} 相电压采样字段`));
    assert.match(html, /f32 · A/);
    assert.doesNotMatch(html, /phase_voltage\[/);
    for (const other of [0, 1, 2].filter(value => value !== index)) assert.doesNotMatch(html, new RegExp(`phase_current\\[${other}\\]`));
  }
  output.fields.push({ id: 'configured-phase-voltage', name: 'phase_voltage', type: 'f32', count: 3, unit: 'mV', meaning: '<已配置相电压>' });
  for (const [index, phase] of ['u', 'v', 'w'].entries()) {
    const html = renderHomeLinkDetails(project, `power-${phase}`).html;
    assert.match(html, new RegExp(`phase_voltage\\[${index}\\]`));
    assert.match(html, /f32 · mV/);
    assert.match(html, /&lt;已配置相电压&gt;/);
    assert.doesNotMatch(html, /未定义 .* 相电压采样字段|<已配置相电压>/);
  }
  output.fields.find(field => field.name === 'phase_current').count = 2;
  assert.match(renderHomeLinkDetails(project, 'power-w').html, /未定义 W 相电流采样字段/);
});

test('power supply exposes configured bus parameters and real sampling fields without live values', () => {
  const project = fixture(), before = JSON.stringify(project);
  const initial = renderHomeLinkDetails(project, 'power-supply');
  assert.equal(initial.title, '电源与母线采样');
  assert.match(initial.html, /电源 → 驱动器直流母线/);
  assert.match(initial.html, /配置母线电压：未配置/);
  assert.match(initial.html, /bus_voltage/);
  assert.match(initial.html, /f32 · V/);
  assert.match(initial.html, /ADC 配置精度：14 bit/);
  assert.match(initial.html, /#\/parameters\/hardware\?module=hw-board/);
  assert.match(initial.html, /未取得实时采样值/);
  assert.equal(JSON.stringify(project), before);
  project.instances['hw-board'].parameters.busVoltageV = 48;
  assert.match(renderHomeLinkDetails(project, 'power-supply').html, /配置母线电压：48 V/);
});

test('J-Link lists supplied capture configuration and does not imply live values', () => {
  const project = fixture();
  const initial = renderHomeLinkDetails(project, 'jlink').html;
  assert.match(initial, /未连接/);
  assert.match(initial, /尚未配置采样通道/);
  const html = renderHomeLinkDetails(project, 'jlink', { nativeState: { debug: { connected: true, capture: { configured: true, channels: [{ name: '<voltage>', type: 'f32', address: 0x24001000 }] } }, captureMeta: { nominalSampleHz: 1000 } } }).html;
  assert.match(html, /已应用的采样通道/);
  assert.match(html, /&lt;voltage&gt;/);
  assert.match(html, /0x24001000/);
  assert.match(html, /实际有效采样率尚未确认/);
  assert.match(html, /不展示实时数值/);
});

test('mechanical links show three quantities and the selected actuator reduction without inventing efficiency', () => {
  const project = fixture(), before = JSON.stringify(project);
  for (const key of ['motor-output', 'reducer-output']) {
    const { title, html } = renderHomeLinkDetails(project, key);
    assert.equal(title, key === 'motor-output' ? '电机输出' : '减速机输出');
    assert.match(html, /位置/);
    assert.match(html, /速度/);
    assert.match(html, /力矩/);
    assert.match(html, /Δθ_out = Δθ_motor \/ 51/);
    assert.match(html, /ω_out = ω_motor \/ 51/);
    assert.match(html, /τ_out ≈ τ_motor × 51 × η/);
    assert.match(html, /rad\/s/);
    assert.match(html, /N·m/);
    assert.match(html, /传动效率未知/);
    assert.match(html, /绝对位置还需各自零位/);
    assert.match(html, /未取得电机或出轴的实时位置、速度、力矩/);
    assert.doesNotMatch(html, /100%|实时力矩：0/);
  }
  assert.equal(JSON.stringify(project), before);
});

test('mechanical conversion follows independent actuator selection, efficiency, units and escaped names', () => {
  const project = fixture();
  const original = project.catalog.actuators.find(actuator => actuator.id === project.catalog.activeActuatorId);
  const selected = structuredClone(original);
  selected.id = 'independent-actuator';
  selected.name = '<img src=x onerror=alert(1)>';
  selected.reducer = { ...selected.reducer, ratio: 100, efficiency: 0.85 };
  project.catalog.actuators.push(selected);
  project.catalog.activeActuatorId = selected.id;
  const observerOutput = project.design.structures.find(structure => structure.id === project.design.moduleContracts['foc-observer'].output);
  observerOutput.fields.find(field => field.name === 'motor_velocity').unit = 'rpm';
  const html = renderHomeLinkDetails(project, 'reducer-output').html;
  assert.match(html, /ω_out = ω_motor \/ 100/);
  assert.match(html, /τ_out ≈ τ_motor × 85/);
  assert.match(html, /传动效率 η：85%/);
  assert.match(html, /rpm/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|传动效率未知/);
  assert.match(html, /#\/equipment\/actuators\/independent-actuator/);
});

test('mechanical conversion preserves unknown parameters, including direct drive efficiency', () => {
  const project = fixture();
  const actuator = project.catalog.actuators.find(actuator => actuator.id === project.catalog.activeActuatorId);
  actuator.reducer.ratio = 1;
  assert.match(renderHomeLinkDetails(project, 'reducer-output').html, /传动效率未知/);
  actuator.reducer.ratio = null;
  actuator.reducer.efficiency = 1.2;
  const html = renderHomeLinkDetails(project, 'reducer-output').html;
  assert.match(html, /N（待配置）/);
  assert.match(html, /τ_out ≈ τ_motor × N × η/);
  assert.doesNotMatch(html, /NaN|Infinity|120%/);
  project.catalog.activeActuatorId = 'missing';
  assert.match(renderHomeLinkDetails(project, 'motor-output').html, /尚未选择执行器/);
});

test('wire detail edits open only their module panel while protocol definitions retain their own page', () => {
  const project = fixture();
  for (const [key, route] of [
    ['control', '#/parameters/app?module=app-motion'],
    ['feedback', '#/parameters/app?module=app-safety'],
    ['modulation', '#/parameters/foc?module=foc-modulation'],
    ['sampling', '#/parameters/hardware?module=hw-drivers'],
    ...['power-u', 'power-v', 'power-w', 'power-supply', 'current-sampling', 'phase-voltage-sampling', 'bus-voltage-sampling'].map(key => [key, '#/parameters/hardware?module=hw-board']),
  ]) {
    const html = renderHomeLinkDetails(project, key).html;
    assert.ok(html.includes(`href="${route}"`), key);
    assert.doesNotMatch(html, /href="#\/project\/(?:application|algorithm|hardware)/);
  }
  for (const key of ['can', 'ethercat', 'ethernet']) assert.match(renderHomeLinkDetails(project, key).html, /href="#\/project\/protocol"/);
  project.catalog.activeActuatorId = 'missing';
  assert.match(renderHomeLinkDetails(project, 'motor-output').html, /href="#\/equipment\/actuators"/);
});
