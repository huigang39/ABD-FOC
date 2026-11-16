import { observerOutputOptions } from './modules/algorithm/signals.mjs';
import { renderMath } from './shared/ui/math.mjs';
import { fixedAlgorithmChildren } from './modules/algorithm/children.mjs';
import { renderAlgorithmChildren } from './modules/algorithm/children-view.mjs';
import { createAlgorithmPath } from './modules/algorithm/foc-lifecycle/paths.mjs';
import { renderAlgorithmPaths } from './modules/algorithm/foc-lifecycle/view.mjs';
import { renderCoreExceptions } from './modules/hardware/hw-safety/core-exceptions.mjs';
import { parameterVisible } from './modules/shared/visibility.mjs';
import { runtimeConfiguration, renderRuntimeConfiguration } from './features/configuration/runtime-config.mjs';
import { installSourceView } from './shared/ui/source-view.mjs';
import { navigationContext } from './shared/scroll/navigation.mjs';
import { createFirmwareLibrary } from './features/attachments/controller.mjs';
import { phaseTag } from './shared/ui/phase-tag.mjs';
import './shared/ui/switch-motion.mjs';
import { moveScheduleEntry } from './features/configuration/schedule.mjs';
import { numericInputAttributes, readNumericInput, installNumericInputs } from './shared/forms/numeric-input.mjs';
import { renderPlatformConfiguration } from './features/configuration/platform-view.mjs';
import { CORE_FIELDS, createCoreSettings } from './modules/hardware/hw-platform/cores.mjs';
import { getMcuCores } from './modules/hardware/hw-platform/targets.mjs';
import { createConfigurationTreeState } from './features/configuration/tree-state.mjs';
import { bindHardwareField } from './modules/hardware/hw-platform/options.mjs';
import { fieldHelp, installFieldHelp } from './shared/ui/field-help.mjs';
import { syncSensorResource } from './modules/hardware/hw-board/validation.mjs';
import { bindSensorField, renderResourceEditor, renderTripEditor, renderSensorTransport, renderCommandEditor } from './features/configuration/hardware-view.mjs';
import { createResource, selectResourceInstance } from './modules/hardware/hw-board/resources.mjs';
import { createTripPath } from './modules/hardware/hw-safety/paths.mjs';
import { renderArchitectureOverview, renderArchitectureLayer } from './features/architecture/view.mjs';
import { getBuildInspectionState } from './features/build/gate.mjs';
import { renderAppearanceSettings, installAppearanceSettings } from './shared/settings/appearance.mjs';
import { applyImportedConfiguration, exportConfiguration, selectConfigurationActuator, selectConfigurationDriver, beginCustomHardware } from './features/configuration/workspace.mjs';
import { renderPerformance } from './features/performance/view.mjs';
import { createPerformanceController } from './features/performance/controller.mjs';
import { renderModuleExtras } from './modules/presentation.mjs';
import { installNumberWheelGuard } from './shared/forms/number-wheel.mjs';
import { issueNoticeButton } from './shared/ui/issue-notices.mjs';
import { createNotificationCenter, noticeOptions } from './shared/notifications/center.mjs';
import { createNotificationHistory } from './shared/notifications/history.mjs';
import { modelSelect, optionGroupFor } from './shared/forms/model-options.mjs';
import { selectOptions, isEmptyChoice, isBinaryChoice, binaryChoice } from './shared/forms/select-control.mjs';
import { neo75hModelName } from './features/equipment/product-model.mjs';
import { createNativeClient } from './features/device/client.mjs';
import { captureLogScroll, restoreLogScroll } from './shared/scroll/log-scroll.mjs';
import { createNeo75hProject } from './profiles/neo75h.mjs';
import { MODULES, TARGET_FIELDS, createProject, validateProject, getDerived, parseProject, serializeProject } from './core/model.mjs';
import { configurationFingerprint, createStructure, createField, createFault, createMessage } from './core/contracts.mjs';
import { createActuator, createDriver, createJointModule, createBinding, applyAssembly, applyDriver, captureDriverHardware, getDriverHardware, setDriverHardwareParameter, validateEquipment } from './features/equipment/model.mjs';
import { renderGuide, renderStructures, renderFaults, renderProtocol } from './features/configuration/view.mjs';
import { renderEquipment } from './features/equipment/view.mjs';
import { renderSensorConfig } from './modules/hardware/hw-drivers/view.mjs';
import { SENSOR_ROLES } from './modules/hardware/hw-drivers/sensors.mjs';
import { createDriverCommand, COMMAND_PURPOSES, DRIVER_COMMANDS_MAX } from './modules/hardware/hw-drivers/protocol.mjs';
import { syncMcuArchitecture } from './features/deployment/mcu.mjs';
import { renderBuild, renderDebug, renderFlash } from './features/build/view.mjs';
import { renderOperation } from './features/operation/view.mjs';
import { renderVersions } from './features/configuration/versions-view.mjs';
import { renderModuleInterfaces } from './features/configuration/interfaces-view.mjs';
import { createLineFields } from './shared/effects/line-field.mjs';
import { enhanceSelectMenus } from './shared/ui/select-menu.mjs';
import { icon } from './shared/ui/icons.mjs';
import { renderMemory, renderMemorySummary } from './features/deployment/flash-view.mjs';
import { renderRam } from './features/deployment/ram-view.mjs';
import { ramAction, ramEdit } from './features/deployment/ram.mjs';
import { renderExecution } from './features/deployment/execution-view.mjs';
import { deploymentAction, deploymentEdit, parseAddress } from './features/deployment/actions.mjs';
import { createLayerInterface, createInterfaceMapping, getModuleContractRole } from './core/module-contracts.mjs';
import { saveLayerVersion, selectLayerVersion, applyLayerVersion, applySelectedLayerVersions, getLayerVersionState } from './features/configuration/versions.mjs';

const $ = selector => document.querySelector(selector);
installNumberWheelGuard(document);
const numericInputs = installNumericInputs(document);
const helpSurface = installFieldHelp(document);
let treeStorage;
try { treeStorage = sessionStorage; } catch {}
const configurationTree = createConfigurationTreeState({storage:treeStorage});
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const DRAFT_KEY = 'actuator-workbench.draft.v1';

const layerNames = { app: '应用层', foc: '算法层', hardware: '硬件层' };
const severityNames = { error: '错误', warning: '警告', pending: '待确认', info: '信息' };
let project = createProject();
let issues = [];
let saveState = '新草案 · 尚未保存';
let autosaveTimer;
const displayedNotices = new Set();
let notificationFilter = 'all';
let notificationStorage;
try { notificationStorage = localStorage; } catch {}
const notificationHistory = createNotificationHistory({ storage: notificationStorage, onChange: renderNotificationHistory });
const notifications = createNotificationCenter({ host: $('#notification-center'), onDetails: (message, options) => {
  if(options.historyId)notificationHistory.markRead(options.historyId);
  showNoticeDialog(message, { ...options, allowNavigation:!options.projectId||options.projectId===project.id });
} });
let recoveryNotice = '';
let draftWriteBlocked = false;
let undoProject = null;
let assemblyDraft = { actuatorId: '', driverId: '', name: '' };
let draggedPart = null;
let revealSavedAssembly = false;
let versionDrafts = {};
let sectorSizes = {};
let renderedRoute = null;
const navigationPositions = new Map();
let pendingNavigationScroll = null;
history.scrollRestoration = 'manual';
window.addEventListener('scroll',()=>{if(renderedRoute===location.hash)navigationPositions.set(location.hash,{left:scrollX,top:scrollY});},{passive:true});
document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(link&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button===0){pendingNavigationScroll={from:location.hash,to:link.hash,reveal:link.dataset.revealTarget==='true',key:link.dataset.targetKey,resource:link.dataset.targetResource,left:scrollX,top:scrollY};navigationPositions.set(location.hash,{left:scrollX,top:scrollY});if(link.dataset.revealTarget==='true'&&link.hash===location.hash){event.preventDefault();pendingNavigationScroll=null;queueMicrotask(()=>{render();requestAnimationFrame(()=>revealConfigurationTarget({key:link.dataset.targetKey,resource:link.dataset.targetResource}));});}}},true);
let renderedProjectId = '';
let lineFields = null;
let visualAvailable = true;
const nativeClient=createNativeClient({getProject:()=>project,onUpdate:full=>{if(['project','debug'].includes(route().page))render(!full);},onError:message=>showNotice(message,{level:'error'}),onNotice:showNotice});
const performanceController = createPerformanceController({
  getProject: () => project,
  commit: next => change(current => { current.performance = next.performance; }),
  render, navigate, notify: showNotice,
});
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
let motionEnabled=!motionPreference.matches;
try { const stored=localStorage.getItem('actuator-console.motion'); if(stored!==null&&!motionPreference.matches)motionEnabled=stored==='on'; } catch {}
const appearance = installAppearanceSettings({ onChange: () => lineFields?.refreshAppearance() });
$('#appearance-settings').innerHTML = renderAppearanceSettings({ theme: appearance.theme, mode: appearance.mode, motionEnabled, motionAvailable: visualAvailable });
function updateMotionToggle() {document.documentElement.dataset.iconMotion=motionEnabled?'on':'off';const button=$('[data-action="toggle-visual-motion"]');if(button){button.disabled=!visualAvailable;button.title=visualAvailable?'竖线动效':'此浏览器不支持 Canvas 2D 或 Path2D';button.setAttribute('aria-pressed',String(visualAvailable&&motionEnabled));button.innerHTML=icon(visualAvailable&&motionEnabled?'play':'pause')+`<span>${!visualAvailable?'动效不可用':motionEnabled?'动效 · 开':'动效 · 关'}</span>`;button.setAttribute('aria-label',motionEnabled?'关闭竖线动效':'开启竖线动效');}}
motionPreference.addEventListener('change',event=>{if(event.matches){motionEnabled=false;lineFields?.setEnabled(false);updateMotionToggle();}});
try {
  const saved = localStorage.getItem(DRAFT_KEY);
  if (saved) {
    try { project = parseProject(saved); saveState = ''; }
    catch {
      try {
        localStorage.setItem(`${DRAFT_KEY}.recovery.${Date.now()}`, saved);
        recoveryNotice = '已有草稿未能读取，原始记录已隔离保留；当前打开新草案，可重新导入 JSON。';
      } catch {
        draftWriteBlocked = true;
        recoveryNotice = '已有草稿未能读取，且无法备份。已暂停覆盖草稿；当前修改可导出 JSON 保存。';
      }
    }
  }
} catch { draftWriteBlocked = true; recoveryNotice = '已有草稿未能读取，已打开新草案；原始浏览器记录未删除。你也可以重新导入 JSON。'; }

function moduleById(id) { return MODULES.find(module => module.id === id); }
function enabled(id) { return project.instances[id]?.enabled === true; }
function counts() { return { error: issues.filter(x => x.level === 'error').length, pending: issues.filter(x => x.level === 'pending').length, warning: issues.filter(x => x.level === 'warning').length }; }
function number(value, suffix = '') { return typeof value === 'number' && Number.isFinite(value) ? `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)}${suffix}` : '待配置'; }
const layerStep = {hardware:'hardware', foc:'algorithm', app:'application'};
const configurationPages = new Set(['execution','memory','structures','faults','protocol','versions']);
function route() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(part=>{try{return decodeURIComponent(part);}catch{return part;}});
  const params = new URLSearchParams(query);
  const nested = parts[0] === 'project' && configurationPages.has(parts[1]);
  return { page: nested ? parts[1] : parts[0] || 'architecture', id: parts[nested ? 2 : 1], itemId: parts[nested ? 3 : 2], section: parts[0] === 'project' ? 'project' : parts[0] || 'architecture', moduleId: params.get('module'), assemblyId: params.get('assembly'), tab: params.get('tab') || 'config', interfaceId: params.get('interface') };
}
function moduleRoute(moduleId, tab = 'config') {
  const module = moduleById(moduleId);
  return module ? `#/project/${layerStep[module.layer]}?module=${encodeURIComponent(moduleId)}&tab=${tab}` : '#/project';
}
function revealConfigurationTarget({key,resource}={}) {
  const moduleId=route().moduleId;
  let target=moduleId?document.querySelector(`[data-guide-module="${CSS.escape(moduleId)}"]`):document.querySelector('.design-editor')||$('#workspace');
  if(!target)return;
  const field=resource?target.querySelector(`[data-edit="pcba-resource"][data-id="${CSS.escape(resource)}"]`):key?target.querySelector(`[data-key="${CSS.escape(key)}"]`):null;
  target=field?.closest(resource?'.hardware-resource':'.form-field')||(key==='resources'?target.querySelector('.hardware-editor'):null)||target;
  for(let node=target;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;
  target.scrollIntoView({block:'start',behavior:'instant'});
  target.classList.add('configuration-navigation-target');
  setTimeout(()=>target.classList.remove('configuration-navigation-target'),1800);
}
function navigate(to) { if (location.hash === to) render(); else location.hash = to; }
function showNotice(message, options = {}) {
  const resolved = noticeOptions(message, options);
  const entry=notificationHistory.add({ ...resolved, message, projectId:project.id, projectName:project.name });
  resolved.historyId=entry.id;
  resolved.projectId=entry.projectId;
  if(resolved.presentation === 'dialog')showNoticeDialog(message, resolved);
  else notifications.show(message, resolved);
}
function showNoticeDialog(message, { level = 'info', title = '', issues: noticeIssues = [], allowNavigation = true } = {}) {
  closeNotificationHistory(false);
  const dialog = $('#notification-dialog');
  document.querySelectorAll('[data-native-menu][open]').forEach(menu=>{menu.open=false;});
  const severity = ['error','warning','pending','info','success'].includes(level) ? level : 'info';
  const labels = { error:'错误',warning:'警告',pending:'待确认',info:'信息',success:'完成' };
  const heading = title || { error:'操作未完成',warning:'请留意',pending:'检查结果',info:'提示',success:'操作完成' }[severity];
  const key = JSON.stringify([severity,heading,message,noticeIssues.map(item=>[item.id,item.message])]);
  if(dialog.open && displayedNotices.has(key)) return;
  if(!dialog.open){displayedNotices.clear();$('#notification-body').replaceChildren();}
  const alreadyOpen = dialog.open;
  const severityOrder = { error: 0, warning: 1, pending: 2, info: 3, success: 4 };
  const highestSeverity = alreadyOpen && severityOrder[dialog.dataset.level] < severityOrder[severity] ? dialog.dataset.level : severity;
  displayedNotices.add(key);
  $('#notification-kind').textContent=labels[highestSeverity];
  $('#notification-title').textContent=alreadyOpen?'操作消息':heading;
  dialog.dataset.level=highestSeverity;
  const group=document.createElement('section');group.className='notification-group';
  group.dataset.title=heading;
  if(alreadyOpen){
    const firstGroup=$('#notification-body').firstElementChild;
    if(firstGroup&&!firstGroup.querySelector('h3')){const label=document.createElement('h3');label.textContent=firstGroup.dataset.title;firstGroup.prepend(label);}
    const label=document.createElement('h3');label.textContent=heading;group.append(label);
  }
  if(message){const paragraph=document.createElement('p');paragraph.className='notification-message';paragraph.textContent=String(message);group.append(paragraph);}
  if(noticeIssues.length){const list=document.createElement('div');list.className='notification-issues';list.innerHTML=noticeIssues.map(issue=>{
    const path=issue.path?.split('.')[0];
    const designPage=issue.designPage||({catalog:'equipment',build:'build',memory:'memory',execution:'execution'}[path]);
    return issueCard({...issue,level:issue.level||severity,designPage:allowNavigation?designPage:undefined,moduleId:allowNavigation?(issue.moduleId||(moduleById(path)?path:undefined)):undefined});
  }).join('');group.append(list);}
  $('#notification-body').append(group);
  if(!dialog.open){dialog.showModal();notifications.syncHost();$('#notification-title').focus({preventScroll:true});}
}
function showSuccess(message) { showNotice(message, {level:'success',presentation:'notification'}); }
function showError(message) { if(message)showNotice(message,{level:'error'}); }
function showIssueResults(selected=issues,title='检查结果') {
  const level=selected.some(issue=>issue.level==='error')?'error':selected.some(issue=>issue.level==='warning')?'warning':selected.some(issue=>issue.level==='pending')?'pending':'info';
  showNotice(selected.length?`${selected.length} 项检查结果`:'当前检查未发现问题。',{level,title,issues:selected});
}
function renderNotificationHistory() {
  const entries=notificationHistory.entries;
  const unread=entries.filter(entry=>!entry.read).length;
  const toggle=$('#notification-history-toggle'), badge=$('#notification-unread-count');
  badge.hidden=!unread;badge.textContent=unread>99?'99+':String(unread);
  toggle.setAttribute('aria-label',unread?`通知，${unread} 条未读`:'通知');
  $('#notification-history-retention').textContent=notificationHistory.persistent?'当前浏览器 · 最近 100 条':'本次会话 · 最近 100 条';
  document.querySelectorAll('[data-action="filter-notifications"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===notificationFilter)));
  $('#notification-mark-read').disabled=!unread;
  $('#notification-clear').disabled=!entries.length;
  const list=$('#notification-history-list');
  const focused=list.contains(document.activeElement)?document.activeElement?.dataset.id:null;
  const visible=notificationFilter==='unread'?entries.filter(entry=>!entry.read):entries;
  const levels={success:'完成',info:'信息',warning:'警告',pending:'待确认',error:'错误'};
  list.innerHTML=visible.length?visible.map(entry=>`<article class="notification-history-item" data-level="${escape(entry.level)}" data-read="${entry.read}"><header><strong>${!entry.read?'<span class="notification-unread-dot" aria-label="未读"></span>':''}${escape(entry.title||levels[entry.level]||'通知')}</strong><time datetime="${escape(entry.updatedAt)}">${escape(new Date(entry.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}))}</time></header><p>${escape(entry.message)}</p><div class="notification-history-meta"><span>${escape(entry.projectName||'ABD-FOC')}${entry.count>1?` · ${entry.count} 次`:''}</span><button type="button" class="notification-history-detail" data-action="notification-detail" data-id="${escape(entry.id)}">查看详情${entry.issues?.length?` · ${entry.issues.length} 项`:''}</button></div></article>`).join(''):`<div class="notification-history-empty">${notificationFilter==='unread'?'没有未读通知':'暂无历史通知'}</div>`;
  if(focused)[...list.querySelectorAll('[data-id]')].find(button=>button.dataset.id===focused)?.focus({preventScroll:true});
}
function closeNotificationHistory(restoreFocus=true) {
  const panel=$('#notification-history');
  if(panel.hidden)return;
  const focused=panel.contains(document.activeElement);
  panel.hidden=true;document.body.classList.remove('notification-history-open');
  $('#notification-history-toggle').setAttribute('aria-expanded','false');
  if(focused&&restoreFocus)$('#notification-history-toggle').focus({preventScroll:true});
}
function toggleNotificationHistory() {
  const panel=$('#notification-history');
  if(!panel.hidden){closeNotificationHistory();return;}
  document.querySelectorAll('[data-native-menu][open]').forEach(menu=>{menu.open=false;});
  renderNotificationHistory();panel.hidden=false;document.body.classList.add('notification-history-open');
  $('#notification-history-toggle').setAttribute('aria-expanded','true');
  panel.querySelector('[data-action="close-notification-history"]').focus({preventScroll:true});
}
function saveDraft() {
  if (draftWriteBlocked) throw new Error('无法备份原始草稿，已暂停覆盖。');
  localStorage.setItem(DRAFT_KEY, serializeProject(project));
}
function autosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { saveDraft(); saveState = '已保存'; }
    catch { saveState = '有修改 · 尚未保存'; showError('浏览器存储不可用或空间不足。当前修改仍在本页，请在设置中“导出全部数据”保存到文件。'); }
    $('#save-status').textContent = saveState;
    document.querySelectorAll('[data-live="configuration-save-status"]').forEach(node=>{node.textContent=saveState;});
  }, 350);
}
function change(mutator, formOnly = false) {
  const next = structuredClone(project);
  mutator(next);
  undoProject = structuredClone(project);
  next.revision = (Number(next.revision) || 0) + 1;
  next.updatedAt = new Date().toISOString();
  project = next;
  saveState = '有修改 · 正在保存草稿';
  render(formOnly);
  autosave();
}
function applyConfiguration(incoming) {
  if (nativeClient.state.busy || nativeClient.state.pendingAction || nativeClient.state.debug.connected) { showError('请等待当前操作完成并断开调试连接，再载入配置。'); return false; }
  if (performanceController.hasUnsavedDraft()) { showError('测试页还有未保存的测量表，请先保存记录，再载入配置。'); return false; }
  try {
    if (draftWriteBlocked) throw new Error('原始草稿尚未完成备份，请先导出当前数据。');
    const next = applyImportedConfiguration(project, incoming);
    next.revision = (Number(project.revision) || 0) + 1;
    next.updatedAt = new Date().toISOString();
    localStorage.setItem(DRAFT_KEY, serializeProject(next));
    clearTimeout(autosaveTimer);
    undoProject = structuredClone(project);
    project = next;
    versionDrafts = {}; sectorSizes = {};
    nativeClient.state.inspection = null;
    saveState = '配置已载入';
    navigate('#/project/actuator'); render(); nativeClient.refresh();
    return true;
  } catch (error) { showError(`配置未更改：${error.message}`); return false; }
}
function pill(text, kind = 'neutral') { return `<span class="status-pill ${kind}">${escape(text)}</span>`; }
function heading(title, description = '', eyebrow = '') {
  return `<div class="page-heading"><div>${eyebrow ? `<p class="eyebrow">${escape(eyebrow)}</p>` : ''}<h1>${escape(title)}</h1>${description ? `<p class="page-description">${escape(description)}</p>` : ''}</div></div>`;
}

function fieldHtml(field, value, scope, moduleId = '') {
  if(moduleId==='foc-observer'){const options=observerOutputOptions(field.key,project);if(options)field={...field,options};}
  const key = field.key;
  const name = `${scope}-${moduleId}-${key}`;
  const attrs = `id="${escape(name)}" data-scope="${scope}" data-module="${escape(moduleId)}" data-key="${escape(key)}"`;

  const related = issues.filter(issue => issue.moduleId === moduleId && issue.paramKey === key && issue.level === 'error' && /^(range-|positive-)|^current-loop-bandwidth-range$|^hardware-.+-choice$|^sensor-frame-/.test(issue.id));
  const example = moduleId && project.provenance?.[`${moduleId}.${key}`] === 'example';
  const help = [field.description, example ? '预置值 · 待设备确认' : ''].filter(Boolean).join('\n');
  let input;
  if (field.type === 'readout') {
    input=`<output class="computed-field">${escape(field.displayValue??'—')}</output>`;
  } else if (optionGroupFor(scope,key)) {
    input=modelSelect(optionGroupFor(scope,key),value,attrs);
  } else if (field.type === 'boolean') {
    input = `<label class="checkbox-field switch-field parameter-phase-switch" data-phase="${field.phase === 'compile' ? 'compile' : 'runtime'}" title="${field.phase === 'compile' ? '编译期：构建固件时生效。' : '运行期：设备加载参数后生效；初始化参数需重新初始化。'}"><input type="checkbox" ${attrs} aria-label="${escape(field.label)}" ${value === true ? 'checked' : ''}><span class="switch-ui" data-phase-label="${field.phase === 'compile' ? '编译期' : '运行期'}" aria-hidden="true"></span></label>`;
  } else if (field.type === 'select' || ['integer','number'].includes(field.type) && field.options) {
    input = field.binarySwitch ? `<label class="checkbox-field switch-field parameter-phase-switch" data-phase="${field.phase === 'compile' ? 'compile' : 'runtime'}" title="${field.phase === 'compile' ? '编译期：构建固件时生效。' : '运行期：设备加载参数后生效；初始化参数需重新初始化。'}"><input type="checkbox" ${attrs} aria-label="${escape(field.label)}" data-presence="1" ${value === 'present' ? 'checked' : ''}><span class="switch-ui" data-phase-label="${field.phase === 'compile' ? '编译期' : '运行期'}" aria-hidden="true"></span></label>` : isBinaryChoice(field.options||[])?binaryChoice(field.options,value,attrs,{name,label:field.label}):`<select class="field-select" ${attrs} data-empty="${isEmptyChoice(value)}">${selectOptions(field.options||[],value)}</select>`;
  } else if (field.type === 'multiselect' && key === 'cia402Modes') {
    const selected = Array.isArray(value) ? value : [];
    const choice = option => `<label class="choice cia402-mode-choice"><input type="checkbox" data-scope="${scope}" data-module="${escape(moduleId)}" data-key="${escape(key)}" data-multiple="true" value="${escape(option.value)}" ${selected.includes(option.value)?'checked':''}><span class="attribute-tag">${escape(option.label.split(' · ')[0])}</span><span>${escape(option.label.split(' · ').slice(1).join(' '))}</span></label>`;
    input = `<details class="cia402-mode-picker" data-state-key="cia402-mode-picker"><summary>选择模式<span class="attribute-tag">已选 ${selected.length}</span></summary>${[['标准模式',false],['扩展模式',true]].map(([label,custom])=>`<section><h4>${label}</h4><div class="cia402-mode-grid">${field.options.filter(option=>Boolean(option.custom)===custom).map(choice).join('')}</div></section>`).join('')}</details>`;
  } else if (field.type === 'multiselect') {
    input = `<details class="cia402-mode-picker" data-state-key="multi-${escape(moduleId)}-${escape(key)}"><summary>选择项目<span class="attribute-tag">已选 ${Array.isArray(value) ? value.length : 0}</span></summary><section><div class="cia402-mode-grid" role="group" aria-label="${escape(field.label)}">${(field.options || []).map(option => `<label class="choice cia402-mode-choice"><input type="checkbox" data-scope="${scope}" data-module="${escape(moduleId)}" data-key="${escape(key)}" data-multiple="true" value="${escape(option.value)}" ${Array.isArray(value) && value.includes(option.value) ? 'checked' : ''} ${moduleId==='app-calibration'&&key==='enabledProcedures'&&!project.instances[moduleId].parameters.procedures.includes(option.value)?'disabled':''}><span>${escape(option.label)}</span>${option.custom ? '<span class="option-badge">自定义</span>' : ''}</label>`).join('')}</div></section></details>`;
  } else {
    const numeric = ['number', 'integer'].includes(field.type);
    input = `<div class="field-input-wrap"><input class="field-input" ${attrs} ${numeric ? numericInputAttributes(value) : `type="text" value="${escape(value)}"`} placeholder="—" ${numeric ? `step="${field.type === 'integer' ? '1' : (field.step || 'any')}"` : 'maxlength="120"'} ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''}>${field.unit ? `<span class="field-unit">${escape(field.unit)}</span>` : ''}</div>`;
  }
  return `<div class="form-field"><div class="field-label"><label for="${escape(name)}">${escape(field.label)}</label>${fieldHelp(help,field.label)}${phaseTag(field.phase)}</div>${input}${related.map(issue => `<p class="field-error">${escape(issue.message)}</p>`).join('')}</div>`;
}
function targetForm() { return TARGET_FIELDS.filter(field=>!['board','vendor'].includes(field.key)).map(field => fieldHtml(field, project.target[field.key], 'target')).join(''); }
function moduleParameters(module) {
  const params = project.instances[module.id]?.parameters || {};
  const d = getDerived(project);
  const resources=project.instances['hw-board'].parameters.resources||[];
  const fields=(module.params||[]).filter(field=>parameterVisible(project,module.id,field)&&!(module.id==='hw-platform'&&field.group==='memory'&&project.memory.layout.banks.length));
  const renderField=field=>fieldHtml(bindHardwareField(field,project.target.mcu,module.id),params[field.key],'module',module.id);
  let config=fields.map(renderField).join('');
  if(['foc-observer','foc-compensation'].includes(module.id))config=renderAlgorithmChildren(project,module,config);
  if(module.id==='foc-current') {
    const feedback=moduleById('foc-feedback');
    config += `<details class="resource-disclosure hardware-resource current-feedback-config" data-state-key="current-feedback"><summary><strong>电角度源</strong></summary><div class="hardware-resource-body"><div class="profile-form">${feedback.params.filter(field=>parameterVisible(project,feedback.id,field)).map(field=>fieldHtml(field,project.instances[feedback.id].parameters[field.key],'module',feedback.id)).join('')}</div></div></details>`;
  }
  if(module.id==='hw-platform')config=targetForm()+renderPlatformConfiguration(project.target.mcu,params,fields,renderField,{project})+`<div class="memory-summary"><div>${icon('chip')}<span><strong>双核协作</strong></span></div><a class="button small" href="#/project/execution">配置分工 ${icon('arrow-right')}</a></div>`;
  if(module.id==='hw-board')config=fieldHtml(TARGET_FIELDS.find(field=>field.key==='board'),project.target.board,'target')+fields.filter(field=>!field.group).map(renderField).join('')+renderResourceEditor(project.target.mcu,resources)+`<section class="hardware-field-group" id="peripheral-timing"><h3>采样与 PWM</h3><div class="profile-form">${fields.filter(field=>field.group==='timing').map(renderField).join('')}</div></section>`;
  if(module.id==='hw-drivers')config=renderSensorConfig(params,field=>renderField(bindSensorField(field,params,resources)),{renderTransport:role=>renderSensorTransport(params,role,resources,{mcu:project.target.mcu}),renderCommands:role=>renderCommandEditor(role,params[role.prefix+'Commands']||[])});
  if(module.id==='foc-lifecycle')config+=renderAlgorithmPaths(project);
  if(module.id==='hw-safety')config=renderCoreExceptions(project,renderField)+renderTripEditor(params.tripPaths||[],resources,{mcu:project.target.mcu});
  return `${config}
    ${['hw-platform','app-params'].includes(module.id)?`<div class="deployment-module-link">${renderMemorySummary(project)}</div>`:''}
    ${['hw-board', 'foc-observer', 'foc-lifecycle'].includes(module.id) ? `<div class="derived-value"><div class="derived-value-label"><span>电流环频率</span>${fieldHelp('PWM 频率 ÷ 电流环分频；观测器启用时沿用此周期。','电流环频率')}<span class="attribute-tag">推导值</span></div><strong>${number(d.fastHz, ' Hz')}</strong></div>` : ''}
    `;
}

function moduleExtras(module) {
  return renderModuleExtras(module.id, { project, issues, escape, number, moduleRoute, issueNoticeButton });
}
function issueCard(issue) {
  const module = moduleById(issue.moduleId);
  const pageNames={structures:'数据结构',faults:'错误码',protocol:'通信协议',equipment:'货架',build:'构建配置',versions:'版本组合',interfaces:'模块接口',memory:'部署配置',execution:'双核协作'};
  const designPage=Object.hasOwn(pageNames,issue.designPage)?issue.designPage:null;
  const connection=project.design.layerInterfaces.find(item=>item.id===issue.itemId);
  const link=designPage==='interfaces'?moduleRoute(connection?.toModule||issue.moduleId||'foc-current','interfaces')+(connection?`&interface=${encodeURIComponent(connection.id)}`:''):designPage==='equipment'?equipmentIssueRoute(issue.itemId):`#/project/${designPage}/${encodeURIComponent(issue.itemId||'')}`;
  const resource=(project.instances['hw-board']?.parameters.resources||[]).find(item=>issue.id?.includes(item.id));
  const targetAttrs=`data-target-key="${escape(issue.paramKey||'')}" data-target-resource="${escape(resource?.id||'')}"`;
  return `<article class="issue-card ${escape(issue.level)}"><div class="issue-heading">${pill(severityNames[issue.level] || '说明', issue.level === 'error' ? 'danger' : issue.level === 'pending' || issue.level === 'warning' ? 'warning' : 'neutral')}${issue.title?`<strong>${escape(issue.title)}</strong>`:''}</div><p class="issue-copy">${escape(issue.message)}</p>${designPage?`<a class="button small navigation-action issue-action" data-reveal-target="true" ${targetAttrs} href="${escape(link)}">${pageNames[issue.designPage]||'查看配置'} →</a>`:module ? `<a class="button small navigation-action issue-action" data-reveal-target="true" ${targetAttrs} href="${moduleRoute(module.id, 'config')}">${layerNames[module.layer]} / ${escape(module.title)} →</a>` : ''}</article>`;
}
function equipmentIssueRoute(id) { for(const group of ['actuators','drivers','assemblies']) if(project.catalog[group].some(x=>x.id===id))return `#/equipment/${group}/${encodeURIComponent(id)}`;return '#/equipment/assemblies'; }
function renderValidation() {
  const c = counts();
  const gate = getBuildInspectionState(project, nativeClient.state);
  const labels = {unchecked:'尚未检查',checking:'正在检查',stale:'配置已调整',failed:'尚未通过',passed:'构建依赖通过'};
  return `<section class="panel" data-live="configuration-validation"><div class="design-toolbar"><h3>当前配置</h3>${pill(labels[gate.status],gate.supported?'success':'neutral')}</div>
    <div class="validation-summary"><button class="summary-stat" data-action="show-issue-level" data-level="error"><strong>${c.error}</strong><span>错误</span></button><button class="summary-stat" data-action="show-issue-level" data-level="warning"><strong>${c.warning}</strong><span>警告</span></button><button class="summary-stat" data-action="show-issue-level" data-level="pending"><strong>${c.pending}</strong><span>待确认</span></button><button class="summary-stat" data-action="show-issue-level" data-level="info"><strong>${issues.filter(issue=>issue.level==='info').length}</strong><span>信息</span></button></div>
    <div class="validation-toolbar"><button class="button" data-action="show-issues">查看配置检查项</button>${nativeClient.state.inspection?'<button class="button" data-native-action="review-inspection">查看构建检查结果</button>':''}</div><p class="design-note">构建时自动检查模块依赖、参数、数据结构和目标适配；检查通过后继续生成与编译。</p></section>`;
}

function render(formOnly = false) {
  helpSurface.dismiss();
  const workspace = $('#workspace');
  configurationTree.capture(workspace);
  const sameView = renderedRoute === location.hash && renderedProjectId === project.id;
  const logScroll = sameView ? captureLogScroll(workspace) : new Map();
  const relatedView = renderedProjectId === project.id && renderedRoute !== null && navigationContext(renderedRoute) === navigationContext(location.hash);
  const treeScroll = sameView || relatedView ? workspace.querySelector('.configuration-tree')?.scrollTop : null;
  const pageScroll = sameView ? { left: window.scrollX, top: window.scrollY } : null;
  const openStates = sameView ? [...workspace.querySelectorAll('details')].map(d => ({ key: d.dataset.stateKey || d.querySelector('summary')?.textContent, open: d.open })) : [];
  const active = document.activeElement;
  const focused = sameView && workspace.contains(active) && (!formOnly || active.matches('[data-log-key]')) ? active : null;
  const focusKey = focused ? { id: focused.id, tag: focused.tagName, type: focused.type, value: focused.value, data: JSON.stringify(focused.dataset) } : null;
  const priority = { error: 0, pending: 1, warning: 2, info: 3 };
  issues = validateProject(project).sort((a,b) => priority[a.level] - priority[b.level]);
  const current = route();
  $('#workspace-title').textContent = current.section === 'project' ? '工程' : ({architecture:'架构',equipment:'货架',debug:'调试',operation:'运行',performance:'测试'}[current.page] || 'ABD-FOC');
  $('.workspace-icon use').setAttribute('href', `/assets/icons.svg#${({architecture:'overview',project:'settings',equipment:'shelf',debug:'wave',operation:'play',performance:'notebook'})[current.section] || 'overview'}`);
  $('#save-status').textContent = saveState;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === current.section));
  document.querySelectorAll('[data-layer-nav]').forEach(a => a.classList.toggle('active', current.page === 'architecture' && a.dataset.layerNav === current.id));
  const gate = getBuildInspectionState(project, nativeClient.state);
  const inspection = { ...nativeClient.state.inspection, current: gate.current, supported: gate.supported };
  let content;
  switch (current.page) {
    case 'execution': content = `<nav class="breadcrumbs" aria-label="当前位置"><a href="#/project/hardware">硬件</a><span>/</span><a href="#/project/hardware?module=hw-platform&tab=config">内核</a><span>/</span><span aria-current="page">双核协作</span></nav>${heading('双核协作','分配模块执行内核，配置跨核数据交换。')}${renderExecution(project)}<div data-live="execution-issues">${issueNoticeButton(issues.filter(issue=>issue.id.startsWith('execution-')),{label:'内核配置检查'})}</div>`; break;
    case 'memory': content = `<nav class="breadcrumbs" aria-label="当前位置"><a href="#/project/hardware">硬件层</a><span>/</span><a href="#/project/hardware?module=hw-platform&tab=config">内核</a><span>/</span><span aria-current="page">部署配置</span></nav>${heading('部署配置','按目标硬件分配 Flash 和 RAM。')}${renderMemory(project,issues,{sectorSizes})}${renderRam(project,issues)}`; break;
    case 'architecture': content = current.id ? renderArchitectureLayer(current.id,current.moduleId) : renderArchitectureOverview(); break;
    case 'project': content = renderGuide(project,issues,current.id,{parameters:moduleParameters,moduleRoute,moduleExtras,interfaces:module=>renderModuleInterfaces(project,issues,module.id,current.interfaceId),selectedModuleId:current.moduleId,tab:current.tab,inspection,buildStatus:nativeClient.state.delivery?.projectId === project.id && nativeClient.state.delivery.fingerprint === configurationFingerprint(project) ? 'built' : nativeClient.state.job?.fingerprint === configurationFingerprint(project) ? nativeClient.state.job.status : '',flashStatus:{current:nativeClient.state.flashResult?.fingerprint===configurationFingerprint(project),programmed:nativeClient.state.flashResult?.programmed===true},profileVariant:nativeClient.state.profileVariant,saveStatus:saveState,configurationLocked:nativeClient.state.busy || nativeClient.state.debug.connected,buildHtml:current.id==='build'?renderValidation()+renderBuild(project,nativeClient.state)+renderRuntimeConfiguration(project, fieldHtml):'',flashHtml:current.id==='flash'?renderFlash(project,nativeClient.state):''}); break;
    case 'structures': content = renderStructures(project,issues,current.id,current.moduleId); break;
    case 'faults': content = renderFaults(project,issues,current.id); break;
    case 'protocol': content = renderProtocol(project,issues,current.id); break;
    case 'equipment': content = renderEquipment(project,[...issues.filter(issue=>issue.designPage!=='equipment'),...validateEquipment(project)],current.id,current.itemId,assemblyDraft,firmwareLibrary); break;
    case 'debug': content = renderDebug(project,nativeClient.state); break;
    case 'operation': content = renderOperation(project); break;
    case 'performance': content = renderPerformance(project, performanceController.state(current), current.id); break;
    case 'versions': content = renderVersions(project,versionDrafts); break;
    default: content = renderArchitectureOverview();
  }
  if (formOnly) {
    const template = document.createElement('template');
    template.innerHTML = content;
    // Preserve live form controls so blur/change cannot discard the next click or keyboard focus.
    const fields = [...$('#workspace').querySelectorAll('.form-field')];
    template.content.querySelectorAll('.form-field').forEach((fresh, index) => {
      const current = fields[index];
      if (!current) return;
      current.querySelectorAll('.field-description, .field-error').forEach(node => node.remove());
      const oldHelp = current.querySelector('[data-help]'), newHelp = fresh.querySelector('[data-help]');
      if (oldHelp && newHelp) oldHelp.dataset.help = newHelp.dataset.help;
      fresh.querySelectorAll('.field-description, .field-error').forEach(node => current.append(node.cloneNode(true)));
    });
    for (const selector of ['.derived-value', '.config-summary', '.storage-plan', '.project-meta-grid']) {
      const currentNodes = [...$('#workspace').querySelectorAll(selector)];
      template.content.querySelectorAll(selector).forEach((node, index) => currentNodes[index]?.replaceWith(node.cloneNode(true)));
    }
    const freshLive = new Map([...template.content.querySelectorAll('[data-live]')].map(node=>[node.dataset.live,node]));
    $('#workspace').querySelectorAll('[data-live]').forEach(node=>{const fresh=freshLive.get(node.dataset.live);if(fresh&&!node.isEqualNode(fresh))node.replaceWith(fresh.cloneNode(true));});
  } else {
    lineFields?.destroy();
    $('#workspace').innerHTML=content;
  }
  workspace.querySelectorAll('details').forEach(d=>{const previous=openStates.find(item=>item.key===(d.dataset.stateKey||d.querySelector('summary')?.textContent));if(previous)d.open=previous.open;});
  configurationTree.restore(workspace,{stepId:current.id,moduleId:current.moduleId,reveal:renderedRoute!==null&&renderedRoute!==location.hash&&!relatedView});
  renderMath(workspace);
  numericInputs.refresh(workspace);
  enhanceSelectMenus(workspace);
  restoreLogScroll(workspace, logScroll);
  if(treeScroll!=null && workspace.querySelector('.configuration-tree'))workspace.querySelector('.configuration-tree').scrollTop=treeScroll;
  if(focusKey && !focused.isConnected){const replacement=[...workspace.querySelectorAll('input,select,textarea,button,[data-log-key]')].find(el=>focusKey.id?el.id===focusKey.id:el.tagName===focusKey.tag&&el.type===focusKey.type&&JSON.stringify(el.dataset)===focusKey.data&&(el.type!=='checkbox'||el.value===focusKey.value));replacement?.focus({preventScroll:true});}
  if(pageScroll && (window.scrollX !== pageScroll.left || window.scrollY !== pageScroll.top))window.scrollTo({...pageScroll, behavior:'instant'});
  if(!formOnly)lineFields=createLineFields($('#workspace'),{enabled:motionEnabled,onAvailability:available=>{visualAvailable=available;updateMotionToggle();}});
  updateMotionToggle();
  renderedRoute=location.hash;
  renderedProjectId=project.id;
  document.title = `${$('#workspace-title').textContent} · ABD-FOC`;
  nativeClient.draw($('#workspace'));
}

function handleDesignAction(action,data) {

  if(action==='add-algorithm-path'){change(next=>{const p=next.instances['foc-lifecycle'].parameters;p.protectionPaths??=[];if(p.protectionPaths.length<32)p.protectionPaths.push(createAlgorithmPath());});return true;}
  if(action==='remove-algorithm-path'){change(next=>{const p=next.instances['foc-lifecycle'].parameters;p.protectionPaths=p.protectionPaths.filter(path=>path.id!==data.id);});return true;}

  if(action==='platform-prune-cores') {
    change(next=>{const driver=data.id?next.catalog.drivers.find(item=>item.id===data.id):null;const hardware=driver?driver.hardware:Object.fromEntries(Object.entries(next.instances).map(([id,instance])=>[id,instance.parameters]));syncMcuArchitecture(driver||next.target,hardware,{replaceCores:true});});return true;
  }
  if(action==='configure-custom-hardware'){try{change(next=>Object.assign(next,beginCustomHardware(project)));showSuccess('已转为自行配置硬件，当前硬件参数已保留。');}catch(error){showError(error.message);}return true;}
  if(action==='new-neo75h'){try{const variant=$('#neo75h-variant')?.value||'KW';if(applyConfiguration(createNeo75hProject(variant))){navigate('#/project/actuator');showSuccess(`已载入 ${neo75hModelName(variant)} 配置`);}}catch(error){showError(error.message);}return true;}
  const {id,child}=data;
  if(action.startsWith('schedule-')) {
    try { change(next=>{
      const schedule=next.design.schedule;
      if(action==='schedule-add') {
        if(schedule.tasks.length>=16)throw Error('最多配置 16 个任务。');
        const priority=Array.from({length:15},(_,i)=>i+1).find(p=>!schedule.tasks.some(t=>t.priority===p));
        schedule.tasks.push({id:`task-${crypto.randomUUID()}`,name:'新任务',trigger:'periodic',frequencyHz:100,priority:priority||15,budgetUs:null,entries:[]});
      } else if(action==='schedule-remove') {
        const task=schedule.tasks.find(t=>t.id===id);if(!task||task.trigger!=='periodic'||task.entries.length)throw Error('仅可移除没有调用入口的普通任务。');
        schedule.tasks=schedule.tasks.filter(t=>t.id!==id);
      } else moveScheduleEntry(schedule,id,data.task,action==='schedule-up'?-1:1);
    }); } catch(error) { showError(error.message); }
    return true;
  }
  if(action.startsWith('ram-')){try{const updated=ramAction(project,action,data);change(next=>Object.assign(next,updated));}catch(error){showError(error.message);}return true;}
  if(action.startsWith('memory-')||action.startsWith('execution-')) {
    try {const updated=deploymentAction(project,action,{...data,value:sectorSizes[id]??null});change(next=>Object.assign(next,updated));}
    catch(error){showNotice(error.message,{level:'error'});}
    return true;
  }
  if(action==='remove-structure'&&getModuleContractRole(project.design,id)){showNotice('模块的输入、输出、状态结构需保留，可编辑其字段');return true;}
  if(['save-layer-version','apply-layer-version','apply-layer-combination'].includes(action)) {
    try {
      const updated=action==='save-layer-version'?saveLayerVersion(project,{layer:data.layer,...versionDrafts[data.layer]}):action==='apply-layer-version'?applyLayerVersion(project,data.layer):applySelectedLayerVersions(project);
      if(action==='save-layer-version')delete versionDrafts[data.layer];
      change(next=>Object.assign(next,updated));
      showSuccess(action==='save-layer-version'?'已保存此层版本':'版本配置已应用，请查看依赖检查');
    }catch(error){showNotice(error.message,{level:'error'});}
    return true;
  }
  if(action==='pick-part'){pickPart(data.kind,id);return true;}
  if(action==='clear-part'){assemblyDraft[data.kind+'Id']='';render();return true;}
  if(action==='add-assembly'){
    assemblyDraft={actuatorId:'',driverId:'',name:''};
    navigate('#/equipment/assemblies/new');render();
    $('#assembly-builder')?.scrollIntoView({block:'start',behavior:'smooth'});$('#assembly-builder')?.focus({preventScroll:true});
    return true;
  }
  if(action==='save-joint'){
    const actuator=project.catalog.actuators.find(x=>x.id===assemblyDraft.actuatorId);
    const driver=project.catalog.drivers.find(x=>x.id===assemblyDraft.driverId);
    if(!actuator||!driver){showNotice('请先选择执行器和驱动器',{level:'warning'});return true;}
    const item=createJointModule(project,assemblyDraft);
    item.firmwareId=assemblyDraft.firmwareId||'';
    assemblyDraft={actuatorId:'',driverId:'',name:''};revealSavedAssembly=true;
    change(next=>next.catalog.assemblies.push(item));navigate(`#/equipment/assemblies/${encodeURIComponent(item.id)}`);
    showSuccess('关节模组已保存，可查看匹配结果并应用到当前配置');return true;
  }
  if(action==='load-module-contracts'){
    const module=moduleById(data.module);if(!module)return true;
    change(next=>{for(const role of ['input','output','state']){const structure=next.design.structures.find(s=>s.id===next.design.moduleContracts[module.id][role]);if(structure&&!structure.fields.length){structure.name=module.contracts[role].name;structure.fields=structuredClone(module.contracts[role].fields);}}});
    showSuccess('已载入空白结构的模块字段');return true;
  }
  if(action==='add-layer-interface'&&data.module) {
    const module=moduleById(data.module);if(!module)return true;
    const item=createLayerInterface(),incoming=data.direction==='input';
    item[incoming?'toModule':'fromModule']=module.id;
    item[incoming?'targetStructure':'sourceStructure']=project.design.moduleContracts[module.id][incoming?'input':'output'];
    item.name=`${module.title} · ${incoming?'输入':'输出'}接口`;
    change(next=>next.design.layerInterfaces.push(item));
    navigate(moduleRoute(module.id,'interfaces')+`&interface=${encodeURIComponent(item.id)}`);return true;
  }
  if(action==='add-structure'&&data.module){const module=moduleById(data.module);if(!module)return true;const item=createStructure();item.owner=module.id;item.rate=module.executionDomain==='fast'?'fast':module.executionDomain==='control'?'control':'event';change(next=>next.design.structures.push(item));navigate(`#/project/structures/${encodeURIComponent(item.id)}?module=${module.id}`);return true;}
  if(action==='use-driver'){try{const applied=applyDriver(project,id);change(next=>Object.assign(next,applied));showSuccess('驱动器硬件配置已复用');}catch(error){showError(error.message);}return true;}
  if(action==='capture-driver'){try{const saved=captureDriverHardware(project,id);change(next=>Object.assign(next,saved));showSuccess('整套硬件配置已存入驱动器');}catch(error){showError(error.message);}return true;}
  if(action==='new-driver-from-project'){const next=structuredClone(project);const driver=createDriver(project.target.board||'新驱动器');next.catalog.drivers.push(driver);const saved=captureDriverHardware(next,driver.id);saved.catalog.activeDriverId=driver.id;change(next=>Object.assign(next,saved));navigate(`#/equipment/drivers/${driver.id}`);return true;}
  const adds={
    'add-structure': [()=>createStructure(), next=>next.design.structures, item=>`#/project/structures/${item.id}`],
    'add-fault': [()=>createFault(), next=>next.design.faults, item=>`#/project/faults/${item.id}`],
    'add-message': [()=>createMessage(), next=>next.design.protocol.messages, item=>`#/project/protocol/${item.id}`],
    'add-actuator': [()=>createActuator(), next=>next.catalog.actuators, item=>`#/equipment/actuators/${item.id}`],
    'add-driver': [()=>createDriver(), next=>next.catalog.drivers, item=>`#/equipment/drivers/${item.id}`],
  };
  if(adds[action]) { const [factory,array,link]=adds[action]; const item=factory(); change(next=>array(next).push(item));navigate(link(item));return true; }
  if(action==='add-interface-mapping'){change(next=>next.design.layerInterfaces.find(x=>x.id===id)?.fieldMap.push(createInterfaceMapping()));return true;}
  if(action==='add-field') { change(next=>next.design.structures.find(x=>x.id===id)?.fields.push(createField()));return true; }
  if(['add-pcba-resource','remove-pcba-resource','add-trip-path','remove-trip-path'].includes(action)) {
    const owner=data.owner||'';
    change(next=>{
      const hardware=owner?next.catalog.drivers.find(driver=>driver.id===owner)?.hardware:Object.fromEntries(Object.entries(next.instances).map(([id,instance])=>[id,instance.parameters]));
      if(!hardware)throw new Error('驱动器不存在。');
      const resourceAction=action.includes('pcba-resource'), key=resourceAction?'resources':'tripPaths', moduleId=resourceAction?'hw-board':'hw-safety';
      const list=hardware[moduleId][key]??=[];
      if(action.startsWith('add-'))list.push(resourceAction?createResource(data.kind):createTripPath());
      else {const index=list.findIndex(item=>item.id===id);if(index>=0)list.splice(index,1);}
    });return true;
  }
  if(['add-driver-command','remove-driver-command'].includes(action)) {
    try {
      change(next=>{
        const owner=data.owner||'';
        const hardware=owner?next.catalog.drivers.find(driver=>driver.id===owner)?.hardware:Object.fromEntries(Object.entries(next.instances).map(([moduleId,instance])=>[moduleId,instance.parameters]));
        if(!hardware)throw new Error('驱动器不存在。');
        const role=SENSOR_ROLES.find(role=>role.id===data.role);
        if(!role)throw new Error('未知驱动通道。');
        const key=role.prefix+'Commands', commands=hardware['hw-drivers'][key]??(hardware['hw-drivers'][key]=[]);
        if(action==='add-driver-command') {
          if(commands.length>=DRIVER_COMMANDS_MAX)throw new Error(`每个通道最多 ${DRIVER_COMMANDS_MAX} 条命令。`);
          const purpose=COMMAND_PURPOSES.some(([value])=>value===data.purpose)?data.purpose:'other';
          if(purpose==='data'&&commands.some(command=>command.purpose==='data'))throw new Error('每个通道最多一条主数据指令。');
          commands.push(createDriverCommand(purpose));
        } else {
          const index=commands.findIndex(command=>command.id===data.id);
          if(index>=0)commands.splice(index,1);
        }
      });
    } catch(error) { showError(error.message); }
    return true;
  }
  if(action==='add-binding') { change(next=>next.catalog.drivers.find(x=>x.id===id)?.bindings.push(createBinding()));return true; }
  const removals={
    'remove-layer-interface':next=>next.design.layerInterfaces,
    'remove-interface-mapping':next=>next.design.layerInterfaces.find(x=>x.id===id)?.fieldMap,
    'remove-structure':next=>next.design.structures,
    'remove-fault':next=>next.design.faults,
    'remove-message':next=>next.design.protocol.messages,
    'remove-actuators':next=>next.catalog.actuators,
    'remove-drivers':next=>next.catalog.drivers,
    'remove-assemblies':next=>next.catalog.assemblies,
    'remove-field':next=>next.design.structures.find(x=>x.id===id)?.fields,
    'remove-binding':next=>next.catalog.drivers.find(x=>x.id===id)?.bindings,
  };
  if(removals[action]) { change(next=>{const list=removals[action](next);const index=list?.findIndex(x=>x.id===(child||id));if(index>=0)list.splice(index,1);});showSuccess('已移除，可点击撤销恢复');return true; }
  if(action==='undo') { if(!undoProject){showNotice('没有可撤销的修改');return true;}const current=structuredClone(project);project=undoProject;undoProject=current;project.revision++;project.updatedAt=new Date().toISOString();render();autosave();showSuccess('已撤销上一步修改');return true; }
  if(action==='apply-assembly') {
    try { const applied=applyAssembly(project,id);change(next=>Object.assign(next,applied));showSuccess('组合参数已应用，请继续检查配置'); }
    catch(error){showError(error.message);}
    return true;
  }
  return false;
}

function handleDesignEdit(input) {
  if(input.dataset.edit==='algorithm-routing'){change(next=>{const moduleId=input.dataset.section;next.instances[moduleId].parameters.children=fixedAlgorithmChildren(next,moduleId);const child=next.instances[moduleId].parameters.children.find(c=>c.id===input.dataset.id);if(child&&Object.hasOwn(child.routing,input.dataset.key))child.routing[input.dataset.key]=input.value;});return;}
  if(input.dataset.edit==='algorithm-child'){change(next=>{const moduleId=input.dataset.module||input.dataset.section;next.instances[moduleId].parameters.children=fixedAlgorithmChildren(next,moduleId);const child=next.instances[moduleId].parameters.children.find(c=>c.id===input.dataset.id);if(!child)return;const key=input.dataset.key;if(['compiled','enabled'].includes(key)){child[key]=input.checked;if(key==='compiled'&&!input.checked)child.enabled=false;}else if(key==='name')child.name=input.value;else if(Object.hasOwn(child.parameters,key))child.parameters[key]=input.type==='checkbox'?input.checked:input.dataset.valueType==='select'?input.value:readNumericInput(input);},input.type!=='checkbox'&&input.dataset.valueType!=='select');return;}

  if(input.dataset.edit==='algorithm-path'){
    change(next=>{const path=next.instances['foc-lifecycle'].parameters.protectionPaths.find(path=>path.id===input.dataset.id);if(!path)return;const key=input.dataset.key;if(!['threshold','action','enabled','compiled','name','field','operator','triggerDurationMs','recoveryDurationMs','comparisonSource','comparisonField'].includes(key))return;path[key]=['enabled','compiled'].includes(key)?input.checked:['threshold','triggerDurationMs','recoveryDurationMs'].includes(key)?readNumericInput(input):input.value;if(key==='field')path.threshold=null;if(key==='compiled'&&!path.compiled)path.enabled=false;},['threshold','name','triggerDurationMs','recoveryDurationMs'].includes(input.dataset.key));return;
  }

  if(input.dataset.edit==='platform-core') {
    const {id,child,key}=input.dataset, field=CORE_FIELDS.find(field=>field.key===key);
    if(!field)return;
    const numeric=['number','integer'].includes(field.type), value=numeric?(readNumericInput(input)):input.value;
    if(input.validity.badInput||numeric&&value!==null&&(!Number.isFinite(value)||field.type==='integer'&&!Number.isSafeInteger(value))){input.setCustomValidity('请输入有效数值。');input.reportValidity();return;}
    input.setCustomValidity('');
    change(next=>{
      const driver=id?next.catalog.drivers.find(driver=>driver.id===id):null;
      if(id&&!driver)throw new Error('驱动器不存在。');
      const mcu=driver?.mcu||next.target.mcu;
      if(!getMcuCores(mcu).some(core=>core.id===child))throw new Error('所选内核不属于当前 MCU。');
      const platform=driver?getDriverHardware(driver)['hw-platform']:next.instances['hw-platform'].parameters;
      platform.coreConfigs[child]??=createCoreSettings(mcu,child);
      platform.coreConfigs[child][key]=value;
      if(driver)setDriverHardwareParameter(driver,'hw-platform','coreConfigs',platform.coreConfigs);
      else next.provenance['hw-platform.coreConfigs']='user';
    },input.tagName==='INPUT');return;
  }
  if(['pcba-resource','trip-path'].includes(input.dataset.edit)) {
    try {
      const {edit:scope,id,key,section,owner,valueType}=input.dataset;
      const numeric=['number','integer'].includes(valueType);
      let value=valueType==='boolean'?input.checked:numeric?(readNumericInput(input)):input.value;
      if(numeric&&(input.validity.badInput||value!==null&&(!Number.isFinite(value)||valueType==='integer'&&!Number.isSafeInteger(value))))throw new Error('请输入有效数值。');
      if(scope==='trip-path'&&numeric&&value===null)throw new Error('此项需要整数。');
      input.setCustomValidity('');
      change(next=>{
        const hardware=owner?next.catalog.drivers.find(driver=>driver.id===owner)?.hardware:Object.fromEntries(Object.entries(next.instances).map(([id,instance])=>[id,instance.parameters]));
        const target=scope==='pcba-resource'?hardware['hw-board'].resources.find(item=>item.id===id):hardware['hw-safety'].tripPaths.find(item=>item.id===id);
        if(!target)throw new Error('配置条目不存在。');
        if(scope==='pcba-resource'&&key==='instance'){selectResourceInstance(target,owner?next.catalog.drivers.find(driver=>driver.id===owner).mcu:next.target.mcu,value);return;}
        if(scope==='pcba-resource'&&section==='pins'&&value==='none')value='';
        (section?target[section]:target)[key]=value;
        if(scope==='pcba-resource'&&section==='settings')syncSensorResource(hardware['hw-drivers'],hardware['hw-board'].resources);
        if(scope==='trip-path'&&key==='compiled'&&!value)target.enabled=false;
        if(scope==='trip-path'&&key==='route'&&value==='interrupt')target.filterCycles=0;
      },input.tagName==='INPUT'&&valueType!=='boolean');
      // Several device drivers may expose the same physical bus settings.
      if(scope==='pcba-resource')for(const peer of document.querySelectorAll('[data-edit="pcba-resource"]'))if(peer!==input&&peer.dataset.id===id&&peer.dataset.key===key&&peer.dataset.section===section&&(peer.dataset.owner||'')===(owner||'')){peer.value=input.value;peer.closest('[data-select-menu]')?.updateTrigger?.();}
    }catch(error){input.setCustomValidity(error.message);input.reportValidity();}
    return;
  }

  if(input.dataset.edit==='driver-command') {
    try {
      const {id,role:roleId,owner='',key,valueType}=input.dataset;
      const numeric=['number','integer'].includes(valueType);
      let value=numeric?(readNumericInput(input)):input.value;
      if(numeric&&(input.validity.badInput||value!==null&&(!Number.isFinite(value)||valueType==='integer'&&!Number.isSafeInteger(value))))throw new Error('请输入有效数值。');
      input.setCustomValidity('');
      change(next=>{
        const hardware=owner?next.catalog.drivers.find(driver=>driver.id===owner)?.hardware:Object.fromEntries(Object.entries(next.instances).map(([moduleId,instance])=>[moduleId,instance.parameters]));
        const role=SENSOR_ROLES.find(role=>role.id===roleId);
        const commands=hardware?.['hw-drivers']?.[role?.prefix+'Commands']||[];
        const command=commands.find(command=>command.id===id);
        if(!command)throw new Error('命令不存在，请重新选择。');
        if(key==='purpose'&&value==='data'&&command.purpose!=='data'&&commands.some(item=>item.purpose==='data'))throw new Error('每个通道最多一条主数据指令。');
        command[key]=value;
      },input.tagName==='INPUT');
    }catch(error){input.setCustomValidity(error.message);input.reportValidity();}
    return;
  }

  if (['configuration-actuator','configuration-driver'].includes(input.dataset.edit)) {
    try {
      const next = input.dataset.edit === 'configuration-actuator' ? selectConfigurationActuator(project,input.value) : selectConfigurationDriver(project,input.value);
      change(current=>Object.assign(current,next));
      showSuccess(input.dataset.edit === 'configuration-actuator' ? '执行器已选定' : '驱动器硬件配置已复用');
    } catch (error) { showError(error.message); render(); }
    return;
  }
  const {edit:scope,id,child,key,section,valueType}=input.dataset;
  if(scope.startsWith('schedule-')) {
    try {
      const value=['number','integer'].includes(valueType)?readNumericInput(input):input.value;
      change(next=>{
        if(scope==='schedule-entry'){moveScheduleEntry(next.design.schedule,id,value);return;}
        const task=next.design.schedule.tasks.find(task=>task.id===id);if(!task)throw Error('任务不存在。');
        if(!['name','frequencyHz','priority','budgetUs'].includes(key))throw Error('任务字段不存在。');
        if(key==='frequencyHz'&&task.trigger==='control')next.instances['app-motion'].parameters.outerHz=value;
        else task[key]=value;
      });
    }catch(error){showError(error.message);}
    return;
  }
  if(scope.startsWith('ram-')) {
    try {
      let value=valueType==='boolean'?input.checked:valueType==='address'?parseAddress(input.value):['number','integer'].includes(valueType)?(readNumericInput(input)):input.value;
      if(input.validity.badInput||typeof value==='number'&&!Number.isFinite(value))throw new Error('请输入有效数值。');
      input.setCustomValidity('');
      if(scope==='ram-bank'&&key==='cores') {
        const cores=new Set(project.memory.ram.banks.find(bank=>bank.id===id)?.cores||[]);
        input.checked?cores.add(child):cores.delete(child);value=[...cores];
      }
      const updated=ramEdit(project,scope,{id,child,key},value);
      change(next=>Object.assign(next,updated),input.tagName==='INPUT'&&input.type!=='checkbox');
    }catch(error){input.setCustomValidity(error.message);input.reportValidity();}
    return;
  }
  if(scope.startsWith('memory-')||scope.startsWith('execution')) {
    try {
      let value=valueType==='boolean'?input.checked:valueType==='address'?parseAddress(input.value):['number','integer'].includes(valueType)?(readNumericInput(input)):input.value;
      if(input.validity.badInput||typeof value==='number'&&!Number.isFinite(value))throw new Error('请输入有效数值。');
      input.setCustomValidity('');
      if(scope==='memory-generator'){sectorSizes[id]=value;return;}
      const updated=deploymentEdit(project,scope,{id,child,key},value);change(next=>Object.assign(next,updated),input.tagName==='INPUT'&&input.type!=='checkbox');
    }catch(error){input.setCustomValidity(error.message);input.reportValidity();}
    return;
  }
  if(scope==='layer-draft'){versionDrafts[id]??={version:'',interfaceVersion:'',notes:'',requires:{hardware:'',foc:'',app:''}};if(key==='requires')versionDrafts[id].requires[section]=input.value;else versionDrafts[id][key]=input.value;return;}
  if(scope==='layer-selection'){try{const updated=selectLayerVersion(project,id,input.value);change(next=>Object.assign(next,updated));}catch(error){showNotice(error.message,{level:'error'});}return;}
  if(scope==='module-optimization'){change(next=>{next.build.moduleOptimizations??={};if(input.value==='inherit')delete next.build.moduleOptimizations[id];else next.build.moduleOptimizations[id]=input.value;},true);return;}
  if(scope==='assembly-draft'){assemblyDraft.name=input.value;return;}
  if(scope==='selection'){if(!input.value)return;try{const applied=key==='assemblyId'?applyAssembly(project,input.value):applyDriver(project,input.value);change(next=>Object.assign(next,applied));showSuccess('选型已应用，硬件配置已复用');}catch(error){showError(error.message);render();}return;}
  if(scope==='structure-input'){if(!input.value)return;if(getModuleContractRole(project.design,input.value)){showNotice('模块结构的连接请在所属模块的接口页配置。');return;}change(next=>{const s=next.design.structures.find(s=>s.id===input.value);if(s&&!s.consumers.includes(id))s.consumers.push(id);});return;}
  let value=valueType==='boolean'||scope==='consumer'?input.checked:input.value;
  if(valueType==='number'||valueType==='integer') {
    value=readNumericInput(input);
    if(input.validity.badInput||(value!==null&&(!Number.isFinite(value)||(valueType==='integer'&&!Number.isSafeInteger(value))))) {
      input.setCustomValidity(valueType==='integer'?'请输入有效整数。':'请输入有效数值。');input.reportValidity();return;
    }
    input.setCustomValidity('');
  }
  if(typeof value==='number'&&input.dataset.valueScale)value/=1/Number(input.dataset.valueScale);
  if(value===null&&((scope==='field'&&key==='count')||(scope==='fault'&&key==='code')||(scope==='message'&&key==='opcode')||(scope==='protocol'&&key==='version'))) {
    const old=scope==='field'?project.design.structures.find(x=>x.id===id)?.fields.find(x=>x.id===child)?.[key]:scope==='fault'?project.design.faults.find(x=>x.id===id)?.[key]:scope==='message'?project.design.protocol.messages.find(x=>x.id===id)?.[key]:project.design.protocol[key];
    input.value=String(old);input.setCustomValidity('此项需要整数，已保留原值。');input.reportValidity();return;
  }
  try {
    change(next=>{
      let target;
      if(scope==='structure') {
        if((key==='owner'||key==='consumers')&&getModuleContractRole(next.design,id))throw new Error('模块结构归属固定。');
        target=next.design.structures.find(x=>x.id===id);
      }
      if(scope==='layer-interface') {
        target=next.design.layerInterfaces.find(x=>x.id===id);
        if(target&&['fromModule','toModule'].includes(key)) {
          target[key]=value;
          target.sourceStructure=next.design.moduleContracts[target.fromModule]?.output||'';
          target.targetStructure=next.design.moduleContracts[target.toModule]?.input||'';
          target.fieldMap=[];
          return;
        }
      }
      if(scope==='interface-mapping')target=next.design.layerInterfaces.find(x=>x.id===id)?.fieldMap.find(x=>x.id===child);
      if(scope==='field')target=next.design.structures.find(x=>x.id===id)?.fields.find(x=>x.id===child);
      if(scope==='fault')target=next.design.faults.find(x=>x.id===id);
      if(scope==='protocol')target=next.design.protocol;
      if(scope==='message')target=next.design.protocol.messages.find(x=>x.id===id);
      if(scope==='build')target=next.build;
      if(scope==='operation')target=next.operation;
      if(scope==='actuator'){target=next.catalog.actuators.find(x=>x.id===id);if(section)target=target?.[section];}
      if(scope==='driver-hardware'){const driver=next.catalog.drivers.find(x=>x.id===id);setDriverHardwareParameter(driver,section,key,value);if(section==='hw-drivers'&&key.endsWith('Resource'))syncSensorResource(driver.hardware[section],driver.hardware['hw-board'].resources||[],key.slice(0,-8));return;}
      if(scope==='driver')target=next.catalog.drivers.find(x=>x.id===id);
      if(scope==='binding')target=next.catalog.drivers.find(x=>x.id===id)?.bindings.find(x=>x.id===child);
      if(scope==='assembly')target=next.catalog.assemblies.find(x=>x.id===id);
      if(scope==='consumer') { if(getModuleContractRole(next.design,id))throw new Error('模块结构的连接请在所属模块的接口页配置。'); const s=next.design.structures.find(x=>x.id===id);if(!s)throw new Error('结构不存在。');s.consumers=value?[...new Set([...s.consumers,key])]:s.consumers.filter(x=>x!==key);return; }
      if(!target)throw new Error('编辑的条目已不存在，请重新选择。');
      target[key]=value;
      if(scope==='driver'){target.hardware=getDriverHardware(target);syncMcuArchitecture(target,target.hardware,{replaceCores:key==='mcu'});}
    }, !((scope==='driver-hardware'&&moduleById(section)?.params.find(p=>p.key===key)?.sensorLayoutTrigger)||(scope==='driver'&&key==='mcu')||(scope==='layer-interface'&&['fromModule','toModule'].includes(key))));
    if(scope==='driver'){const vendor=$('[data-edit="driver"][data-key="vendor"]');if(vendor){vendor.value=project.catalog.drivers.find(d=>d.id===id).vendor;vendor.closest('[data-select-menu]')?.updateTrigger?.();}}
  }catch(error){showError(error.message);}
}

function pickPart(kind,id) {
  if(!['actuator','driver','firmware'].includes(kind))return;
  const list=kind==='firmware'?firmwareLibrary.bundles:project.catalog[kind==='actuator'?'actuators':'drivers'];
  if(!list.some(item=>item.id===id))return;
  assemblyDraft[kind+'Id']=id;render();
}
function endPartDrag() {
  if(draggedPart?.card.hasPointerCapture?.(draggedPart.pointerId))draggedPart.card.releasePointerCapture(draggedPart.pointerId);
  draggedPart?.ghost?.remove();draggedPart=null;
  document.body.classList.remove('dragging-part');
  document.querySelectorAll('.drag-over,.drag-invalid,.dragging').forEach(el=>el.classList.remove('drag-over','drag-invalid','dragging'));
}
document.addEventListener('dragstart',event=>{if(event.target.closest?.('[data-drag-kind]'))event.preventDefault();});
document.addEventListener('pointerdown',event=>{
  const card=event.target.closest?.('[data-drag-kind]');
  if(!card||event.button!==0||event.target.closest('button')||!event.isPrimary)return;
  endPartDrag();
  draggedPart={kind:card.dataset.dragKind,id:card.dataset.id,card,pointerId:event.pointerId,x:event.clientX,y:event.clientY,active:false};
  card.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove',event=>{
  const part=draggedPart;
  if(!part||part.pointerId!==event.pointerId)return;
  if(!part.active&&Math.hypot(event.clientX-part.x,event.clientY-part.y)<6)return;
  if(!part.active){
    part.active=true;part.card.classList.add('dragging');document.body.classList.add('dragging-part');
    part.ghost=document.createElement('div');part.ghost.className='part-drag-preview';part.ghost.setAttribute('aria-hidden','true');
    part.ghost.textContent=part.card.querySelector('strong').textContent;document.body.append(part.ghost);
  }
  part.ghost.style.left=`${event.clientX+12}px`;part.ghost.style.top=`${event.clientY+12}px`;
  const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-drop-kind]');
  document.querySelectorAll('[data-drop-kind]').forEach(slot=>{
    slot.classList.toggle('drag-over',slot===target&&slot.dataset.dropKind===part.kind);
    slot.classList.toggle('drag-invalid',slot===target&&slot.dataset.dropKind!==part.kind);
  });
});
document.addEventListener('pointerup',event=>{
  const part=draggedPart;
  if(!part||part.pointerId!==event.pointerId)return;
  const slot=part.active?document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-drop-kind]'):null;
  endPartDrag();
  if(slot?.dataset.dropKind===part.kind){pickPart(part.kind,part.id);showSuccess(`已放入${part.kind==='actuator'?'执行器':'驱动器'}`);}
  else if(slot)showNotice('请将组件放入对应位置',{level:'warning'});
});
document.addEventListener('pointercancel',endPartDrag);
document.addEventListener('keydown',event=>{if(event.key==='Escape')endPartDrag();});
window.addEventListener('blur',endPartDrag);

document.addEventListener('click', event => {
  if (event.target.closest('.skip-link')) { event.preventDefault(); $('#workspace').focus(); return; }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (performanceController.action(action, button.dataset)) return;
  if(action==='toggle-visual-motion') {motionEnabled=!motionEnabled;lineFields?.setEnabled(motionEnabled);updateMotionToggle();try{localStorage.setItem('actuator-console.motion',motionEnabled?'on':'off');}catch{}return;}
  if(action==='toggle-sidebar'){const root=document.documentElement;const collapsed=root.dataset.sidebar==='collapsed';if(collapsed)delete root.dataset.sidebar;else root.dataset.sidebar='collapsed';const toggle=$('#sidebar-toggle');toggle?.setAttribute('aria-expanded',String(collapsed));toggle?.setAttribute('aria-label',collapsed?'折叠侧栏':'展开侧栏');toggle?.setAttribute('title',collapsed?'折叠侧栏':'展开侧栏');try{localStorage.setItem('abd-foc.sidebar',collapsed?'open':'collapsed')}catch{}return;}
  if(action==='toggle-notification-history'){toggleNotificationHistory();return;}
  if(action==='close-notification-history'){closeNotificationHistory();return;}
  if(action==='filter-notifications'){notificationFilter=button.dataset.filter;renderNotificationHistory();return;}
  if(action==='read-notifications'){notificationHistory.markAllRead();return;}
  if(action==='clear-notifications'){notificationHistory.clear();notifications.show('历史通知已清空',{level:'success'});return;}
  if(action==='notification-detail'){
    const entry=notificationHistory.entries.find(item=>item.id===button.dataset.id);
    if(!entry)return;
    notificationHistory.markRead(entry.id);
    showNoticeDialog(`${new Date(entry.updatedAt).toLocaleString('zh-CN')} · ${entry.projectName||'ABD-FOC'}\n\n${entry.message}`,{...entry,title:entry.title||'通知详情',allowNavigation:entry.projectId===project.id});
    return;
  }
  if (action === 'toggle-module' || action === 'toggle-runtime') return;
  if (handleDesignAction(action,button.dataset)) return;
  if (action === 'navigate') navigate(button.dataset.to);
  if (action === 'select-module') navigate(moduleRoute(button.dataset.module, button.dataset.tab));
  if (action === 'validate') { render(); showIssueResults(issues); }
  if(action==='close-notification')$('#notification-dialog').close();
  if(action==='show-issue-level')showIssueResults(issues.filter(issue=>issue.level===button.dataset.level));
  if(action==='show-issues'){let selected=issues;if(button.dataset.issueIds){try{const ids=new Set(JSON.parse(button.dataset.issueIds));selected=issues.filter(issue=>ids.has(issue.id));}catch{selected=[];}}showIssueResults(selected,button.dataset.noticeTitle||'检查结果');}
  if (action === 'import') { $('#import-file').value = ''; $('#import-file').click(); }
  if (action === 'new-configuration') { if (applyConfiguration(createProject())) showSuccess('已建立空白配置，货架与测试记录已保留。'); }
  if (action === 'save') {
    clearTimeout(autosaveTimer);
    try { saveDraft(); saveState = '配置已保存到此浏览器'; render(); showSuccess(performanceController.hasUnsavedDraft() ? '配置已保存。测量表还有未提交的修改，请在测试页点击“保存记录”。' : '配置已保存。可导出 JSON 备份。'); }
    catch { saveState = '有修改 · 尚未保存'; render(); showError('浏览器存储不可用。请在设置中“导出全部数据”保存当前货架、配置和测试记录。'); }
  }
  if (action === 'export' || action === 'export-workspace' || action === 'export-runtime-config') {
    let serialized;
    try { serialized = action === 'export-runtime-config' ? JSON.stringify(runtimeConfiguration(project), null, 2) : action === 'export-workspace' ? serializeProject(project) : exportConfiguration(project); }
    catch (error) { showError(`导出失败：${error.message}`); return; }
    const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = action === 'export-runtime-config' ? 'runtime-config.json' : action === 'export-workspace' ? `ABD-FOC-data-${new Date().toISOString().slice(0,10)}.json` : `${(project.name || 'configuration').replace(/[\\/:*?"<>|]/g, '-').slice(0, 70)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showSuccess(action === 'export-workspace' ? '已导出全部货架、配置与已保存的测试记录' : '已导出配置 JSON');
  }
});

document.addEventListener('input',event=>{if(!event.target.dataset.liveValidation)event.target.setCustomValidity?.('');});
window.addEventListener('beforeunload', event => { if (performanceController.hasUnsavedDraft()) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('change', event => {
  const input = event.target;
  if (performanceController.edit(input)) return;
  if(input.tagName==='SELECT')input.dataset.empty=String(isEmptyChoice(input.value));
  if (input.dataset.edit) { handleDesignEdit(input); return; }
  if (input.dataset.action === 'toggle-module') {
    const module = moduleById(input.dataset.module);
    if (!module || module.required) { render(); return; }
    change(next => { next.instances[module.id].enabled = input.checked; if(!input.checked)next.instances[module.id].runtimeEnabled=false; });
    return;
  }
  if (input.dataset.action === 'toggle-runtime') {
    const module=moduleById(input.dataset.module);
    if(!module?.runtimeSwitchable||!enabled(module.id)){render();return;}
    change(next=>{next.instances[module.id].runtimeEnabled=input.checked;});
    return;
  }
  const { scope, module: moduleId, key } = input.dataset;
  if (!scope) return;
  if (scope === 'project' && key === 'name') { change(next => { next.name = input.value.trim().slice(0, 80) || '未命名配置'; }, true); return; }
  const field = scope === 'target' ? TARGET_FIELDS.find(item => item.key === key) : moduleById(moduleId)?.params.find(item => item.key === key);
  if (!field || field.computed) return;
  let value;
  if (input.dataset.presence) value = input.checked ? 'present' : 'absent';
  else if (field.type === 'boolean') value = input.checked;
  else if (field.type === 'multiselect') {
    const current = project.instances[moduleId].parameters[key];
    value = new Set(Array.isArray(current) ? current : []);
    input.checked ? value.add(input.value) : value.delete(input.value);
    value = [...value];
  } else if (['number','integer'].includes(field.type)) {
    value = readNumericInput(input);
    if (input.validity.badInput || (value !== null && (!Number.isFinite(value) || (field.type === 'integer' && !Number.isSafeInteger(value))))) {
      input.setCustomValidity(field.type === 'integer' ? '请输入有效整数，或清空保留为待配置。' : '请输入有限数值，或清空保留为待配置。');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
  }
  else value = input.value;
  change(next => {
    if (scope === 'target') { next.target[key] = value; if(key==='mcu'||key==='vendor'){const hardware=Object.fromEntries(MODULES.filter(m=>m.layer==='hardware').map(m=>[m.id,next.instances[m.id].parameters]));syncMcuArchitecture(next.target,hardware,{replaceCores:key==='mcu'});} }
    else { next.instances[moduleId].parameters[key] = value; if(moduleId==='hw-drivers'&&key.endsWith('Resource'))syncSensorResource(next.instances[moduleId].parameters,next.instances['hw-board'].parameters.resources||[],key.slice(0,-8)); if(moduleId==='app-calibration'&&key==='procedures')next.instances[moduleId].parameters.enabledProcedures=next.instances[moduleId].parameters.enabledProcedures.filter(item=>value.includes(item)); next.provenance[`${moduleId}.${key}`] = 'user'; }
  }, !['select','multiselect'].includes(field.type)&&!field.sensorLayoutTrigger&&!(scope==='target'&&key==='mcu')&&!(moduleId==='app-calibration'&&key==='procedures')&&!(moduleId==='app-state'&&key==='stateMachine'));
  if(scope==='target'){const vendor=$('[data-scope="target"][data-key="vendor"]');if(vendor){vendor.value=project.target.vendor;vendor.closest('[data-select-menu]')?.updateTrigger?.();}}
});

document.addEventListener('click',event=>{nativeClient.menuEvent(event);const button=event.target.closest('[data-native-action]');if(button&&!button.disabled)nativeClient.action(button.dataset.nativeAction,button.dataset);});
document.addEventListener('keydown',event=>nativeClient.menuEvent(event));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#notification-history').hidden){closeNotificationHistory();event.preventDefault();}});
document.addEventListener('click',event=>{if(!$('#notification-history').hidden&&!$('#notification-history').contains(event.target)&&!$('#notification-history-toggle').contains(event.target))closeNotificationHistory(false);});
document.addEventListener('change',event=>{if(event.target.dataset.nativeField)nativeClient.edit(event.target);});
window.addEventListener('resize',()=>nativeClient.draw($('#workspace')));

$('#import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 32 * 1024 * 1024) { showError('文件超过 32 MiB，请选择工程 JSON。'); return; }
  try {
    const next = parseProject(await file.text());
    if (applyConfiguration(next)) showSuccess('配置已导入，货架与测试记录已保留。');
  } catch (error) { showError(`导入失败，当前配置未更改：${error.message}`); }
});
$('#notification-dialog').addEventListener('close',()=>displayedNotices.clear());
$('#notification-dialog').addEventListener('click',event=>{const dialog=$('#notification-dialog');if(event.target.closest('a'))dialog.close();else if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
window.addEventListener('hashchange', () => {
  const previous=renderedRoute;
  const sameContext=previous!==null&&navigationContext(previous)===navigationContext(location.hash);
  const clicked=pendingNavigationScroll?.to===location.hash?pendingNavigationScroll:null;
  const restore=sameContext?(clicked||navigationPositions.get(previous)):navigationPositions.get(location.hash);
  pendingNavigationScroll=null;
  render();
  if(revealSavedAssembly&&route().page==='equipment'){revealSavedAssembly=false;$('.design-editor')?.scrollIntoView({block:'start',behavior:'instant'});}
  else if(clicked?.reveal)revealConfigurationTarget(clicked);
  else if(restore)window.scrollTo({...restore,behavior:'instant'});
  else if (route().page === 'project' && route().moduleId) {
    document.querySelector(`[data-guide-module="${route().moduleId}"]`)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  } else window.scrollTo({ top: 0, behavior: 'instant' });
  navigationPositions.set(location.hash,{left:scrollX,top:scrollY});
});
window.addEventListener('beforeunload', () => { configurationTree.capture($('#workspace')); try { saveDraft(); } catch {} });
installSourceView(document,showNotice);
const firmwareLibrary = createFirmwareLibrary({render,notify:showNotice});
render();
enhanceSelectMenus(document);
const sidebarToggle = $('#sidebar-toggle');
if (sidebarToggle) { const expanded = document.documentElement.dataset.sidebar !== 'collapsed'; sidebarToggle.setAttribute('aria-expanded', String(expanded)); sidebarToggle.setAttribute('aria-label', expanded ? '折叠侧栏' : '展开侧栏'); sidebarToggle.title = expanded ? '折叠侧栏' : '展开侧栏'; }
const sidebarResizer = $('.sidebar-resizer');
if (sidebarResizer) {
  let resizing = false;
  const clampWidth = value => Math.max(150, Math.min(420, Math.round(value)));
  const applyWidth = value => document.documentElement.style.setProperty('--sidebar-width', `${clampWidth(value)}px`);
  const saveWidth = () => { try { localStorage.setItem('abd-foc.sidebar-width', document.documentElement.style.getPropertyValue('--sidebar-width')); } catch {} };
  sidebarResizer.addEventListener('pointerdown', event => { resizing = true; sidebarResizer.setPointerCapture(event.pointerId); document.body.classList.add('sidebar-resizing'); });
  sidebarResizer.addEventListener('pointermove', event => { if (resizing) applyWidth(event.clientX); });
  const stopResizing = () => { if (!resizing) return; resizing = false; document.body.classList.remove('sidebar-resizing'); saveWidth(); };
  sidebarResizer.addEventListener('pointerup', stopResizing);
  sidebarResizer.addEventListener('pointercancel', stopResizing);
  sidebarResizer.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 190;
    event.preventDefault();
    applyWidth(current + (event.key === 'ArrowRight' ? 16 : -16));
    saveWidth();
  });
}
renderNotificationHistory();
if (recoveryNotice) showError(recoveryNotice);
nativeClient.refresh();
