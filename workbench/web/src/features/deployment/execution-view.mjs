import { MODULES } from '../../core/catalog.mjs';
import { getMcuCores } from './mcu.mjs';
import { createExecutionPlan, moduleCore } from './execution.mjs';
import { edit, esc } from '../configuration/view.mjs';
import { icon } from '../../shared/ui/icons.mjs';

const layers = [['hardware','硬件'],['foc','算法'],['app','应用']];
const address = value => value === null ? '' : Number.isSafeInteger(value) && value >= 0 ? `0x${value.toString(16).toUpperCase().padStart(8,'0')}` : String(value);
const choicesFor = (cores, current = '') => [['','待分配'],...cores.map(core=>[core.id,core.label]),...(current&&!cores.some(core=>core.id===current)?[[current,`${current} · 当前硬件不可用`]]:[])];

export function renderExecution(project, { embedded = false } = {}) {
  const cores = getMcuCores(project.target.mcu);
  const plan = project.execution || createExecutionPlan();
  const panelClass = embedded ? 'execution-planner deployment-embedded' : 'panel';
  if (!cores.length) return `<section class="${panelClass}"${embedded?' aria-label="内核运行"':''}>${embedded?'':'<h2>内核运行</h2>'}<p class="design-note">${project.target.mcu?'当前型号的内核信息尚未收录。':'先选择 MCU，再分配模块的执行内核。'}</p>${embedded?'':'<a class="button small navigation-action" href="#/project/hardware?module=hw-platform&tab=config">选择 MCU →</a>'}</section>`;
  if (cores.length === 1) return `<section class="${panelClass}"${embedded?' aria-label="内核运行"':''}>${embedded?'':'<div class="design-toolbar"><h2>内核运行</h2><span class="status-pill neutral">单核</span></div>'}<p class="design-note">${esc(cores[0].label)} · 已包含的模块自动使用该内核。</p>${Object.values(plan.assignments).some(Boolean)||plan.mcu?'<button class="button small" data-action="execution-reset">清除之前的内核分配</button>':''}</section>`;
  return `<section class="${embedded?panelClass:'panel execution-planner'}"${embedded?' aria-label="内核运行"':''}>${embedded?'':'<div class="design-toolbar"><h2>内核运行</h2><span class="status-pill neutral">'+cores.length+' 个内核</span></div><p class="design-note">模块的层级与执行内核分别配置。同步采样、电流环、观测器和电流环保护保持同核；应用任务可放到另一个内核。</p>'}
    <div class="core-overview">${cores.map(core=>{const list=MODULES.filter(module=>project.instances[module.id].enabled&&moduleCore(project,module.id)===core.id);return `<article class="core-card"><strong>${icon('chip')}${esc(core.label)}</strong><small>${list.length} 个模块</small><p>${list.length?list.map(module=>esc(module.title)).join(' · '):'尚未分配模块'}</p></article>`;}).join('')}</div>
    <div class="design-meta">${edit('启动协调核',plan.bootCore,'execution','bootCore',{choices:choicesFor(cores,plan.bootCore),description:'负责共享时钟、资源初始化及另一内核的启动协调。每个内核仍需要自己的启动代码。'})}<div class="form-field"><span class="field-label">分配所依据的 MCU</span><output class="computed-field">${esc(plan.mcu||'尚未分配')}</output>${plan.mcu&&plan.mcu.trim().toUpperCase()!==project.target.mcu.trim().toUpperCase()?'<button class="link-button" data-action="execution-rebind">保留分配并确认当前 MCU</button>':''}</div></div>
    <div class="core-module-grid">${layers.map(([id,name])=>`<section class="core-module-group layer-${id}"><h3>${esc(name)}</h3>${MODULES.filter(module=>module.layer===id).map(module=>`<div class="core-module-row"><span>${esc(module.title)}${!project.instances[module.id].enabled?'<small>编译期排除 · 保留分配</small>':''}</span>${edit(`${module.title}执行内核`,plan.assignments[module.id]||'','execution-module','core',{id:module.id,choices:choicesFor(cores,plan.assignments[module.id])})}</div>`).join('')}</section>`).join('')}</div>
    <details class="core-ipc" data-state-key="execution-ipc" open><summary>跨核数据交换</summary><p class="design-note">跨核连接通过共享内存交接数据。硬件信号量负责同步，缓存一致性需要单独设置；输入与输出结构不能直接作为跨核指针传递。</p><div class="profile-form">
      ${edit('数据通道',plan.ipc.transport,'execution-ipc','transport',{choices:[['unselected','待选择'],['shared_memory','共享内存']]})}
      ${edit('同步与通知',plan.ipc.notification,'execution-ipc','notification',{choices:[['unselected','待选择'],['hsem','硬件信号量（HSEM）'],['polling','轮询状态']]})}
      ${edit('缓存一致性',plan.ipc.cachePolicy,'execution-ipc','cachePolicy',{choices:[['unselected','待选择'],['noncacheable','共享区设为不可缓存'],['maintenance','显式清理与失效缓存']]})}
      ${edit('共享区起始地址',address(plan.ipc.sharedAddress),'execution-ipc','sharedAddress',{type:'address',description:'支持十六进制或十进制；需为两个内核均可访问的 RAM。'})}
      ${edit('共享区容量',plan.ipc.sharedSizeKiB,'execution-ipc','sharedSizeKiB',{type:'number',unit:'KiB',description:'包括快照、队列和同步信息，需与实际结构体大小核对。'})}
    </div><p class="design-note">启动、核间通信及各核镜像由对应平台适配实现，构建检查会核对当前分工是否已支持。</p></details></section>`;
}

export function renderExecutionSummary(project) {
  const cores=getMcuCores(project.target.mcu);
  const count=MODULES.filter(module=>project.instances[module.id].enabled&&!moduleCore(project,module.id)).length;
  return cores.length ? `${cores.map(core=>esc(core.label)).join(' + ')}${count?` · ${count} 个模块待分配`:''}` : '内核信息待确定';
}
