import { renderModuleSchedule } from './schedule-view.mjs';
import { inputAdapter } from '../../modules/entrypoints.mjs';
import { resolveFieldReference } from '../../core/interface-defaults.mjs';
import { MODULES, LAYERS } from '../../core/catalog.mjs';
import { edit, esc, rid } from './view.mjs';
import { issueNoticeButton } from '../../shared/ui/issue-notices.mjs';

const moduleName = id => MODULES.find(module => module.id === id)?.title || '待选择模块';
const moduleChoices = [['', '待选择'], ...LAYERS.flatMap(layer => MODULES.filter(module => module.layer === layer.id).map(module => [module.id, `${layer.name} · ${module.title}`]))];
const button = (label, action, id = '', child = '') => `<button type="button" class="button" data-action="${action}" data-id="${esc(id)}" data-child="${esc(child)}">${esc(label)}</button>`;

function endpoint(project, moduleId, role) {
  const id = project.design.moduleContracts?.[moduleId]?.[role];
  return project.design.structures.find(structure => structure.id === id);
}
function structureLink(structure, moduleId, label) {
  return `<div class="form-field"><span class="field-label">${esc(label)}</span>${structure ? `<a class="computed-field" href="#/project/structures/${rid(structure.id)}?module=${rid(moduleId)}"><strong>${esc(structure.name || '未命名结构')}</strong><span>${structure.fields.length} 个字段 · 编辑结构 →</span></a>` : '<output class="computed-field">选择模块后关联结构</output>'}</div>`;
}
function fieldChoices(structure, selected) {
  const fields = structure?.fields || [];
  const choices = [['', '待选择字段'], ...fields.flatMap(field => [
    [field.id, `${field.name || '未命名字段'} · ${field.type}${field.count === 1 ? '' : `[${field.count}]`}${field.unit ? ` · ${field.unit}` : ''}`],
    ...Array.from({length:field.count>1?Math.min(field.count,256):0},(_,index)=>[`${field.id}[${index}]`,`${field.name}[${index}] · ${field.type}`]),
  ])];
  if (selected && !choices.some(([id])=>id===selected)) {
    const field=resolveFieldReference(structure,selected);
    choices.push([selected,field?`${field.name} · ${field.type}`:`字段已不存在 · ${selected}`]);
  }
  return choices;
}
function interfaceHealth(issues, id) {
  const relevant = issues.filter(issue => ['interfaces', 'layer-interfaces'].includes(issue.designPage) && (!issue.itemId || issue.itemId === id));
  return `<div class="design-health" data-live="interface-health-${esc(id)}">${issueNoticeButton(relevant, { label: '查看接口检查' })}</div>`;
}

export function renderModuleInterfaces(project, issues, moduleId, interfaceId = '') {
  const module = MODULES.find(item => item.id === moduleId);
  if (!module) return '';
  const items = (project.design.layerInterfaces || []).filter(item => item.fromModule === moduleId || item.toModule === moduleId);
  const add = (direction,label) => `<button class="button small" type="button" data-action="add-layer-interface" data-module="${esc(moduleId)}" data-direction="${direction}">${label}</button>`;
  return `${renderModuleSchedule(project,moduleId)}${renderInputSources(project,moduleId)}<section class="module-interfaces"><div class="design-toolbar"><h3>模块接口</h3><div class="configuration-file-actions">${add('input','新增输入接口')}${add('output','新增输出接口')}</div></div>
    <div class="module-interface-list">${items.map(item=>`<details class="resource-disclosure hardware-resource module-interface-card" data-state-key="interface-${esc(item.id)}" ${item.id===interfaceId?'open':''}><summary><span class="hardware-resource-kind">${item.toModule===moduleId?'输入':'输出'}</span><strong data-live="interface-summary-${esc(item.id)}">${esc(item.name||'未命名接口')}</strong><span class="hardware-resource-meta">${esc(moduleName(item.fromModule))} → ${esc(moduleName(item.toModule))}</span></summary><div class="hardware-resource-body module-interface-editor">${renderInterfaceEditor(project,issues,item)}</div></details>`).join('') || '<p class="design-note">此模块的输入由平台或应用适配器提供。需要连接其他模块时，可新增字段映射。</p>'}</div></section>`;
}

function renderInterfaceEditor(project, issues, item) {
  const meta = { id: item.id };
  const source = endpoint(project, item.fromModule, 'output');
  const target = endpoint(project, item.toModule, 'input');
  return `<div class="design-toolbar"><h2 data-live="interface-title-${esc(item.id)}">${esc(item.name || '未命名接口')}</h2>${button('移除接口', 'remove-layer-interface', item.id)}${button('撤销', 'undo')}</div>
    <div class="design-meta">${edit('接口名称', item.name, 'layer-interface', 'name', meta)}${edit('接口版本', item.version, 'layer-interface', 'version', meta)}${edit('来源模块', item.fromModule, 'layer-interface', 'fromModule', { ...meta, choices: moduleChoices })}${edit('目标模块', item.toModule, 'layer-interface', 'toModule', { ...meta, choices: moduleChoices })}</div>
    <div class="design-meta interface-endpoints" data-live="interface-endpoints-${esc(item.id)}">${structureLink(source, item.fromModule, '来源 · 输出结构')}${structureLink(target, item.toModule, '目标 · 输入结构')}</div>
    <div class="design-meta">${edit('更新时序', item.rate, 'layer-interface', 'rate', { ...meta, choices: [['unselected', '待选择'], ['fast', '电流环控制周期'], ['control', '应用控制任务'], ['background', '后台任务'], ['event', '事件触发']] })}${edit('数据交接方式', item.handoff, 'layer-interface', 'handoff', { ...meta, choices: [['unselected', '待选择'], ['snapshot', '一致性快照'], ['queue', '消息队列'], ['call', '同周期直接传递']] })}${edit('接口说明', item.notes, 'layer-interface', 'notes', { ...meta, area: true })}</div>
    ${interfaceHealth(issues, item.id)}
    <div class="design-toolbar"><h3>字段映射</h3>${button('添加映射', 'add-interface-mapping', item.id)}</div>
    <p class="design-note">映射从输出字段指向输入字段。切换任一模块会清空现有映射；状态结构不作为接口端点。</p>
    <div class="contract-table-wrap"><table class="contract-table interface-mapping-table"><thead><tr><th scope="col">来源输出字段</th><th scope="col">目标输入字段</th><th scope="col">操作</th></tr></thead><tbody>${(item.fieldMap || []).map(mapping => `<tr><td>${edit('来源字段', mapping.sourceField, 'interface-mapping', 'sourceField', { id: item.id, child: mapping.id, choices: fieldChoices(source, mapping.sourceField) })}</td><td>${edit('目标字段', mapping.targetField, 'interface-mapping', 'targetField', { id: item.id, child: mapping.id, choices: fieldChoices(target, mapping.targetField) })}</td><td>${button('移除', 'remove-interface-mapping', item.id, mapping.id)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">尚未添加字段映射。</td></tr>'}</tbody></table></div>`;
}

function renderInputSources(project,moduleId) {
  const input=endpoint(project,moduleId,'input');
  if(!input)return '';
  return `<details class="module-input-sources" data-state-key="input-sources-${moduleId}" open><summary>输入来源 <span class="muted">${input.fields.length} 个字段</span></summary><div class="contract-table-wrap"><table class="contract-table"><thead><tr><th>输入字段</th><th>来源</th><th>交接</th></tr></thead><tbody>${input.fields.map(field=>{
    const links=project.design.layerInterfaces.filter(item=>item.toModule===moduleId).flatMap(item=>item.fieldMap.filter(map=>map.targetField===field.id||map.targetField.startsWith(field.id+'[')).map(map=>({item,map})));
    const adapter=inputAdapter(project,moduleId,field.name);
    return `<tr><td><code>${esc(field.name)}</code></td><td>${links.length?links.map(({item,map})=>{const source=project.design.structures.find(s=>s.id===item.sourceStructure),f=resolveFieldReference(source,map.sourceField);return `<span>${esc(moduleName(item.fromModule))} · <code>${esc(f?.name||'字段已删除')}</code>${project.instances[item.fromModule]?.enabled?'':' · 未编译'}</span>`;}).join('<br>'):esc(adapter||'待连接')}</td><td>${links.length?links.map(({item})=>esc({call:'同周期',snapshot:'快照',queue:'队列'}[item.handoff]||'待选择')).join(' / '):adapter?'适配输入':'—'}</td></tr>`;
  }).join('')}</tbody></table></div></details>`;
}
