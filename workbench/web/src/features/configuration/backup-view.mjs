import { esc } from '../../shared/esc.mjs';
import { issueNoticeButton } from '../../shared/ui/issue-notices.mjs';
import { MEMORY_REGIONS, getMemoryRegion, validateMemory } from '../deployment/flash.mjs';

const dataRegions = MEMORY_REGIONS.filter(region => region.kind === 'data');
const descriptions = {
  'motion-calibration': '编码器方向、电角度偏置及其他校准结果',
  parameters: '配置参数、出轴标零与力矩标零',
  'fault-records': '运行快照与日志记录',
};
const size = value => value === null ? '待核对' : `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value)} KiB`;
const hex = value => `0x${value.toString(16).toUpperCase().padStart(8, '0')}`;
const validKiB = (value, zero = false) => typeof value === 'number' && Number.isFinite(value) && (zero ? value >= 0 : value > 0) && Number.isSafeInteger(value * 1024);
const validAddress = value => Number.isSafeInteger(value) && value >= 0;
const bankName = (bank, index) => bank.name?.trim() || `Flash ${index + 1}`;
const sectorName = (sector, index) => sector.name?.trim() || `扇区 ${index}`;

/** Configuration allocations only. No persisted setting is evidence of bytes stored on a device. */
export function backupStorageState(project) {
  const plan = project.memory;
  const memoryIssues = validateMemory(project).filter(issue => issue.id.startsWith('memory-') && !issue.id.startsWith('memory-ram-'));
  const placements = plan?.placements || {};
  const banks = (plan?.layout?.banks || []).map((bank, index) => {
    const geometryValid = validAddress(bank.baseAddress) && validKiB(bank.sizeKiB)
      && Number.isSafeInteger(bank.baseAddress + bank.sizeKiB * 1024);
    const sectors = (bank.sectors || []).map((sector, sectorIndex) => {
      const owners = MEMORY_REGIONS.filter(region => placements[region.id]?.bankId === bank.id && placements[region.id]?.sectorIds?.includes(sector.id));
      const valid = geometryValid && validKiB(sector.offsetKiB, true) && validKiB(sector.sizeKiB)
        && sector.offsetKiB + sector.sizeKiB <= bank.sizeKiB;
      const conflict = owners.length > 1 || (sector.reserved && owners.length > 0);
      return { ...sector, name: sectorName(sector, sectorIndex), owners, valid, conflict,
        tone: conflict ? 'conflict' : sector.reserved ? 'reserved' : owners[0]?.id || 'free',
        label: conflict ? '分配冲突' : sector.reserved ? '保留' : owners[0]?.label || '未分配',
      };
    });
    const ordered = sectors.filter(sector => sector.valid).toSorted((a, b) => a.offsetKiB - b.offsetKiB);
    const noOverlap = ordered.every((sector, i) => !i || sector.offsetKiB >= ordered[i - 1].offsetKiB + ordered[i - 1].sizeKiB);
    const valid = geometryValid && sectors.length > 0 && sectors.every(sector => sector.valid && !sector.conflict) && noOverlap;
    return { ...bank, name: bankName(bank, index), sectors, geometryValid, valid,
      availableKiB: valid ? sectors.filter(sector => !sector.reserved && !sector.owners.length).reduce((sum, sector) => sum + sector.sizeKiB, 0) : null,
    };
  });
  const invalidLayout = memoryIssues.some(issue => issue.level === 'error' && ['memory-format', 'memory-target-mismatch'].includes(issue.id))
    || memoryIssues.some(issue => issue.id.startsWith('memory-banks-overlap-'));
  const regions = dataRegions.map(region => {
    const resolved = getMemoryRegion(project, region.id);
    const bank = banks.find(item => item.id === resolved.placement.bankId);
    const referenced = resolved.placement.sectorIds || [];
    const relatedIssues = memoryIssues.filter(issue => issue.itemId === region.id || (bank && issue.itemId === bank.id)
      || ['memory-format', 'memory-target-mismatch'].includes(issue.id) || issue.id.startsWith('memory-banks-overlap-'));
    const conflict = bank?.sectors.some(sector => referenced.includes(sector.id) && sector.conflict);
    const trusted = !invalidLayout && bank?.valid && !conflict;
    const allocatedKiB = trusted ? resolved.capacityKiB : null;
    const unassigned = !resolved.placement.bankId && referenced.length === 0;
    return { ...resolved, id: region.id, label: region.label, description: descriptions[region.id], bank,
      allocatedKiB: unassigned ? 0 : allocatedKiB,
      spareKiB: allocatedKiB !== null && resolved.requiredKiB !== null && allocatedKiB >= resolved.requiredKiB ? allocatedKiB - resolved.requiredKiB : null,
      startAddress: trusted ? resolved.startAddress : null, endAddress: trusted ? resolved.endAddress : null,
      issues: relatedIssues, unassigned,
      status: conflict || relatedIssues.some(issue => issue.level === 'error') ? 'error' : unassigned && resolved.requiredKiB === 0 ? 'unused' : allocatedKiB === null || resolved.requiredKiB === null ? 'pending' : 'configured',
      // The current device protocol does not report backup usage. Never derive it from a budget.
      storedBytes: null, deviceAvailableBytes: null,
    };
  });
  const referencesValid = Object.values(placements).every(placement => !placement.bankId && !placement.sectorIds?.length
    || banks.some(bank => bank.id === placement.bankId && placement.sectorIds.every(id => bank.sectors.some(sector => sector.id === id))));
  const trustedLayout = banks.length > 0 && !invalidLayout && banks.every(bank => bank.valid) && referencesValid;
  return { banks, regions, issues: memoryIssues,
    totalKiB: banks.length && !invalidLayout && banks.every(bank => bank.geometryValid) ? banks.reduce((sum, bank) => sum + bank.sizeKiB, 0) : null,
    allocatedKiB: regions.every(region => region.allocatedKiB !== null) ? regions.reduce((sum, region) => sum + region.allocatedKiB, 0) : null,
    availableKiB: trustedLayout ? banks.reduce((sum, bank) => sum + bank.availableKiB, 0) : null,
  };
}

function renderBank(bank) {
  return `<article class="backup-bank"><div class="backup-bank-heading"><strong>${esc(bank.name)}</strong><span>${size(bank.geometryValid ? bank.sizeKiB : null)} · Flash</span></div>
    ${bank.geometryValid && bank.sectors.length ? `<div class="backup-map-track" role="img" aria-label="${esc(bank.name)}的工程分区分配，非设备实际占用">${bank.sectors.filter(sector => sector.valid).map(sector => {
      const start = bank.baseAddress + sector.offsetKiB * 1024;
      return `<span class="backup-map-sector memory-tone-${sector.tone}" style="left:${sector.offsetKiB / bank.sizeKiB * 100}%;width:${sector.sizeKiB / bank.sizeKiB * 100}%" title="${esc(`${sector.name} · ${sector.label} · ${size(sector.sizeKiB)} · ${hex(start)}–${hex(start + sector.sizeKiB * 1024 - 1)}`)}"><span>${esc(sector.label)}</span></span>`;
    }).join('')}</div>` : '<div class="backup-map-empty">地址、容量或扇区尚未配置</div>'}
    <div class="backup-bank-addresses"><code>${bank.geometryValid ? hex(bank.baseAddress) : '地址待填写'}</code><code>${bank.geometryValid ? hex(bank.baseAddress + bank.sizeKiB * 1024 - 1) : ''}</code></div>
  </article>`;
}

function renderRegion(region) {
  const status = region.status === 'error' ? '分配需修正' : region.status === 'unused' ? '不预留' : region.status === 'pending' ? '待分配 / 核对' : '已配置';
  const address = region.startAddress !== null && region.endAddress !== null ? `${hex(region.startAddress)} – ${hex(region.endAddress - 1)}` : region.unassigned ? '尚未分配分区' : '地址待核对';
  return `<article class="backup-region memory-tone-${region.id}" data-backup-region="${region.id}">
    <div class="backup-region-heading"><h3><i class="memory-swatch" aria-hidden="true"></i>${esc(region.label)}</h3><span class="backup-region-status" data-status="${region.status}">${status}</span><div class="checklist-actions">${region.issues.length ? issueNoticeButton(region.issues, { label: `查看${region.label}分配问题` }) : ''}</div></div>
    <p class="backup-region-description">${esc(region.description)}</p>
    <dl class="backup-location"><div><dt>存储介质</dt><dd>${region.bank ? 'Flash' : '待分配'}</dd></div><div><dt>分区</dt><dd>${esc(region.bank?.name || '—')}</dd></div><div><dt>擦除扇区</dt><dd>${esc(region.sectors.map((sector, index) => sectorName(sector, index)).join('、') || '—')}</dd></div></dl>
    <code class="backup-region-address">${esc(address)}</code>
    <dl class="backup-capacity"><div><dt>配置需求</dt><dd>${region.requiredKiB === null ? '待填写' : size(region.requiredKiB)}</dd></div><div><dt>已分配</dt><dd>${size(region.allocatedKiB)}</dd></div><div><dt>预留余量</dt><dd>${region.spareKiB === null ? '—' : size(region.spareKiB)}</dd></div><div class="backup-device-usage"><dt>设备已存</dt><dd>未知 <small>未读回</small></dd></div></dl>
  </article>`;
}

export function renderBackupStorage(project, { issues = [] } = {}) {
  const state = backupStorageState(project);
  const relevant = issues.filter(issue => issue.id.startsWith('memory-') && (issue.moduleId === 'app-params' || ['memory-format','memory-target-mismatch'].includes(issue.id)));
  return `<section class="backup-storage" aria-labelledby="backup-storage-title" data-live="backup-storage">
    <div class="backup-heading"><div><h2 id="backup-storage-title">备份存储</h2><p>查看校准、参数与日志的存储位置和预留容量。</p></div><div class="checklist-actions">${issueNoticeButton(relevant, { label: '查看备份存储检查' })}</div></div>
    <div class="backup-overview"><div><span>Flash 总容量</span><strong>${size(state.totalKiB)}</strong></div><div><span>备份已分配</span><strong>${size(state.allocatedKiB)}</strong></div><div><span>可分配扇区</span><strong>${size(state.availableKiB)}</strong></div><div><span>设备实际占用</span><strong>未知</strong></div></div>
    <p class="backup-capacity-note">容量来自当前工程配置；预留余量 = 已分配 − 配置需求。设备已存和实际剩余容量需读回确认。</p>
    <div class="backup-regions">${state.regions.map(renderRegion).join('')}</div>
    <section class="backup-map" aria-label="Flash 分区图"><div class="backup-map-heading"><h3>Flash 分区图</h3><span>工程分配 · 非设备实测</span></div>${state.banks.length ? state.banks.map(renderBank).join('') : '<p class="backup-map-empty">尚未定义 Flash，可在存储分区中配置地址、容量和扇区。</p>'}
      <div class="backup-map-legend">${[...MEMORY_REGIONS.map(region => [region.id, region.label]), ['reserved','保留'], ['free','未分配'], ['conflict','冲突']].map(([tone,label]) => `<span class="memory-tone-${tone}"><i class="memory-swatch" aria-hidden="true"></i>${label}</span>`).join('')}</div>
    </section>
  </section>`;
}
