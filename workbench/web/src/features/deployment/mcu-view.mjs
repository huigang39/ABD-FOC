import { esc } from '../configuration/view.mjs';
import { identifyMcu } from './mcu.mjs';

export function renderMcuInfo(model = '', {showSource=false}={}) {
  const info = identifyMcu(model);
  const entered = String(model).trim();
  return `<div class="form-field mcu-info" data-live="mcu-info"><span class="field-label">CPU 架构<span class="attribute-tag tag-auto">自动识别</span></span><output class="computed-field"><strong>${esc(info?.label || (entered ? '型号尚未收录' : '待选择 MCU'))}</strong>${info ? `<span class="mcu-model-badge">${esc(info.prefix)}</span>` : ''}</output>${showSource?`<p class="field-description">${info ? `<a class="button small navigation-action" href="${esc(info.source)}" target="_blank" rel="noopener">器件资料 ↗</a>` : '选择已收录型号会显示CPU 架构；新增型号需补充平台适配。'}</p>`:''}</div>`;
}
