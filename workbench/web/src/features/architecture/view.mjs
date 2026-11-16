import { renderObserverArchitecture } from '../../modules/algorithm/foc-observer/view.mjs';
import { MODULES } from '../../modules/registry.mjs';
import { esc } from '../../shared/esc.mjs';
import { icon, LAYER_ICONS, MODULE_ICONS } from '../../shared/ui/icons.mjs';
import { getConfigurationSelection } from '../configuration/workspace.mjs';
import { configurationStatus } from '../configuration/tree-view.mjs';
import { getGuide } from '../configuration/guide.mjs';
import { pageHeading } from '../../shared/ui/page-heading.mjs';

const LAYERS = Object.freeze({
  app: {
    name: '应用', code: 'APP',
    summary: '组织任务、命令、运动控制和校准流程。',
    boundary: '应用管理运行策略、控制模式和数据，通过统一接口调用算法与硬件服务。',
  },
  foc: {
    name: '算法', code: 'ALG',
    summary: '解算反馈、同步观测和电流闭环，产生调制结果。',
    boundary: '算法接收采样与控制给定，输出调制结果和反馈状态；不直接依赖芯片寄存器或应用调度器。',
  },
  hardware: {
    name: '硬件', code: 'BSP',
    summary: '依次配置内核、外设、驱动与保护。',
    boundary: '硬件负责实际采样、PWM 更新和门控时序，以统一能力接口隔离 MCU 与板卡差异。',
  },
});
const EXECUTION_NAMES = {
  application: '应用任务', control: '应用控制任务', background: '后台服务',
  fast: '电流环控制周期', hardware: '硬件执行域',
};
const ORDER = ['app', 'foc', 'hardware'];
const layerModules = layer => MODULES.filter(module => module.layer === layer && module.id !== 'foc-feedback').sort((a, b) => a.order - b.order);
const heading = (title, description, crumbs = []) => pageHeading({ title, description, crumbs });

/** Architecture links always stay in the static module catalogue. */
export function architectureModuleRoute(moduleId) {
  const module = MODULES.find(item => item.id === moduleId);
  return module ? `#/architecture/${module.layer}?module=${encodeURIComponent(module.id)}` : '#/architecture';
}


/** 主页全景画布：信号与功率链。指令源（上位机/调试器）→【驱动器：应用·算法·硬件(+PCB)】→ 三相 →【执行器：电机·减速机】；
 * 上方数字信号仿真与硬件仿真，底部动力学仿真横跨全图。带工程实例时，驱动器/执行器提供货架快速选择。 */
export function renderArchitectureOverview(project = null) {
  const soon = '<span class="canvas-soon">规划中</span>';
  // 层配置状态：从配置向导取每层聚合状态（✓ 配置完整 / ？ 待配置 / ！ 存在冲突），无工程时不显示。
  const stepStates = project ? Object.fromEntries(getGuide(project, []).steps.map(step => [step.id, step.state])) : {};
  const layerStep = { app: 'application', foc: 'algorithm', hardware: 'hardware' };
  const layerState = id => stepStates[layerStep[id]] || '';
  const simCard = (cls, title, items) => `<div class="canvas-sim ${cls}"><strong>${esc(title)}${soon}</strong><span class="canvas-sim-items">${items.map(item => `<span>${esc(item)}</span>`).join('')}</span></div>`;
  // 层节点解剖：左上标题、右上状态（！？✓）、中央点阵动图。
  const chainNode = (id, extra = '') => `<a class="chain-node chain-${id}" href="#/architecture/${id}"><span class="chain-head"><strong>${LAYERS[id].name}</strong>${layerState(id) ? `<span class="chain-status">${configurationStatus({ state: layerState(id) })}</span>` : ''}</span><span class="chain-visual"><canvas class="line-field" data-mark="${id}" aria-hidden="true"></canvas></span>${extra}</a>`;
  // 链上连接：标签 + 双向轨道（单向只留右箭头）。
  const link = (label, sub = '', oneWay = false, area = '') => `<div class="canvas-link${oneWay ? ' canvas-link-one' : ''}"${area ? ` style="grid-area:${area}"` : ''} aria-hidden="true"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><i></i></div>`;
  // 物理端大图标：贴合实物（转子 / 齿轮组）。
  const physicalNode = (href, name, glyph, label) => `<a class="chain-node chain-physical" href="${href}" aria-label="${esc(label)}"><span class="chain-visual"><span class="chain-glyph">${glyph}</span></span><strong>${esc(name)}</strong></a>`;
  const motorGlyph = icon('rotor', 'chain-glyph-icon');
  const gearGlyph = icon('gear', 'chain-glyph-icon');
  // 指令源：上位机三条可选通行线（CAN / EtherCAT / Ethernet），调试器一条 J-Link；选中哪条亮哪条。
  const sourceLine = (value, label, checked = false) => `<label class="canvas-line"><input type="radio" name="canvas-source" value="${value}"${checked ? ' checked' : ''}><small>${label}</small><i></i></label>`;
  // 货架快速选择：复用配置工作台的 configuration-* 作用域，选完即应用；无工程时退回货架链接。
  const selection = project ? getConfigurationSelection(project) : null;
  const quickSelect = (scope, items, selectedId, label) => items.length || selectedId
    ? `<select class="field-select canvas-quick-select" data-edit="${scope}" aria-label="${esc(label)}"><option value="">${esc(label)}</option>${items.map(item => `<option value="${esc(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`
    : `<a href="#/equipment/${scope === 'configuration-driver' ? 'drivers' : 'actuators'}">货架 →</a>`;
  const driverPick = selection ? quickSelect('configuration-driver', project.catalog.drivers, selection.driver?.id, '选择驱动器') : '<a href="#/equipment/drivers">货架 →</a>';
  const actuatorPick = selection ? quickSelect('configuration-actuator', project.catalog.actuators, selection.actuator?.id, '选择执行器') : '<a href="#/equipment/actuators">货架 →</a>';
  return `<section class="architecture-overview lifecycle-canvas" aria-label="关节模组信号与功率链全景">
    <div class="canvas-flow">
      <div class="canvas-sims" style="grid-area:sims">${simCard('canvas-sim-signal', '数字信号仿真', ['电流环', '观测器', '滤波器', '状态机'])}${simCard('canvas-sim-hardware', '硬件仿真', ['逆变功率级', '电机电气', '采样链'])}</div>
      <div class="canvas-source-unit" style="grid-area:host" title="双击进入上位机" ondblclick="location.hash='#/project/protocol'"><span class="canvas-source-card"><strong>上位机</strong></span><span class="canvas-lines">${sourceLine('can', 'CAN', true)}${sourceLine('ethercat', 'EtherCAT')}${sourceLine('ethernet', 'Ethernet')}</span></div>
      <div class="canvas-source-unit" style="grid-area:dbg" title="双击进入调试器" ondblclick="location.hash='#/debug'"><span class="canvas-source-card"><strong>调试器</strong></span><span class="canvas-lines">${sourceLine('jlink', 'J-Link')}</span></div>
      <div class="canvas-group canvas-group-driver" style="grid-area:driver">
        <span class="canvas-group-label">${icon('board', 'canvas-group-icon')}<b>驱动器</b>${driverPick}</span>
        <div class="canvas-group-chain canvas-group-chain-layers">${chainNode('app')}${link('控制给定 / 反馈快照')}${chainNode('foc')}${link('调制提交 / 同步采样')}${chainNode('hardware', '<span class="chain-embedded"><b>PCB 设计</b></span>')}</div>
      </div>
      ${link('三相', 'U · V · W', true, 'gapD')}
      <div class="canvas-group canvas-group-actuator" style="grid-area:actuator">
        <span class="canvas-group-label"><b>执行器</b>${actuatorPick}</span>
        <div class="canvas-group-chain canvas-group-chain-physical">${physicalNode('#/equipment/actuators', '电机', motorGlyph, '电机 · 货架执行器')}${link('轴', '', true)}${physicalNode('#/equipment/actuators', '减速机', gearGlyph, '减速机 · 货架执行器')}</div>
      </div>
      <div class="canvas-dynamics" style="grid-area:dyn"><strong>动力学仿真${soon}</strong><span class="canvas-sim-items"><span>单摆</span><span>机械臂</span><span>负载等效</span></span></div>
    </div>
  </section>`;
}

function moduleLinks(modules) {
  return `<div class="dependency-links">${modules.map(module => `<a href="${architectureModuleRoute(module.id)}"><span>${esc(module.title)}</span><small class="dependency-layer">${LAYERS[module.layer].name}</small></a>`).join('')}</div>`;
}

function moduleDescription(module) {
  const dependencies = (module.dependencies || []).map(id => MODULES.find(item => item.id === id)).filter(Boolean);
  const consumers = MODULES.filter(item => item.dependencies?.includes(module.id));
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
    <div class="layer-layout layer-${id}"><section class="module-catalog" aria-label="${layer.name}的模块"><div class="layer-summary"><span>从基础到扩展，浏览模块职责</span><span>${modules.length} 个模块</span></div><div class="module-grid">${modules.map(module => `<a class="module-card${module.id === selected.id ? ' selected' : ''}" href="${architectureModuleRoute(module.id)}"${module.id === selected.id ? ' aria-current="page"' : ''}><div class="module-card-top"><span class="module-mark">${icon(MODULE_ICONS[module.id], 'module-icon')}</span><span class="module-number">${String(module.order).padStart(2, '0')}</span></div><strong class="module-title">${esc(module.title)}</strong><p class="module-summary">${esc(module.summary)}</p><div class="module-footer"><span>${esc(EXECUTION_NAMES[module.executionDomain] || '功能说明')}</span>${icon('arrow-right')}</div></a>`).join('')}</div><div class="learning-note"><strong>层级边界</strong><p>${layer.boundary}</p><a class="button small navigation-action" href="#/architecture">← 返回主页</a></div></section>
    <aside class="inspector architecture-inspector" aria-labelledby="architecture-module-title"><div class="inspector-header"><span class="eyebrow">${esc(selected.id)}</span><h2 id="architecture-module-title">${esc(selected.title)}</h2></div><div class="inspector-body">${moduleDescription(selected)}</div></aside></div></section>`;
}
