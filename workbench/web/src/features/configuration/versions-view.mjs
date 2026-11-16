import { edit, esc } from './view.mjs';
import { LAYER_VERSION_IDS, getLayerVersionState, validateLayerVersions } from './versions.mjs';
import { issueNoticeButton } from '../../shared/ui/issue-notices.mjs';
import { pageHeading } from '../../shared/ui/page-heading.mjs';

const layerNames = { hardware: '硬件层', foc: '算法层', app: '应用层' };
const emptyDraft = () => ({ version: '', interfaceVersion: '', notes: '', requires: { hardware: '', foc: '', app: '' } });

export function renderVersions(project, drafts = {}) {
  const states = Object.fromEntries(LAYER_VERSION_IDS.map(layer => [layer, getLayerVersionState(project, layer)]));
  const selected = LAYER_VERSION_IDS.filter(layer => states[layer].selectedId);
  const ready = selected.length > 0 && selected.every(layer => states[layer].release);
  const allIssues = validateLayerVersions(project);
  const issues = allIssues.filter(issue => issue.id.startsWith('layer-version-compatibility-'));
  const mismatches = issues.filter(issue => issue.level === 'error');
  const unknown = issues.some(issue => issue.level === 'pending');
  const compatibility = mismatches.length ? `${mismatches.length} 项接口声明不匹配` : !ready || selected.length < LAYER_VERSION_IDS.length || unknown ? '接口兼容性待声明' : '接口声明匹配 · 运行尚未验证';
  const combination = LAYER_VERSION_IDS.map(layer => `${layerNames[layer]} ${states[layer].release?.version || '未选择'}`).join(' · ');
  return `${pageHeading({ title: '版本组合', description: '各层独立保存配置版本，再选择需要的组合。', actions: `<div class="checklist-actions" data-live="version-issues">${issueNoticeButton(allIssues, { label: '查看版本检查' })}</div>`, crumbs: [{ href: '#/architecture', label: '主页' }, { label: '版本组合' }] })}
    <div class="version-combination"><div><strong>所选组合</strong><p>${esc(combination)}</p><span>${esc(compatibility)}</span></div><button type="button" class="button primary" data-action="apply-layer-combination" ${ready ? '' : 'disabled'}>应用所选组合</button></div>

    <p class="design-note">版本号可填写任意非空文本，如 beta、board-r2。接口要求按标识精确核对，留空表示未知。</p>
    <div class="version-grid">${LAYER_VERSION_IDS.map(layer => renderLayerCard(project, layer, states[layer], drafts[layer] ?? emptyDraft(), allIssues.filter(issue => issue.layer === layer))).join('')}</div>
    <p class="design-note">快照保存本层模块参数、编译包含和运行开关，硬件层另含目标板卡与 Flash 扇区表；分区用途分配、内核分工、共享数据结构、协议和构建配置不随快照切换。</p>
    <p class="design-note">版本组合由构建检查核对接口与实现支持。<a class="button small navigation-action" href="#/project/build">前往构建 →</a></p>`;
}

function renderLayerCard(project, layer, state, draft, issues) {
  const releases = project.layerVersions?.releases?.filter(release => release.layer === layer) ?? [];
  const { selectedId, release, matches } = state;
  const choices = [['', '尚未选择'], ...releases.map(item => [item.id, item.version])];
  if (selectedId && !release) choices.push([selectedId, '所选版本不可用']);
  const status = release ? matches ? '配置一致' : '当前配置已调整' : selectedId ? '所选版本不可用' : '未选择版本';
  const meta = { id: layer };
  return `<section class="version-card layer-${esc(layer)}" aria-label="${esc(layerNames[layer])}版本">
    <div class="design-toolbar"><h3>${esc(layerNames[layer])}</h3><div class="checklist-actions" data-live="version-check-${esc(layer)}">${issueNoticeButton(issues, { label: `查看${layerNames[layer]}版本检查` })}</div></div>
    <div class="version-current" data-live="version-current-${esc(layer)}"><div><small>所选版本</small><strong>${esc(release?.version || '—')}</strong></div><span class="status-pill ${release && !matches ? 'warning' : 'neutral'}">${esc(status)}</span></div>
    ${edit('选择已存版本', selectedId, 'layer-selection', 'release', { ...meta, choices })}
    ${release ? `<p class="design-note">接口标识：${esc(release.interfaceVersion || '未知')}<br>${LAYER_VERSION_IDS.filter(other => other !== layer).map(other => `${esc(layerNames[other])}接口要求：${esc(release.requires[other] || '未知')}`).join('<br>')}${release.notes ? `<br>备注：${esc(release.notes)}` : ''}</p>` : ''}
    <div class="version-actions"><button type="button" class="button" data-action="apply-layer-version" data-layer="${esc(layer)}" ${release ? '' : 'disabled'}>应用此层版本</button></div>
    <details data-state-key="version-${esc(layer)}" ${releases.length ? '' : 'open'}><summary>另存当前层为新版本</summary><div class="version-fields">
      ${edit('新版本号', draft.version ?? '', 'layer-draft', 'version', meta)}
      ${edit('本层接口标识', draft.interfaceVersion ?? '', 'layer-draft', 'interfaceVersion', meta)}
      ${LAYER_VERSION_IDS.filter(other => other !== layer).map(other => edit(`要求${layerNames[other]}接口`, draft.requires?.[other] ?? '', 'layer-draft', 'requires', { ...meta, section: other })).join('')}
      ${edit('版本备注', draft.notes ?? '', 'layer-draft', 'notes', { ...meta, area: true })}
    </div><div class="version-actions"><button type="button" class="button primary" data-action="save-layer-version" data-layer="${esc(layer)}">保存为新版本</button></div></details>
  </section>`;
}
