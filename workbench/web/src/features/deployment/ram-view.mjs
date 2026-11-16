import { edit, esc } from '../configuration/view.mjs';
import { issueNoticeButton } from '../../shared/ui/issue-notices.mjs';
import { icon } from '../../shared/ui/icons.mjs';
import { getMcuCores, identifyMcu } from './mcu.mjs';
import { createRamPlan } from './ram.mjs';

const USES = [['code', '代码'], ['data', '数据'], ['stack', '栈'], ['heap', '堆'], ['shared', '共享数据'], ['dma', 'DMA 缓冲区']];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const size = value => finite(value) ? `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value)} KiB` : '—';
const hex = value => Number.isSafeInteger(value) && value >= 0 ? `0x${value.toString(16).toUpperCase().padStart(8, '0')}` : '—';
const addressInput = value => value == null ? '' : Number.isSafeInteger(value) && value >= 0 ? hex(value) : String(value);
const nameOf = (bank, index = 0) => bank.name?.trim() || `RAM 区域 ${index + 1}`;
const button = (label, action, { id = '', disabled = false, symbol = '', quiet = false } = {}) => `<button type="button" class="button small${quiet ? ' quiet' : ''}" data-action="${esc(action)}" data-id="${esc(id)}"${disabled ? ' disabled' : ''}>${symbol ? icon(symbol) : ''}${esc(label)}</button>`;

function range(bank, offsetKiB = 0, sizeKiB = bank?.sizeKiB) {
  const start = bank && finite(offsetKiB) && Number.isSafeInteger(bank.baseAddress) ? bank.baseAddress + offsetKiB * 1024 : null;
  const end = finite(start) && finite(sizeKiB) ? start + sizeKiB * 1024 : null;
  return Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(end) && end > start ? `${hex(start)} – ${hex(end - 1)}` : '—';
}

function renderCapacity(bank, index, placements) {
  const assigned = placements.filter(item => item.bankId === bank.id);
  const known = assigned.filter(item => finite(item.sizeKiB) && item.sizeKiB > 0);
  const budget = known.reduce((total, item) => total + item.sizeKiB, 0);
  const unknown = assigned.length - known.length;
  const capacityKnown = finite(bank.sizeKiB) && bank.sizeKiB > 0;
  const percent = capacityKnown ? Math.min(100, Math.max(0, budget / bank.sizeKiB * 100)) : null;
  const label = `${nameOf(bank, index)}，已规划 ${size(budget)}，区域容量 ${size(bank.sizeKiB)}${unknown ? `，${unknown} 项预算待填写` : ''}`;
  return `<article class="ram-capacity" data-live="ram-capacity-${esc(bank.id)}">
    <div class="ram-capacity-heading"><strong>${esc(nameOf(bank, index))}</strong><span>${size(bank.sizeKiB)}</span></div>
    ${percent !== null ? `<div class="ram-capacity-track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${esc(label)}"><span style="width:${percent}%"></span></div>` : '<div class="ram-capacity-track ram-capacity-unknown" aria-label="区域容量待填写"></div>'}
    <div class="ram-capacity-caption"><span>已规划 ${size(budget)}</span><span>${assigned.length} 项分配${unknown ? ` · ${unknown} 项预算待填写` : ''}</span></div>
    <code>${esc(range(bank))}</code>
  </article>`;
}

function renderCoreAccess(bank, cores) {
  const entries = [...cores, ...bank.cores.filter(id => !cores.some(core => core.id === id)).map(id => ({ id, label: id }))];
  return `<div class="ram-core-access" role="group" aria-label="${esc(nameOf(bank))}可访问内核">${entries.length ? entries.map(core => edit(core.label, bank.cores.includes(core.id), 'ram-bank', 'cores', { id: bank.id, child: core.id, type: 'boolean' })).join('') : '<span class="ram-field-note">内核列表随 MCU 型号确定</span>'}</div>`;
}

function renderBankTable(plan, cores) {
  return `<div class="ram-table-wrap"><table class="contract-table ram-bank-table"><thead><tr><th scope="col">区域名称</th><th scope="col">起始地址</th><th scope="col">容量（KiB）</th><th scope="col">代码</th><th scope="col">内核访问</th><th scope="col">DMA</th><th scope="col">操作</th></tr></thead><tbody>${plan.banks.map((bank, index) => {
    const key = { id: bank.id };
    return `<tr>
      <td>${edit('区域名称', bank.name, 'ram-bank', 'name', key)}</td>
      <td>${edit(`${nameOf(bank, index)}起始地址`, addressInput(bank.baseAddress), 'ram-bank', 'baseAddress', { ...key, type: 'address' })}</td>
      <td>${edit(`${nameOf(bank, index)}容量（KiB）`, bank.sizeKiB, 'ram-bank', 'sizeKiB', { ...key, type: 'number' })}</td>
      <td>${edit('可执行', bank.executable, 'ram-bank', 'executable', { ...key, type: 'boolean' })}</td>
      <td>${renderCoreAccess(bank, cores)}</td>
      <td>${edit('可访问', bank.dma, 'ram-bank', 'dma', { ...key, type: 'boolean' })}</td>
      <td>${button('移除', 'ram-remove-bank', { id: bank.id, quiet: true, symbol: 'trash' })}</td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderPlacement(placement, plan, flashBanks, cores) {
  const bank = plan.banks.find(item => item.id === placement.bankId);
  const key = { id: placement.id };
  const loaded = placement.kind === 'code' || placement.kind === 'data';
  const initialized = placement.kind === 'data';
  const retainedSource = flashBanks.find(item => item.id === placement.loadBankId);
  const useName = USES.find(([id]) => id === placement.kind)?.[1] || placement.kind;
  const incomplete = !placement.bankId || !finite(placement.offsetKiB) || !finite(placement.sizeKiB);
  return `<details class="ram-placement" data-state-key="ram-placement-${esc(placement.id)}"${incomplete ? ' open' : ''}>
    <summary><span><strong data-live="ram-placement-title-${esc(placement.id)}">${esc(placement.name || '新分配')}</strong><small>${esc(useName)}</small></span><span class="ram-placement-meta" data-live="ram-placement-summary-${esc(placement.id)}">${bank ? esc(nameOf(bank)) : '运行位置待填写'} · ${size(placement.sizeKiB)}</span></summary>
    <div class="ram-placement-body"><div class="ram-placement-fields">
      ${edit('分配名称', placement.name, 'ram-placement', 'name', key)}
      ${edit('用途', placement.kind, 'ram-placement', 'kind', { ...key, choices: USES })}
      ${edit('运行区域', placement.bankId, 'ram-placement', 'bankId', { ...key, choices: plan.banks.map((item, index) => [item.id, nameOf(item, index)]) })}
      ${edit('区域内偏移', placement.offsetKiB, 'ram-placement', 'offsetKiB', { ...key, type: 'number', unit: 'KiB' })}
      ${edit('容量预算', placement.sizeKiB, 'ram-placement', 'sizeKiB', { ...key, type: 'number', unit: 'KiB' })}
      ${edit('所属内核', placement.coreId, 'ram-placement', 'coreId', { ...key, choices: cores.map(core => [core.id, core.label]), description: placement.kind === 'shared' ? '填写共享区的管理内核，访问能力由区域配置决定。' : '' })}
    </div>
    ${loaded ? `<div class="ram-load-source"><div>${edit(initialized ? 'Flash 加载源（有初值时填写）' : 'Flash 加载源', placement.loadBankId, 'ram-placement', 'loadBankId', { ...key, choices: flashBanks.map((item, index) => [item.id, item.name?.trim() || `Flash ${index + 1}`]) })}</div>${placement.loadBankId ? button('清除加载源', 'ram-clear-load-source', { id: placement.id, quiet: true }) : ''}<p>加载地址是镜像在 Flash 中的存储位置，运行地址是启动后在 RAM 中的位置。${initialized ? '零初始化数据可不指定加载源。' : '启动代码需将代码从加载源复制到运行位置。'}</p></div>` : placement.loadBankId ? `<div class="ram-load-source"><div><span class="field-label">保留的 Flash 加载源</span><output class="ram-source-value">${esc(retainedSource?.name?.trim() || placement.loadBankId)}</output></div>${button('清除加载源', 'ram-clear-load-source', { id: placement.id, quiet: true })}</div>` : ''}
    <div class="ram-placement-footer"><span>运行地址 <code data-live="ram-placement-range-${esc(placement.id)}">${esc(range(bank, placement.offsetKiB, placement.sizeKiB))}</code></span>${button('移除分配', 'ram-remove-placement', { id: placement.id, quiet: true, symbol: 'trash' })}</div>
    </div>
  </details>`;
}

/** Editable runtime memory planning; validation feedback uses the shared issue dialog. */
export function renderRam(project, issues = []) {
  const plan = project.memory?.ram || createRamPlan();
  const cores = getMcuCores(project.target?.mcu);
  const mcu = project.target?.mcu?.trim() || '';
  const ready = Boolean(mcu);
  const occupied = plan.banks.length > 0 || plan.placements.length > 0;
  const mismatch = occupied && (plan.mcu || '').trim().toUpperCase() !== mcu.toUpperCase();
  const preset = identifyMcu(mcu)?.prefix === 'STM32H745' && !occupied;
  const relevant = issues.filter(issue => issue.id.startsWith('ram-'));
  const flashBanks = project.memory?.layout?.banks || [];
  return `<section class="ram-workspace" aria-labelledby="ram-heading">
    <div class="ram-section-heading"><div><h2 id="ram-heading">RAM</h2><p>定义 RAM 区域及访问能力，再为代码、数据与运行空间分配位置。</p></div><div class="ram-actions">${preset ? button('使用 STM32H745 区域表', 'ram-preset', { symbol: 'chip' }) : ''}${button('新增 RAM 区域', 'ram-add-bank', { symbol: 'plus', disabled: !ready })}</div></div>
    ${!ready ? '<p class="design-note">先<a href="#/project/hardware?module=hw-platform&tab=config">选择 MCU</a>，再配置 RAM。</p>' : mismatch ? `<div class="ram-binding"><span>区域表依据：${esc(plan.mcu || '尚未绑定')} · 当前 MCU：${esc(mcu)}</span>${button('确认用于当前 MCU', 'ram-rebind')}</div>` : ''}
    <fieldset class="ram-editing"${ready ? '' : ' disabled'}><legend class="visually-hidden">RAM 配置</legend>
      ${plan.banks.length ? `<div class="ram-capacity-grid" data-live="ram-capacity-list">${plan.banks.map((bank, index) => renderCapacity(bank, index, plan.placements)).join('')}</div><details class="ram-geometry" data-state-key="ram-geometry"${plan.banks.some(bank => bank.baseAddress == null || bank.sizeKiB == null) ? ' open' : ''}><summary><strong>RAM 区域表</strong><span>${plan.banks.length} 个区域</span></summary><div class="ram-geometry-body"><p class="design-note">地址支持十六进制 0x… 或十进制；内核与 DMA 的访问能力按芯片手册和实际通路填写。</p>${renderBankTable(plan, cores)}</div></details>` : `<div class="ram-empty">${icon('database')}<h3>定义可用的 RAM</h3><p>${preset ? '可使用已核实的 STM32H745 区域表，再按用途分配；预设不会自动占用任何区域。' : '按 MCU 手册录入区域名称、起始地址、容量和访问能力。'}</p></div>`}
      <section class="ram-assignments"><div class="ram-section-heading"><div><h3>用途分配</h3><p>偏移从所选运行区域起始地址计算，容量按用途单独预留。</p></div>${button('新增分配', 'ram-add-placement', { symbol: 'plus', disabled: !ready || !plan.banks.length })}</div>
        ${plan.placements.length ? plan.placements.map(item => renderPlacement(item, plan, flashBanks, cores)).join('') : '<p class="ram-empty-assignments">按需要添加代码、数据、栈、堆、共享数据或 DMA 缓冲区。</p>'}
      </section>
    </fieldset>
    <div class="ram-footer"><p>规划代码和数据的运行地址；实际占用与地址以构建结果为准。当前固件模板使用固定布局，自定义分配尚未映射到链接脚本。进度条表示已规划预算，未分配的容量不代表固件实际空闲空间。</p><div class="ram-actions"><div data-live="ram-issues">${issueNoticeButton(relevant, { label: '查看 RAM 检查' })}</div>${project.memory?.ram ? button('使用默认 RAM 布局', 'ram-reset', { quiet: true }) : ''}</div></div>
  </section>`;
}
