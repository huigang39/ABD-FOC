import { numericInputAttributes } from '../../shared/forms/numeric-input.mjs';
import { esc } from '../../shared/esc.mjs';
import { pageHeading } from '../../shared/ui/page-heading.mjs';
import { selectOptions } from '../../shared/forms/select-control.mjs';
import { isAssemblyComplete } from '../equipment/model.mjs';
import { getAssemblyTests, summarizePerformance } from './model.mjs';

const kinds = [['kt', 'Kt · 电流—力矩'], ['tn_curve', 'TN · 转速—力矩']];
const kindName = kind => kinds.find(([value]) => value === kind)?.[1] || '测量记录';
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const fmt = value => !isNumber(value) ? '—' : Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < .0001) ? value.toExponential(3) : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value);
const range = value => value ? `${fmt(value.min)} ～ ${fmt(value.max)}` : '—';
const route = record => `#/performance/${encodeURIComponent(record.id)}`;
const assemblyRoute = id => `#/performance?assembly=${encodeURIComponent(id)}`;
const button = (label, action, attrs = '', primary = false) => `<button class="button ${primary ? 'primary' : ''}" type="button" data-action="performance-${action}" ${attrs}>${label}</button>`;
const newestFirst = (a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt);
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未记录时间';
const localTime = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value), pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const values = entry => {
  const key = entry.kind === 'tn_curve' ? 'speedRpm' : 'currentA';
  return (entry?.samples || []).filter(sample => isNumber(sample?.[key]) && isNumber(sample?.torqueNm) && !(entry.kind === 'kt' && entry.currentBasis === 'phase_rms' && sample.currentA < 0))
    .map(sample => ({ [key]: sample[key], torqueNm: sample.torqueNm, series: typeof sample.series === 'string' ? sample.series.slice(0, 80) : '' }));
};
const summaryOf = entry => summarizePerformance({ ...entry, samples: values(entry) });
const torqueLabel = entry => entry.measurementSide === 'motor' ? '电机力矩' : '输出力矩';
const xLabel = entry => entry.kind === 'tn_curve' ? (entry.measurementSide === 'motor' ? '电机转速' : '输出转速') : entry.currentBasis === 'phase_rms' ? '相电流有效值' : 'Iq 电流';
const xUnit = entry => entry.kind === 'tn_curve' ? 'rpm' : 'A';

function field(label, key, value, { type = 'text', choices, description, step = 'any', min, area = false } = {}) {
  const attrs = `data-performance-field="${key}" aria-label="${esc(label)}"`;
  const control = choices ? `<select class="field-select" ${attrs}>${selectOptions(choices, value)}</select>`
    : area ? `<textarea class="field-input" rows="3" ${attrs}>${esc(value || '')}</textarea>`
      : `<input class="field-input" ${type==='number'?numericInputAttributes(value):`type="${type}" value="${esc(value ?? '')}"`} ${attrs} ${type === 'number' ? `step="${step}" ${min === undefined ? '' : `min="${min}"`}` : type === 'text' ? 'maxlength="160"' : ''}>`;
  return `<label class="form-field"><span class="field-label">${esc(label)}</span>${control}${description ? `<span class="field-description">${esc(description)}</span>` : ''}</label>`;
}

function sampleTable(entry, editable) {
  const samples = entry.samples || [], key = entry.kind === 'tn_curve' ? 'speedRpm' : 'currentA';
  const cell = (sample, index, property, label, numeric = true) => editable
    ? `<input class="field-input performance-cell" ${numeric?numericInputAttributes(sample[property]):`type="text" value="${esc(sample[property] ?? '')}"`} ${numeric ? `step="any"${property === 'currentA' && entry.currentBasis === 'phase_rms' ? ' min="0"' : ''}` : 'maxlength="80"'} data-performance-row="${index}" data-performance-key="${property}" aria-label="第 ${index + 1} 点 · ${esc(label)}">`
    : esc(numeric ? fmt(sample[property]) : sample[property] || '默认');
  return `<div class="contract-table-wrap performance-sample-wrap"><table class="contract-table performance-samples"><thead><tr><th scope="col">点</th><th scope="col">${esc(xLabel(entry))} · ${xUnit(entry)}</th><th scope="col">${torqueLabel(entry)} · N·m</th><th scope="col">分组</th>${editable ? '<th scope="col"><span class="visually-hidden">操作</span></th>' : ''}</tr></thead><tbody>${samples.length ? samples.map((sample, index) => `<tr><th scope="row">${index + 1}</th><td>${cell(sample, index, key, xLabel(entry))}</td><td>${cell(sample, index, 'torqueNm', torqueLabel(entry))}</td><td>${cell(sample, index, 'series', '分组', false)}</td>${editable ? `<td>${button('移除', 'remove-row', `data-index="${index}" aria-label="移除第 ${index + 1} 个测量点"`)}</td>` : ''}</tr>`).join('') : `<tr><td colspan="${editable ? 5 : 4}" class="performance-empty-row">${editable ? '添加测量点，或从下方导入数据。' : '没有测量点。'}</td></tr>`}</tbody></table></div>`;
}

/** Plot only measured points, joining each named series in its original row order. */
export function renderPerformanceCurve(entry) {
  const summary = summaryOf(entry);
  if (!summary.sampleCount) return '<div class="performance-chart-empty"><span>测量曲线</span><p>填写或导入测量点后显示曲线。</p></div>';
  const width = 640, height = 330, left = 70, right = 25, top = 32, bottom = 49;
  // Normalize before subtracting bounds so finite large measurements cannot overflow SVG coordinates.
  const bounds = ({ min, max }) => {
    const scale = Math.max(Math.abs(min), Math.abs(max)) || 1, limit = Number.MAX_VALUE / scale;
    const lower = min / scale, upper = max / scale, pad = lower === upper ? .1 : (upper - lower) * .08;
    return { min: Math.max(-limit, lower - pad), max: Math.min(limit, upper + pad), scale };
  };
  const bx = bounds(summary.xRange), by = bounds(summary.torqueRange);
  const sx = value => left + (value / bx.scale - bx.min) / (bx.max - bx.min) * (width - left - right);
  const sy = value => height - bottom - (value / by.scale - by.min) / (by.max - by.min) * (height - top - bottom);
  const colors = ['#287965', '#3b69a2', '#887556', '#8b6092', '#8a6c2d'];
  const x = summary.xField;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4, xv = (bx.min + ratio * (bx.max - bx.min)) * bx.scale, yv = (by.min + ratio * (by.max - by.min)) * by.scale;
    return `<line class="performance-grid" x1="${sx(xv)}" y1="${top}" x2="${sx(xv)}" y2="${height - bottom}"/><line class="performance-grid" x1="${left}" y1="${sy(yv)}" x2="${width - right}" y2="${sy(yv)}"/><text class="performance-tick" x="${sx(xv)}" y="${height - bottom + 20}" text-anchor="middle">${fmt(xv)}</text><text class="performance-tick" x="${left - 10}" y="${sy(yv) + 4}" text-anchor="end">${fmt(yv)}</text>`;
  }).join('');
  return `<figure class="performance-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(kindName(entry.kind))}测量曲线，${summary.sampleCount} 个测量点"><title>${esc(kindName(entry.kind))}测量曲线</title>${grid}<line class="performance-axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"/><line class="performance-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/><text class="performance-axis-label" x="${left}" y="18">${torqueLabel(entry)} · N·m</text><text class="performance-axis-label" x="${width - right}" y="${height - 7}" text-anchor="end">${esc(xLabel(entry))} · ${xUnit(entry)}</text>${summary.series.map((series, index) => {
    const color = colors[index % colors.length];
    return `<g fill="${color}" stroke="${color}">${series.samples.length > 1 ? `<polyline class="performance-curve" points="${series.samples.map(sample => `${sx(sample[x])},${sy(sample.torqueNm)}`).join(' ')}"/>` : ''}${series.samples.map(sample => `<circle cx="${sx(sample[x])}" cy="${sy(sample.torqueNm)}" r="3.5"><title>${esc(series.name || '默认')} · ${fmt(sample[x])} ${xUnit(entry)}，${fmt(sample.torqueNm)} N·m</title></circle>`).join('')}</g>`;
  }).join('')}</svg><figcaption><div class="performance-legend">${summary.series.map((series, index) => `<span><i style="background:${colors[index % colors.length]}" aria-hidden="true"></i>${esc(series.name || '默认')}</span>`).join('')}</div><span>按各组记录顺序连线</span></figcaption></figure>`;
}

function metrics(entry) {
  const summary = summaryOf(entry);
  return `<dl class="performance-metrics"><div><dt>测量点</dt><dd>${summary.sampleCount}<small>点 · ${summary.seriesCount} 组</small></dd></div><div><dt>${esc(xLabel(entry))}</dt><dd>${range(summary.xRange)}<small>${xUnit(entry)}</small></dd></div><div><dt>${torqueLabel(entry)}</dt><dd>${range(summary.torqueRange)}<small>N·m</small></dd></div></dl>`;
}

function editor(project, draft) {
  const assemblies = (project.catalog?.assemblies || []).filter(assembly => isAssemblyComplete(project.catalog, assembly));
  const assembly = assemblies.find(item => item.id === draft.assemblyId);
  const actuator = project.catalog?.actuators.find(item => item.id === assembly?.actuatorId);
  const driver = project.catalog?.drivers.find(item => item.id === assembly?.driverId);
  const conditions = draft.conditions || {}, kt = draft.kind !== 'tn_curve';
  return `<section class="panel performance-editor"><div class="design-toolbar"><div><span class="eyebrow">测量记录</span><h2>录入数据</h2></div></div><div class="profile-form">${field('关节模组', 'assemblyId', draft.assemblyId, { choices: assemblies.map(item => [item.id, item.name || '未命名关节模组']) })}${field('测试类型', 'kind', draft.kind, { choices: kinds })}${field('记录名称', 'name', draft.name)}${field('测量时间', 'measuredAt', localTime(draft.measuredAt), { type: 'datetime-local' })}</div>${assembly ? `<div class="assembly-components performance-pair"><span class="asset-kind asset-kind-actuator">${esc(actuator.name || '未命名执行器')}</span><span aria-hidden="true">+</span><span class="asset-kind asset-kind-driver">${esc(driver.name || '未命名驱动器')}</span><a class="button small navigation-action" href="#/equipment/assemblies/${encodeURIComponent(assembly.id)}">查看组合 →</a></div>` : '<p class="design-note">先在货架完成执行器与驱动器的搭配，再选择关节模组。</p>'}<div class="profile-form">${field('测量侧', 'measurementSide', draft.measurementSide, { choices: [['output', '关节出轴侧'], ['motor', '电机侧']], description: '按原始测量侧保存，转速与力矩不自动换算。' })}${kt ? field('电流口径', 'currentBasis', draft.currentBasis, { choices: [['iq', 'Iq 电流'], ['phase_rms', '相电流有效值']] }) : ''}${field('实测固件标识', 'firmwareId', draft.firmwareId, { description: '填写测量时使用的固件版本或构建标识。' })}</div><details class="performance-conditions" data-state-key="performance-conditions" open><summary>工况与备注</summary><div class="profile-form">${field('母线电压 · V', 'conditions.busVoltageV', conditions.busVoltageV, { type: 'number', min: 0 })}${field('环境温度 · °C', 'conditions.ambientTemperatureC', conditions.ambientTemperatureC, { type: 'number' })}${field('绕组温度 · °C', 'conditions.windingTemperatureC', conditions.windingTemperatureC, { type: 'number' })}${field('持续时间 · s', 'conditions.durationS', conditions.durationS, { type: 'number', min: 0 })}</div>${field('备注', 'conditions.notes', conditions.notes, { area: true })}</details><div class="design-toolbar performance-table-heading"><h3>测量点</h3>${button('添加点', 'add-row')}</div>${sampleTable(draft, true)}<details class="performance-import" data-state-key="performance-import"><summary>粘贴 CSV / 表格数据</summary><p class="design-note">首行填写表头：${kt ? '电流' : '转速'}、力矩、分组（可省略）；后续每行一个测量点。数值单位为 ${kt ? 'A' : 'rpm'} 和 N·m，使用逗号分隔；使用上方指定的测量侧与电流口径。</p>${field('测量数据', 'csvText', draft.csvText || '', { area: true })}<div class="design-toolbar">${button('替换测量点', 'parse')}</div></details><div class="performance-result" data-live="performance-preview">${metrics(draft)}${renderPerformanceCurve(draft)}</div><div class="performance-editor-footer"><p class="design-note">录入或导入实际测量数据。保存时同时记录当前组合、层级版本和构建配置。</p><div class="performance-actions">${button('检查数据', 'calculate')}${button('保存记录', 'save', assembly ? '' : 'disabled', true)}</div></div></section>`;
}

function snapshot(record) {
  const saved = record.snapshot || {}, conditions = record.conditions || {};
  const entries = [['母线电压', fmt(conditions.busVoltageV), 'V'], ['环境温度', fmt(conditions.ambientTemperatureC), '°C'], ['绕组温度', fmt(conditions.windingTemperatureC), '°C'], ['持续时间', fmt(conditions.durationS), 's']];
  return `<section class="performance-record-context"><div class="design-toolbar"><h3>记录时组合</h3>${record.historical ? '<span class="status-pill neutral">历史配置</span>' : ''}</div><div class="assembly-components"><span class="asset-kind asset-kind-actuator">${esc(saved.actuator?.name || '未记录执行器')}</span><span aria-hidden="true">+</span><span class="asset-kind asset-kind-driver">${esc(saved.driver?.name || '未记录驱动器')}</span></div>${record.historical && record.historyReason ? `<p class="design-note">${esc(record.historyReason)}</p>` : ''}<dl class="performance-context-list"><div><dt>测量侧</dt><dd>${record.measurementSide === 'motor' ? '电机侧' : '关节出轴侧'}</dd></div>${record.kind === 'kt' ? `<div><dt>电流口径</dt><dd>${record.currentBasis === 'phase_rms' ? '相电流有效值' : 'Iq 电流'}</dd></div>` : ''}<div><dt>实测固件</dt><dd>${esc(record.firmwareId || '未记录')}</dd></div>${entries.map(([label, value, unit]) => `<div><dt>${label}</dt><dd>${value}${value === '—' ? '' : ` ${unit}`}</dd></div>`).join('')}${[['hardware', '硬件层'], ['foc', '算法层'], ['app', '应用层']].map(([key, label]) => `<div><dt>${label}</dt><dd>${esc(saved.layers?.[key]?.version || '未指定版本')}</dd></div>`).join('')}</dl>${conditions.notes ? `<p class="performance-record-notes">${esc(conditions.notes)}</p>` : ''}</section>`;
}

function recordDetail(record) {
  return `<section class="panel performance-record"><div class="design-toolbar"><div><span class="eyebrow">${kindName(record.kind)}</span><h2>${esc(record.name || kindName(record.kind))}</h2><p class="design-note">${time(record.measuredAt)} · ${esc(record.snapshot?.assembly?.name || '关节模组')}</p></div><details class="performance-record-menu"><summary class="button small">更多</summary><div>${button('删除记录', 'delete', `data-id="${esc(record.id)}"`)}</div></details></div>${metrics(record)}${renderPerformanceCurve(record)}${snapshot(record)}<details class="performance-raw" data-state-key="performance-samples-${esc(record.id)}"><summary>原始测量点 · ${record.samples.length}</summary>${sampleTable(record, false)}</details></section>`;
}

export function renderPerformance(project, draft, selectedId = '') {
  const records = [...(project.performance?.records || [])].sort(newestFirst);
  const found = records.find(record => record.id === selectedId);
  const selected = found ? getAssemblyTests(project, found.assemblyId).find(record => record.id === found.id) || found : null;
  return `${pageHeading({ title: '测试', description: '录入关节模组的测量数据，保留曲线、工况与对应配置。', actions: button('新建记录', 'new', `data-assembly="${esc(selected?.assemblyId || draft.assemblyId)}"`) })}<div class="performance-layout"><aside class="panel performance-history"><div class="design-toolbar"><h2>测量记录</h2><span class="muted">${records.length}</span></div>${records.length ? `<nav aria-label="测量记录">${records.map(record => `<a href="${route(record)}" class="performance-history-item ${record.id === selectedId ? 'active' : ''}" ${record.id === selectedId ? 'aria-current="page"' : ''}><span class="performance-kind">${record.kind === 'kt' ? 'Kt' : 'TN'}</span><strong>${esc(record.name || kindName(record.kind))}</strong><span>${esc(record.snapshot?.assembly?.name || '关节模组')}</span><small>${time(record.measuredAt)} · ${record.samples.length} 点</small></a>`).join('')}</nav>` : '<div class="performance-history-empty"><p>暂无测量记录。</p><span>保存后可按关节模组查看历史曲线。</span></div>'}</aside><div class="performance-main">${selected ? recordDetail(selected) : editor(project, draft)}</div></div>`;
}

/** Shelf summary always belongs to the complete actuator + driver assembly. */
export function renderAssemblyPerformance(project, assemblyId) {
  const records = getAssemblyTests(project, assemblyId);
  const latest = kinds.map(([kind]) => records.filter(record => record.kind === kind).sort(newestFirst)[0]).filter(Boolean);
  return `<section class="assembly-performance"><div class="design-toolbar"><div><h3>性能记录</h3><p class="design-note">按此关节模组保存测量数据与配置快照。</p></div><a class="button small" href="${assemblyRoute(assemblyId)}">录入测量数据 →</a></div>${latest.length ? `<div class="assembly-performance-results">${latest.map(record => `<a class="assembly-performance-item" href="${route(record)}"><span class="performance-kind">${record.kind === 'kt' ? 'Kt' : 'TN'}</span><div><strong>${esc(record.name || kindName(record.kind))}</strong><small>${record.summary.sampleCount} 点 · ${torqueLabel(record)} ${range(record.summary.torqueRange)} N·m</small><small>${time(record.measuredAt)}${record.historical ? ' · 历史配置' : ''}</small></div><span aria-hidden="true">→</span></a>`).join('')}</div>` : '<p class="design-note">尚未保存 Kt 或 TN 测量记录。</p>'}${records.length > latest.length ? `<p class="design-note">共 ${records.length} 条记录，可在测试页查看完整历史。</p>` : ''}</section>`;
}
