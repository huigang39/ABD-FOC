import { renderObserverArchitecture } from '../../modules/algorithm/foc-observer/view.mjs';
import { MODULES } from '../../modules/registry.mjs';
import { esc } from '../../shared/esc.mjs';
import { icon, LAYER_ICONS, MODULE_ICONS } from '../../shared/ui/icons.mjs';
import { getConfigurationSelection } from '../configuration/workspace.mjs';
import { pageHeading } from '../../shared/ui/page-heading.mjs';
import { getPhaseHealth } from './phase-health.mjs';
import { getModuleHealth } from './module-health.mjs';

const LAYERS = Object.freeze({
  app: {
    name: '应用层', code: 'APP',
    summary: '组织任务、命令、运动控制和校准流程。',
    boundary: '应用管理运行策略、控制模式和数据，通过统一接口调用算法与硬件服务。',
  },
  foc: {
    name: '算法层', code: 'ALG',
    summary: '解算反馈、同步观测和电流闭环，产生调制结果。',
    boundary: '算法接收采样与控制给定，输出调制结果和反馈状态；不直接依赖芯片寄存器或应用调度器。',
  },
  hardware: {
    name: '硬件层', code: 'BSP',
    summary: '依次配置内核、外设和驱动。',
    boundary: '硬件负责实际采样、PWM 更新和门控时序，以统一能力接口隔离 MCU 与板卡差异。',
  },
});
const EXECUTION_NAMES = {
  application: '应用任务', control: '控制环', background: '后台服务',
  fast: '电流环控制周期', hardware: '硬件执行域',
};
const ORDER = ['app', 'foc', 'hardware'];
const layerModules = layer => MODULES.filter(module => module.layer === layer && !['foc-feedback','foc-lifecycle','hw-safety'].includes(module.id)).sort((a, b) => a.order - b.order);
const heading = (title, description, crumbs = []) => pageHeading({ title, description, crumbs });

/** Architecture links always stay in the static module catalogue. */
export function architectureModuleRoute(moduleId) {
  if (moduleId === 'hw-safety') return '#/architecture/hardware';
  if (moduleId === 'foc-lifecycle') return '#/architecture/foc?module=foc-current';
  const module = MODULES.find(item => item.id === moduleId);
  return module ? `#/architecture/${module.layer}?module=${encodeURIComponent(module.id)}` : '#/architecture';
}


/** The home canvas edits the current project; the static architecture catalogue remains separate. */
export function renderArchitectureOverview(project = null, { source = 'can', phaseDiagnostics = null, moduleDiagnostics = null, now = Date.now() } = {}) {
  const layerStep = { app: 'application', foc: 'algorithm', hardware: 'hardware' };
  const firstModule = { app: 'app-runtime', foc: 'foc-current', hardware: 'hw-platform' };
  const healthAttrs = key => {
    const health = getModuleHealth(project, key, moduleDiagnostics, now);
    return `data-health="${health.state}" aria-description="${esc(health.label)}"`;
  };
  const entry = (route, label) => `role="link" tabindex="0" data-home-route="${esc(route)}" aria-label="${esc(label)}" title="双击${esc(label)}"`;
  const simCard = (cls, title) => `<div class="canvas-sim ${cls}"><strong>${esc(title)}</strong></div>`;
  const chainNode = (id, extra = '') => `<div class="chain-node chain-${id}" ${healthAttrs(layerStep[id])} ${entry(`#/parameters/${id}?module=${firstModule[id]}`, `编辑${LAYERS[id].name}参数`)}><span class="chain-head"><strong>${LAYERS[id].name}</strong></span><span class="chain-visual"><canvas class="line-field" data-mark="${id}" aria-hidden="true"></canvas></span>${extra}</div>`;
  const wire = (key, label, back = false, extra = '') => `<button type="button" class="canvas-link-lane${back ? ' canvas-link-lane-back' : ''}" data-action="show-home-link" data-link="${key}" aria-label="查看${label}数据"><span>${label}${extra}</span><i aria-hidden="true"></i></button>`;
  const duplex = (forward, back, forwardKey, backKey) => `<div class="canvas-link canvas-link-pair">${wire(forwardKey,forward)}${wire(backKey,back,true)}</div>`;
  const powerLinks = `<div class="canvas-power-links" aria-label="三相功率与采样反馈"><div class="canvas-phase-wires">${['U','V','W'].map(phase=>{
    const health=getPhaseHealth(project,phase,phaseDiagnostics,now);
    const glyph=health.state==='ok'?'✓':health.state==='unknown'?'':'!';
    const status=glyph?`<span class="phase-wire-status" aria-hidden="true">${glyph}</span>`:'';
    return `<button type="button" class="canvas-link-lane canvas-phase-wire phase-${health.state}" data-action="show-home-link" data-link="power-${phase.toLowerCase()}" data-phase="${phase}" aria-label="${phase} 相电压与电流：${esc(health.label)}"><span>${phase}${status}</span><i aria-hidden="true"></i></button>`;
  }).join('')}</div></div>`;
  const selection = project ? getConfigurationSelection(project) : null;
  const actuatorRoute = selection?.actuator ? `#/equipment/actuators/${encodeURIComponent(selection.actuator.id)}` : '#/equipment/actuators';
  const assemblyRoute = selection?.assembly ? `#/equipment/assemblies/${encodeURIComponent(selection.assembly.id)}` : '#/equipment/assemblies/new';
  const physicalNode = (name, mark) => `<div class="chain-node chain-physical" ${healthAttrs(mark)} ${entry(actuatorRoute, `编辑${name}参数`)}><span class="chain-head"><strong>${esc(name)}</strong></span><span class="chain-visual"><canvas class="line-field" data-mark="${mark}" aria-hidden="true"></canvas></span></div>`;
  const sourceLine = (value, label) => `<div class="canvas-line"><label><input type="radio" name="canvas-source" value="${value}"${source === value ? ' checked' : ''}><small>${label}</small></label><button type="button" class="canvas-source-wire" data-action="show-home-link" data-link="${value}" aria-label="查看${label}传输数据"><i aria-hidden="true"></i></button></div>`;
  const picker = (scope, items, selectedId, label, placeholder) => `<select class="field-select" data-edit="${scope}" aria-label="${esc(label)}"><option value="" disabled${!selectedId ? ' selected' : ''}>${esc(placeholder)}</option>${items.map(item => `<option value="${esc(item.id)}"${item.id === selectedId ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`;
  const modelPicker = `<div class="canvas-model-picker">${picker('configuration-assembly', project?.catalog?.assemblies || [], selection?.assembly?.id, '关节模组型号', selection?.actuator || selection?.driver ? '自定义组合' : '选择关节模组型号')}</div>`;
  const driverPicker = picker('configuration-driver', project?.catalog?.drivers || [], selection?.driver?.id, '选择驱动器', '选择驱动器');
  const actuatorPicker = picker('configuration-actuator', project?.catalog?.actuators || [], selection?.actuator?.id, '选择执行器', '选择执行器');
  return `<section class="architecture-overview lifecycle-canvas" aria-label="关节模组信号与功率链全景">
    <div class="canvas-flow">
      <div class="canvas-sims" style="grid-area:sims">${simCard('canvas-sim-signal', '数字信号仿真')}${simCard('canvas-sim-hardware', '硬件仿真')}</div>
      <div class="canvas-control-sources" style="grid-area:sources"><div class="canvas-source-unit"><span class="canvas-source-card" data-home-source="host" ${entry('#/parameters/app?module=app-comms', '编辑上位机协议')}><strong>上位机</strong></span><span class="canvas-lines">${sourceLine('can', 'CAN')}${sourceLine('ethercat', 'EtherCAT')}${sourceLine('ethernet', 'Ethernet')}</span></div>
      <div class="canvas-source-unit"><span class="canvas-source-card" data-home-source="debug" ${entry('#/debug', '进入调试器')}><strong>调试器</strong></span><span class="canvas-lines">${sourceLine('jlink', 'J-Link')}</span></div></div>
      <div class="canvas-source-unit canvas-power-source" style="grid-area:power"><span class="canvas-source-card" ${entry('#/parameters/hardware?module=hw-board', '编辑电源参数')}><strong>电源</strong></span><div class="canvas-link">${wire('power-supply','母线电压')}</div></div>
      <section class="canvas-group-joint" aria-label="关节模组" style="grid-area:joint">
        <div class="canvas-joint-heading"><div class="canvas-joint-title" ${entry(assemblyRoute, '编辑关节模组型号与组合')}><span class="canvas-joint-mark">${icon('motor')}</span><strong>关节模组</strong></div>${modelPicker}</div>
        <div class="canvas-joint-body">
      <div class="canvas-group canvas-group-driver">
        <div class="canvas-group-label"><span ${entry('#/parameters/hardware?module=hw-platform', '编辑驱动器硬件参数')}>${icon('board', 'canvas-group-icon')}<b>驱动器</b></span>${driverPicker}</div>
        <div class="canvas-group-chain canvas-group-chain-layers">${chainNode('app')}${duplex('控制给定', '反馈快照','control','feedback')}${chainNode('foc')}${duplex('调制提交', '同步采样','modulation','sampling')}${chainNode('hardware', '<span class="chain-embedded"><b>PCB 设计</b></span>')}</div>
      </div>
      ${powerLinks}
      <div class="canvas-group canvas-group-actuator">
        <div class="canvas-group-label"><span ${entry(actuatorRoute, '编辑执行器参数')}>${icon('motor', 'canvas-group-icon')}<b>执行器</b></span>${actuatorPicker}</div>
        <div class="canvas-group-chain canvas-group-chain-physical">${physicalNode('电机', 'motor')}<div class="canvas-link canvas-link-axis">${wire('motor-output','位置 · 速度 · 力矩')}</div>${physicalNode('减速机', 'reducer')}</div>
        <div class="canvas-link canvas-output-link">${wire('reducer-output','出轴位置 · 速度 · 力矩')}</div>
      </div>
        </div>
      </section>
      <div class="canvas-dynamics" style="grid-area:dyn"><strong>动力学仿真</strong></div>
    </div>
  </section>`;
}

function moduleLinks(modules) {
  return `<div class="dependency-links">${modules.map(module => `<a href="${architectureModuleRoute(module.id)}"><span>${esc(module.title)}</span><small class="dependency-layer">${LAYERS[module.layer].name}</small></a>`).join('')}</div>`;
}

function moduleDescription(module) {
  const dependencies = (module.dependencies || []).filter(id => !['hw-safety','foc-lifecycle'].includes(id)).map(id => MODULES.find(item => item.id === id)).filter(Boolean);
  const consumers = MODULES.filter(item => !['hw-safety','foc-lifecycle'].includes(item.id) && item.dependencies?.includes(module.id));
  const roles = [
    ['input', '输入', module.inputs],
    ['output', '输出', module.outputs],
    ['state', '状态', '仅由模块内部维护，用于跨周期记忆与过程管理，不作为层间交换入口。'],
  ];
  return `<div class="architecture-module-description">${module.id==='foc-observer'?renderObserverArchitecture():''}<span class="execution-tag">${esc(EXECUTION_NAMES[module.executionDomain] || '模块执行')}</span><section class="detail-section"><h3>模块职责</h3><p>${esc(module.role)}</p></section>
    <section class="detail-section"><h3>输入 · 输出 · 状态</h3><div class="architecture-contracts">${roles.map(([role, label, description]) => `<article class="architecture-contract" data-contract-role="${role}"><h4>${label}</h4>${module.contracts?.[role]?.name ? `<code>${esc(module.contracts[role].name)}</code>` : ''}<p>${esc(description)}</p></article>`).join('')}</div></section>
    <section class="detail-section"><h3>设计边界</h3><p>${esc(module.boundary)}</p></section>
    <section class="detail-section"><h3>依赖模块</h3>${dependencies.length ? moduleLinks(dependencies) : '<p class="architecture-empty">无其他模块依赖。</p>'}</section>
    ${consumers.length ? `<section class="detail-section"><h3>由这些模块使用</h3>${moduleLinks(consumers)}</section>` : ''}</div>`;
}

export function renderArchitectureLayer(layerId = 'hardware', moduleId = '') {
  const id = Object.hasOwn(LAYERS, layerId) ? layerId : 'hardware';
  const layer = LAYERS[id], modules = layerModules(id);
  const selected = modules.find(module => module.id === moduleId) || modules[0];
  return `<section class="architecture-layer">${heading(layer.name, layer.summary, [{ href: '#/architecture', label: '主页' }, { label: layer.name }])}
    <div class="layer-layout layer-${id}"><section class="module-catalog" aria-label="${layer.name}的模块"><div class="layer-summary"><span>从基础到扩展，浏览模块职责</span><span>${modules.length} 个模块</span></div><div class="module-grid">${modules.map(module => `<a class="module-card${module.id === selected.id ? ' selected' : ''}" href="${architectureModuleRoute(module.id)}"${module.id === selected.id ? ' aria-current="page"' : ''}><div class="module-card-top"><span class="module-mark">${icon(MODULE_ICONS[module.id], 'module-icon')}</span><span class="module-number">${String(module.order).padStart(2, '0')}</span></div><strong class="module-title">${esc(module.title)}</strong><p class="module-summary">${esc(module.summary)}</p><div class="module-footer"><span>${esc(EXECUTION_NAMES[module.executionDomain] || '功能说明')}</span>${icon('arrow-right')}</div></a>`).join('')}</div><div class="learning-note"><strong>层级边界</strong><p>${layer.boundary}</p></div></section>
    <aside class="inspector architecture-inspector" aria-labelledby="architecture-module-title"><div class="inspector-header"><span class="eyebrow">${esc(selected.id)}</span><h2 id="architecture-module-title">${esc(selected.title)}</h2></div><div class="inspector-body">${moduleDescription(selected)}</div></aside></div><footer class="page-back-actions"><a class="button small navigation-action" href="#/architecture">← 返回主页</a></footer></section>`;
}
