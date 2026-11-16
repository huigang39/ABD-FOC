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

/** Static, read-only architecture; no configuration instance is accepted. */
export function renderArchitectureOverview() {
  return `<section class="architecture-overview">${heading('架构', '浏览三层职责、功能模块与数据关系。')}
    <div class="overview">${ORDER.map((id, index) => {
      const layer = LAYERS[id];
      return `${index ? bridge(index) : ''}<a class="layer-entry layer-${id}" href="#/architecture/${id}"><span class="layer-order">${icon(LAYER_ICONS[id], 'layer-order-icon')}<small>${layer.code}</small></span><span class="layer-main"><strong>${layer.name}</strong><span>${layer.summary}</span><span class="layer-capabilities">${layerModules(id).map(module => `<span>${esc(module.title)}</span>`).join('')}</span></span><canvas class="line-field" data-mark="${id}" aria-hidden="true"></canvas><span class="layer-meta"><strong>${layerModules(id).length} 个模块</strong><span>查看功能</span></span>${icon('arrow-right', 'entry-arrow')}</a>`;
    }).join('')}</div>
    <div class="overview-details architecture-principles">
      <details class="panel overview-contracts"><summary>层间接口与数据</summary><div class="overview-facts">
        <article><h3>应用 ↔ 算法</h3><div class="feedback-map"><div><strong>↓ 控制给定</strong><span>目标、动态限值、序号与有效期</span></div><div><strong>↑ 反馈快照</strong><span>控制状态、测量反馈与故障摘要</span></div></div><p>应用任务处理位置、速度和力矩策略；电流环与观测器在同一控制周期内更新。</p></article>
        <article><h3>算法 ↔ 硬件</h3><div class="feedback-map"><div><strong>↑ 同步采样</strong><span>采样值、时间戳、有效性与实际输出状态</span></div><div><strong>↓ 调制提交</strong><span>占空比、输出许可与更新序号</span></div></div><p>算法产生调制结果，硬件在约定的定时器边界更新输出。</p></article>
      </div><div class="architecture-role-strip"><div><strong>输入</strong><span>接收其他模块提供的数据</span></div><div><strong>输出</strong><span>发布本模块的处理结果</span></div><div><strong>状态</strong><span>保留模块内部的跨周期数据</span></div></div><p class="design-note">每个模块拥有输入、输出、状态三个结构体；层间交换连接输出与输入，状态由模块自身维护。</p></details>
      <details class="panel overview-contracts"><summary>反馈来源与持久化数据</summary><div class="overview-facts">
        <article><h3>三类反馈</h3><div class="feedback-map"><div><strong>电机侧编码器</strong><span>转子角度与换相依据</span></div><div><strong>出轴侧编码器</strong><span>输出轴机械位置</span></div><div><strong>力矩传感器</strong><span>负载力矩测量</span></div></div><p>反馈保留来源、时间戳与有效性，测量值与估算值分别表达。</p></article>
        <article><h3>三类存储数据</h3><div class="feedback-map"><div><strong>校准</strong><span>编码器校准、摩擦辨识结果</span></div><div><strong>参数</strong><span>参数列表、出轴标零、力矩标零</span></div><div><strong>日志</strong><span>故障记录、掉电数据与事件</span></div></div><p>应用管理数据的提交与恢复，硬件提供存储服务；Flash 擦写不阻塞电流环。</p></article>
      </div></details>
    </div></section>`;
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
