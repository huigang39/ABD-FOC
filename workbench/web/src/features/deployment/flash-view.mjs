import { edit, esc } from '../configuration/view.mjs';
import { issueNoticeButton } from '../../shared/ui/issue-notices.mjs';
import { icon } from '../../shared/ui/icons.mjs';
import { MEMORY_REGIONS, createMemoryPlan, getMemoryRegion } from './flash.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const formatSize = value => finite(value) ? `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value)} KiB` : '待填写';
const hex = value => Number.isSafeInteger(value) && value >= 0 ? `0x${value.toString(16).toUpperCase().padStart(8, '0')}` : '—';
const sectorName = (sector, index) => sector.name.trim() || `扇区 ${index}`;
const bankName = (bank, index = 0) => bank.name.trim() || `Flash ${index + 1}`;
const addressInput = value => value === null ? '' : Number.isSafeInteger(value) && value >= 0 ? hex(value) : String(value);
const storageLink = '#/project/application?module=app-params&tab=config';
const button = (label, action, { id = '', child = '', symbol = '', disabled = false, quiet = false } = {}) => `<button type="button" class="button small${quiet ? ' quiet' : ''}" data-action="${esc(action)}" data-id="${esc(id)}" data-child="${esc(child)}"${disabled ? ' disabled' : ''}>${symbol ? icon(symbol) : ''}${esc(label)}</button>`;

function bankRange(bank) {
  const end = finite(bank.baseAddress) && finite(bank.sizeKiB) ? bank.baseAddress + bank.sizeKiB * 1024 : null;
  return Number.isSafeInteger(bank.baseAddress) && bank.baseAddress >= 0 && Number.isSafeInteger(end) && end > bank.baseAddress
    ? `${hex(bank.baseAddress)} – ${hex(end - 1)}` : '地址范围待填写';
}

function owners(plan, bankId, sectorId) {
  return MEMORY_REGIONS.filter(region => {
    const placement = plan.placements[region.id];
    return placement?.bankId === bankId && placement.sectorIds.includes(sectorId);
  });
}

function sectorState(plan, bank, sector) {
  const assigned = owners(plan, bank.id, sector.id);
  const conflict = assigned.length > 1 || (sector.reserved && assigned.length > 0);
  return {
    assigned,
    tone: conflict ? 'conflict' : sector.reserved ? 'reserved' : assigned[0]?.id || 'free',
    label: conflict ? `冲突 · ${assigned.map(region => region.label).join(' / ')}` : sector.reserved ? '保留' : assigned[0]?.label || '空闲',
  };
}

function renderBankMap(plan, bank, index) {
  const total = bank.sizeKiB;
  const drawable = finite(total) && total > 0;
  const sectors = drawable ? bank.sectors.filter(sector => finite(sector.offsetKiB) && sector.offsetKiB >= 0 && finite(sector.sizeKiB) && sector.sizeKiB > 0) : [];
  return `<article class="memory-map-bank"><div class="memory-map-heading"><strong>${esc(bankName(bank, index))}</strong><span>${formatSize(total)} · ${bank.sectors.length} 个扇区</span></div>
    ${drawable && sectors.length ? `<div class="memory-map-track" role="img" aria-label="${esc(bankName(bank, index))}扇区占用，详细分配见下方列表">${sectors.map(sector => {
      const state = sectorState(plan, bank, sector);
      const left = Math.min(100, sector.offsetKiB / total * 100);
      const width = Math.min(100 - left, sector.sizeKiB / total * 100);
      const name = sectorName(sector, bank.sectors.indexOf(sector));
      return `<span class="memory-map-sector memory-tone-${state.tone}" style="left:${left}%;width:${Math.max(0, width)}%" title="${esc(`${name} · ${formatSize(sector.sizeKiB)} · ${state.label}`)}">${width >= 8 ? `<span>${esc(state.label)}</span>` : ''}</span>`;
    }).join('')}</div>` : '<div class="memory-map-empty">填写 Flash 容量和扇区表后显示分布</div>'}
    <div class="memory-map-addresses"><code>${hex(bank.baseAddress)}</code><code>${drawable && Number.isSafeInteger(bank.baseAddress) ? hex(bank.baseAddress + total * 1024 - 1) : '—'}</code></div>
  </article>`;
}

function renderBankEditor(bank, index, sectorSizes) {
  const key = { id: bank.id };
  const total = bank.sectors.every(sector => finite(sector.sizeKiB) && sector.sizeKiB > 0) ? bank.sectors.reduce((sum, sector) => sum + sector.sizeKiB, 0) : null;
  return `<details class="memory-bank-editor" data-state-key="memory-bank-${esc(bank.id)}"${bank.sectors.length ? '' : ' open'}>
    <summary><span data-live="memory-bank-title-${esc(bank.id)}">${icon('chip')}<strong>${esc(bankName(bank, index))}</strong></span><small data-live="memory-bank-summary-${esc(bank.id)}">${bank.sectors.length} 个扇区 · ${formatSize(bank.sizeKiB)}</small></summary>
    <div class="memory-bank-body"><div class="memory-bank-fields">
      ${edit('Flash 名称', bank.name, 'memory-bank', 'name', key)}
      ${edit('起始地址', addressInput(bank.baseAddress), 'memory-bank', 'baseAddress', { ...key, type: 'address', description: '支持十六进制 0x… 或十进制地址' })}
      ${edit('容量', bank.sizeKiB, 'memory-bank', 'sizeKiB', { ...key, type: 'number', unit: 'KiB' })}
      ${edit('可执行代码', bank.executable, 'memory-bank', 'executable', { ...key, type: 'boolean' })}
    </div><p class="design-note">每一行对应硬件实际的最小擦除扇区，偏移相对于本区域起始地址。Bootloader、升级暂存等占用的扇区可标记为保留。</p>
    ${!bank.sectors.length ? `<div class="memory-generator"><div>${edit('均匀扇区大小', sectorSizes[bank.id] ?? '', 'memory-generator', 'eraseKiB', { id: bank.id, type: 'number', unit: 'KiB' })}</div>${button('生成扇区表', 'memory-generate-sectors', { id: bank.id, symbol: 'plus' })}<p>适用于每个擦除扇区大小相同的 Flash；不同大小的扇区请逐项添加。</p></div>` : ''}
    ${bank.sectors.length ? `<div class="memory-sector-table-wrap"><table class="contract-table memory-sector-table"><thead><tr><th scope="col">扇区</th><th scope="col">偏移（KiB）</th><th scope="col">大小（KiB）</th><th scope="col">用途</th><th scope="col">操作</th></tr></thead><tbody>${bank.sectors.map((sector, sectorIndex) => {
      const meta = { id: bank.id, child: sector.id };
      return `<tr><td>${edit(`扇区 ${sectorIndex} 名称`, sector.name, 'memory-sector', 'name', meta)}</td><td>${edit(`${sectorName(sector, sectorIndex)}偏移（KiB）`, sector.offsetKiB, 'memory-sector', 'offsetKiB', { ...meta, type: 'number' })}</td><td>${edit(`${sectorName(sector, sectorIndex)}大小（KiB）`, sector.sizeKiB, 'memory-sector', 'sizeKiB', { ...meta, type: 'number' })}</td><td>${edit('保留', sector.reserved, 'memory-sector', 'reserved', { ...meta, type: 'boolean' })}</td><td>${button('移除', 'memory-remove-sector', { ...meta, symbol: 'trash', quiet: true })}</td></tr>`;
    }).join('')}</tbody></table></div>` : ''}
    <div class="memory-bank-footer"><span data-live="memory-bank-range-${esc(bank.id)}">${esc(bankRange(bank))}${bank.sectors.length ? ` · 扇区合计 ${formatSize(total)}` : ''}</span><div>${button('添加扇区', 'memory-add-sector', { id: bank.id, symbol: 'plus', disabled: bank.sectors.length >= 4096 })}${button('移除 Flash', 'memory-remove-bank', { id: bank.id, symbol: 'trash', quiet: true })}</div></div>
  </div></details>`;
}

function renderSectorChoices(plan, region, bank, placement) {
  const sectorIds = placement?.sectorIds || [];
  const missing = sectorIds.filter(id => !bank?.sectors.some(sector => sector.id === id));
  const choices = bank?.sectors || [];
  if (!choices.length && !missing.length) return `<p class="memory-assignment-empty">${bank ? '先在扇区表中添加实际擦除扇区。' : '选择 Flash 后分配扇区。'}</p>`;
  return `<div class="memory-sector-choices" role="group" aria-label="${esc(region.label)}扇区选择">${choices.map((sector, index) => {
    const selected = sectorIds.includes(sector.id);
    const state = sectorState(plan, bank, sector);
    const other = state.assigned.filter(owner => owner.id !== region.id);
    const blocked = !selected && (sector.reserved || other.length > 0);
    const label = sector.reserved ? '保留' : other.length ? `已分配给${other.map(owner => owner.label).join('、')}` : selected ? '已选择' : '可分配';
    return `<label class="memory-sector-choice${selected ? ' selected' : ''}${blocked ? ' unavailable' : ''}${selected && (sector.reserved || other.length) ? ' conflict' : ''}"><input type="checkbox" data-edit="memory-assignment" data-id="${esc(region.id)}" data-child="${esc(sector.id)}" data-value-type="boolean" aria-label="${esc(`${region.label} · ${sectorName(sector, index)}`)}"${selected ? ' checked' : ''}${blocked ? ' disabled' : ''}><span data-live="memory-choice-${esc(region.id)}-${esc(bank.id)}-${esc(sector.id)}"><strong>${esc(sectorName(sector, index))}</strong><small>${formatSize(sector.sizeKiB)} · ${esc(label)}</small></span></label>`;
  }).join('')}${missing.map(id => `<label class="memory-sector-choice conflict selected"><input type="checkbox" data-edit="memory-assignment" data-id="${esc(region.id)}" data-child="${esc(id)}" data-value-type="boolean" checked aria-label="移除${esc(region.label)}中已不存在的扇区引用"><span><strong>扇区已不存在</strong><small>${esc(id)} · 取消勾选以移除引用</small></span></label>`).join('')}</div>`;
}

function renderRegion(project, plan, region) {
  const state = getMemoryRegion({ ...project, memory: plan }, region.id);
  const { bank, placement, capacityKiB, requiredKiB, startAddress, endAddress } = state;
  const choices = [['', '选择 Flash'], ...plan.layout.banks.map((item, index) => [item.id, bankName(item, index)])];
  if (placement.bankId && !bank) choices.push([placement.bankId, '所选 Flash 已不存在', true]);
  const selectedCount = placement.sectorIds.length;
  const tooSmall = finite(requiredKiB) && finite(capacityKiB) && capacityKiB < requiredKiB;
  const range = startAddress !== null && endAddress !== null ? `${hex(startAddress)} – ${hex(endAddress - 1)}` : selectedCount ? '地址范围待核对' : '尚未分配扇区';
  return `<article class="memory-region memory-tone-${region.id}"><div class="memory-region-heading"><h3><i class="memory-swatch" aria-hidden="true"></i>${esc(region.label)}</h3><span data-live="memory-region-count-${esc(region.id)}">${selectedCount ? `${selectedCount} 个扇区` : '未分配'}</span></div>
    <div class="memory-region-fields">${edit('存储位置', placement.bankId, 'memory-placement', 'bankId', { id: region.id, choices })}
    ${region.kind === 'firmware' ? edit('固件预算', placement.budgetKiB, 'memory-placement', 'budgetKiB', { id: region.id, type: 'number', unit: 'KiB' }) : `<div class="form-field design-field"><span class="field-label">数据区容量需求</span><div class="memory-data-budget" data-live="memory-data-budget-${esc(region.id)}"><strong>${formatSize(requiredKiB)}</strong><a href="${storageLink}">调整</a></div></div>`}</div>
    ${renderSectorChoices(plan, region, bank, placement)}
    <div class="memory-region-result${tooSmall ? ' error' : ''}" data-live="memory-region-result-${esc(region.id)}"><span>已分配 <strong>${capacityKiB === null ? (selectedCount ? '待核对' : '—') : formatSize(capacityKiB)}</strong>${tooSmall ? ' · 容量不足' : ''}</span><code>${esc(range)}</code></div>
  </article>`;
}

/** Flash geometry and placement only. The containing page owns core deployment. */
export function renderMemory(project, issues = [], { sectorSizes = {} } = {}) {
  const plan = project.memory || createMemoryPlan();
  const { layout } = plan;
  const ready = Boolean(project.target?.mcu?.trim());
  const mismatch = layout.banks.length > 0 && (layout.mcu.trim().toUpperCase() !== (project.target?.mcu || '').trim().toUpperCase() || layout.board.trim() !== (project.target?.board || '').trim());
  const relevant = issues.filter(issue => issue.id.startsWith('memory-'));
  const target = [project.target?.mcu, project.target?.board].filter(Boolean).join(' · ');
  return `<section class="memory-workspace" aria-labelledby="memory-heading"><div class="memory-section-heading"><div><h2 id="memory-heading">Flash</h2><p>指定各层固件和备份数据的存储位置，以实际擦除扇区为分配单位。</p></div>${button('新增 Flash 区域', 'memory-add-bank', { symbol: 'plus', disabled: !ready || layout.banks.length >= 64 })}</div>
    <div class="memory-target${mismatch ? ' mismatch' : ''}"><div>${icon('board')}<span><strong>${esc(target || '尚未选择目标硬件')}</strong><small>${!ready ? '先选择 MCU，再配置 Flash 容量与扇区。' : mismatch ? `当前扇区表绑定：${esc([layout.mcu, layout.board].filter(Boolean).join(' · ') || '尚未绑定')}` : 'Flash 容量与擦除方式按具体板卡配置，MCU 型号不代替扇区表。'}</small></span></div>${!ready ? '<a class="button small" href="#/project/hardware?module=hw-platform&tab=config">选择硬件 →</a>' : mismatch ? button('确认用于当前硬件', 'memory-rebind') : ''}</div>
    <fieldset class="memory-editing"${ready ? '' : ' disabled'}><legend class="visually-hidden">Flash 布局与分配</legend>
    ${layout.banks.length ? `<div class="memory-map-list" data-live="memory-map-list">${layout.banks.map((bank, index) => renderBankMap(plan, bank, index)).join('')}</div><div class="memory-legend" aria-label="扇区用途图例">${[...MEMORY_REGIONS.map(region => [region.id, region.label]), ['reserved', '保留'], ['free', '空闲'], ['conflict', '冲突']].map(([tone, label]) => `<span class="memory-tone-${tone}"><i class="memory-swatch" aria-hidden="true"></i>${label}</span>`).join('')}</div>` : `<div class="memory-empty"><span>${icon('database')}</span><h3>先定义实际 Flash</h3><p>可添加片内 Bank 或板载 Flash，再录入起始地址、容量和擦除扇区。已有驱动器的扇区表可随硬件配置复用。</p></div>`}
    ${layout.banks.length ? `<section class="memory-geometry"><div class="memory-subheading"><h3>硬件扇区表</h3><span>调整硬件布局</span></div>${layout.banks.map((bank, index) => renderBankEditor(bank, index, sectorSizes)).join('')}</section>` : ''}
    <section class="memory-placement-section"><div class="memory-subheading"><h3>固件分配</h3><span>三层独立预留</span></div><p class="design-note">预算用于检查预留容量，实际占用以构建结果为准。选取连续扇区，保留区和其他用途已占用的扇区不能重复分配。</p><div class="memory-region-grid">${MEMORY_REGIONS.filter(region => region.kind === 'firmware').map(region => renderRegion(project, plan, region)).join('')}</div></section>
    <section class="memory-placement-section"><div class="memory-subheading"><h3>备份数据</h3><a href="${storageLink}">配置容量与保存策略 →</a></div><p class="design-note">校准、参数、日志各自使用独立扇区；容量需求包含记录头与冗余空间。</p><div class="memory-region-grid">${MEMORY_REGIONS.filter(region => region.kind === 'data').map(region => renderRegion(project, plan, region)).join('')}</div></section>
    </fieldset>
    <div class="design-health" data-live="memory-issues">${issueNoticeButton(relevant, { label: '查看分区检查' })}</div>
    <div class="memory-footer"><p>此处保存部署配置，尚未生成链接脚本或实现独立 OTA。Flash 擦写与控制电流环的隔离仍需在固件中落实。</p>${button('撤销', 'undo')}</div>
  </section>`;
}

export function renderMemorySummary(project) {
  return `<div class="memory-summary"><div>${icon('database')}<span><strong>内存划分</strong></span></div><a class="button small" href="#/project/memory">配置部署 ${icon('arrow-right')}</a></div>`;
}
