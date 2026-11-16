import { renderObserverArchitecture } from '../../modules/algorithm/foc-observer/view.mjs';
import { MODULES } from '../../modules/registry.mjs';
import { esc } from '../../shared/esc.mjs';
import { icon, LAYER_ICONS, MODULE_ICONS } from '../../shared/ui/icons.mjs';

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
const heading = (title, description) => `<div class="page-heading"><div><h1>${esc(title)}</h1><p class="page-description">${esc(description)}</p></div></div>`;

/** Architecture links always stay in the static module catalogue. */
export function architectureModuleRoute(moduleId) {
  const module = MODULES.find(item => item.id === moduleId);
  return module ? `#/architecture/${module.layer}?module=${encodeURIComponent(module.id)}` : '#/architecture';
}

function bridge(index) {
  const application = index === 1;
  const downstream = application ? '控制给定' : '调制结果';
  const upstream = application ? '反馈快照' : '同步采样';
  const label = application ? '应用 ↔ 算法：应用向下提交控制给定，算法向上返回反馈快照。' : '算法 ↔ 硬件：算法向下提交调制结果，硬件向上返回同步采样。';
  const lane = (direction, text) => `<div class="architecture-flow architecture-flow-${direction}" data-flow-direction="${direction}"><span>${text}</span><svg class="architecture-flow-line" width="16" height="68" viewBox="0 0 16 68" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><path class="architecture-flow-stem" d="M8 2V66"/><path class="architecture-flow-arrow" d="${direction === 'down' ? 'm4.5 31 3.5 4 3.5-4' : 'm4.5 37 3.5-4 3.5 4'}"/><circle cx="8" cy="2" r="2"/><circle cx="8" cy="66" r="2"/></svg></div>`;
  return `<div class="architecture-exchange" role="img" aria-label="${label}">${lane('down', downstream)}${lane('up', upstream)}</div>`;
}

/** 主页全景画布：关节模组全生命周期。中央三层为实现主线，左右挂设计与仿真，底部为生命周期带。 */
export function renderArchitectureOverview() {
  // 右侧按层挂接的仿真卫星：算法=纯数字信号仿真，应用=动力学仿真。
  const satellite = (kind, title, items, note) => `<div class="canvas-satellite canvas-satellite-${kind}" aria-label="${esc(title)}"><strong>${esc(title)}<span class="canvas-soon">规划中</span></strong><span class="canvas-satellite-items">${items.map(item => `<span>${esc(item)}</span>`).join('')}</span><small>${esc(note)}</small></div>`;
  const simApp = satellite('sim', '动力学仿真', ['单摆', '机械臂', '负载等效'], '以执行器参数驱动被控对象，闭环演练应用层策略');
  const simFoc = satellite('sim', '数字信号仿真', ['电流环', '观测器', '滤波器'], '纯数字信号注入，验证算法层的离散域行为');
  const pcbCard = `<a class="canvas-satellite canvas-satellite-pcb" href="#/architecture/hardware" aria-label="PCBA 设计"><strong>PCBA 设计<span class="canvas-soon">规划中</span></strong><span class="canvas-satellite-items"><span>原理约束</span><span>引脚网表</span><span>功率与预驱</span></span><small>从硬件配置生成设计输入，软硬同源</small></a>`;
  const simHardware = `<div class="canvas-satellite canvas-satellite-sim" aria-label="硬件仿真"><strong>硬件仿真<span class="canvas-soon">规划中</span></strong><span class="canvas-satellite-items"><span>逆变功率级</span><span>电机电气</span><span>采样链</span></span><small>在宿主机运行生成代码，模拟硬件边界</small></div>`;
  const spine = (id, extra = '') => `<a class="layer-entry layer-${id}" href="#/architecture/${id}"><span class="layer-order">${icon(LAYER_ICONS[id], 'layer-order-icon')}<small>${LAYERS[id].code}</small></span><span class="layer-main"><strong>${LAYERS[id].name}</strong><span>${LAYERS[id].summary}</span><span class="layer-capabilities">${layerModules(id).map(module => `<span>${esc(module.title)}</span>`).join('')}</span></span><canvas class="line-field" data-mark="${id}" aria-hidden="true"></canvas><span class="layer-meta"><strong>${layerModules(id).length} 个模块</strong><span>查看功能</span></span>${icon('arrow-right', 'entry-arrow')}</a>${extra}`;
  // 生命周期带：从选型到维护，全部指向既有页面。
  const lifecycle = [['选型', '货架 · 执行器与驱动', '#/equipment'], ['烧录', '双核镜像烧写', '#/project/flash'], ['校准', '编码器与摩擦辨识', '#/project/application?module=app-calibration&tab=config'], ['测试', '台架测量记录', '#/performance'], ['上位机', '通信协议与解析', '#/project/protocol'], ['调试器', 'J-Link 实时监控', '#/debug'], ['维护', '错误码与版本', '#/project/faults']].map(([title, note, href]) => `<a class="canvas-stage" href="${href}"><strong>${esc(title)}</strong><small>${esc(note)}</small></a>`).join('<span class="canvas-stage-arrow" aria-hidden="true">→</span>');
  return `<section class="architecture-overview lifecycle-canvas" aria-label="关节模组全生命周期导航">
    <div class="canvas-spine">
      <div class="canvas-row">${spine('app', simApp)}</div>
      ${bridge(1)}
      <div class="canvas-row">${spine('foc', simFoc)}</div>
      ${bridge(2)}
      <div class="canvas-row canvas-row-hardware">${pcbCard}${spine('hardware')}${simHardware}</div>
    </div>
    <div class="canvas-lifecycle" aria-label="生命周期">${lifecycle}</div>
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
  return `<section class="architecture-layer"><div class="breadcrumbs"><a href="#/architecture">架构</a><span>/</span><span>${layer.name}</span></div>${heading(layer.name, layer.summary)}
    <div class="layer-layout layer-${id}"><section class="module-catalog" aria-label="${layer.name}的模块"><div class="layer-summary"><span>从基础到扩展，浏览模块职责</span><span>${modules.length} 个模块</span></div><div class="module-grid">${modules.map(module => `<a class="module-card${module.id === selected.id ? ' selected' : ''}" href="${architectureModuleRoute(module.id)}"${module.id === selected.id ? ' aria-current="page"' : ''}><div class="module-card-top"><span class="module-mark">${icon(MODULE_ICONS[module.id], 'module-icon')}</span><span class="module-number">${String(module.order).padStart(2, '0')}</span></div><strong class="module-title">${esc(module.title)}</strong><p class="module-summary">${esc(module.summary)}</p><div class="module-footer"><span>${esc(EXECUTION_NAMES[module.executionDomain] || '功能说明')}</span>${icon('arrow-right')}</div></a>`).join('')}</div><div class="learning-note"><strong>层级边界</strong><p>${layer.boundary}</p><a class="button small navigation-action" href="#/architecture">← 返回架构</a></div></section>
    <aside class="inspector architecture-inspector" aria-labelledby="architecture-module-title"><div class="inspector-header"><span class="eyebrow">${esc(selected.id)}</span><h2 id="architecture-module-title">${esc(selected.title)}</h2></div><div class="inspector-body">${moduleDescription(selected)}</div></aside></div></section>`;
}
