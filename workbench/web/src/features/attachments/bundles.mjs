import {renderFirmwareLibrary} from './view.mjs';
import { esc } from '../../shared/esc.mjs';
import { FIRMWARE_KINDS } from './model.mjs';
export const COMPONENT_KINDS=FIRMWARE_KINDS.filter(([kind])=>kind!=='combined');
export function createFirmwareBundle(values,records) {
  const name=String(values.name||'').trim(),version=String(values.version||'').trim();
  if(!name||!version||name.length>120||version.length>120)throw Error('请填写固件名称和版本号（最多 120 个字符）。');
  const components=COMPONENT_KINDS.map(([kind,label])=>{
    const record=records.find(item=>item.id===values[kind]&&item.kind===kind);
    if(!record)throw Error(`请选择${label}版本。`);
    return {kind,id:record.id,name:record.name,version:record.version,target:record.target,sha256:record.sha256};
  });
  return {id:crypto.randomUUID(),kind:'bundle',name,version,versionKey:JSON.stringify(['bundle',name,version]),components,createdAt:Date.now()};
}
export function renderFirmwareComponents(state,id='') {
  const bundles=state.bundles||[];
  const entries=[...bundles.map(item=>({...item,displayKind:'combined'})),...state.records.map(item=>({...item,displayKind:item.kind}))];
  const visible=entries.filter(item=>!state.componentKind||item.displayKind===state.componentKind);
  const selected=['new','upload'].includes(id)?null:visible.find(item=>item.id===id)||visible[0];
  const categoryTags=`<div class="equipment-tabs firmware-category-tabs" role="group" aria-label="固件分类">${FIRMWARE_KINDS.map(([key,label])=>`<button class="${state.componentKind===key?'active':''}" data-firmware-component-kind="${key}" aria-pressed="${state.componentKind===key}">${label}<span>${entries.filter(item=>item.displayKind===key).length}</span></button>`).join('')}</div>`;
  const toolbar=`<div class="firmware-toolbar"><div class="firmware-toolbar-actions"><a class="button small" href="#/equipment/firmware/new">新建固件 →</a></div>${categoryTags}</div>`;
  const categoryName=FIRMWARE_KINDS.find(([key])=>key===state.componentKind)?.[1];
  const emptyList=`<div class="firmware-list-empty" role="status"><span class="firmware-empty-mark" aria-hidden="true">(・ω・)</span><strong>${state.loading?'正在整理固件啦…':state.error?'固件读取失败':categoryName?`这里还没有${categoryName}哦`:'固件小货架还是空的呢'}</strong><p>${state.loading?'':state.error?'请刷新页面重试。':categoryName?'添一个版本，就能在这里找到它啦～':'先上传子固件，再把喜欢的版本搭配起来吧～'}</p></div>`;
  const sidebar=`<aside class="panel performance-history shelf-history"><div class="design-toolbar"><h2>固件</h2><span class="muted">${visible.length}</span></div>${visible.map(item=>`<a class="performance-history-item shelf-history-item ${item===selected?'active':''}" data-part-kind="firmware" href="#/equipment/firmware/${encodeURIComponent(item.id)}"><strong>${esc(item.name)}</strong><span class="attribute-tag">${esc(item.version)}</span><span class="attribute-tag">${FIRMWARE_KINDS.find(([key])=>key===item.displayKind)?.[1]}</span></a>`).join('')||emptyList}</aside>`;
  if(id==='upload'||(selected&&selected.kind!=='bundle'))return `${toolbar}<div class="design-layout">${sidebar}<section class="design-editor">${renderFirmwareLibrary({...state,records:selected?[selected]:[],editId:state.editId===selected?.id?state.editId:''},{detail:true,create:id==='upload'})}</section></div>`;
  return `${toolbar}<div class="design-layout">${sidebar}<section class="design-editor">${selected?`<div class="design-toolbar"><h2>${esc(selected.name)}</h2><span class="attribute-tag">${esc(selected.version)}</span></div><div class="firmware-composition">${selected.components.map((part,index)=>`<article class="panel"><span class="attribute-tag">0${index+1} ${COMPONENT_KINDS.find(([kind])=>kind===part.kind)?.[1]}</span><h3>${esc(part.name)}</h3><span class="attribute-tag">${esc(part.version)}</span><p>${esc(part.target)}</p><button class="button small" data-firmware-action="download" data-id="${esc(part.id)}">下载文件</button></article>`).join('')}</div><a class="button navigation-action" href="#/equipment/assemblies">搭配关节模组 →</a>`:`<h2>新建固件</h2><form data-firmware-bundle-form><div class="profile-form"><label class="form-field"><span class="field-label">固件名称</span><input name="name" required maxlength="120"></label><label class="form-field"><span class="field-label">版本号</span><input name="version" required maxlength="120"></label>${COMPONENT_KINDS.map(([kind,label])=>`<label class="form-field"><span class="field-label">${label}</span><select name="${kind}" class="field-select" required><option value="">选择版本</option>${state.records.filter(item=>item.kind===kind).map(item=>`<option value="${esc(item.id)}">${esc(item.name)} / ${esc(item.version)} / ${esc(item.target)}</option>`).join('')}</select></label>`).join('')}</div><div class="firmware-form-actions"><a class="button" href="#/equipment/firmware/upload">上传子固件 →</a><button class="button primary" type="submit">保存组合</button></div></form>`}</section></div>`;
}
export function firmwareTray(state,draft) {
 return `<section class="parts-tray firmware-parts-tray"><div class="parts-tray-title"><h3>固件</h3><a class="button small" href="#/equipment/firmware">管理 →</a></div><div class="parts-items">${(state.bundles||[]).map(item=>`<article class="part-card ${draft.firmwareId===item.id?'selected':''}" data-drag-kind="firmware" data-id="${esc(item.id)}"><div><strong>${esc(item.name)}</strong><span class="attribute-tag">${esc(item.version)}</span></div><button class="part-select" data-action="pick-part" data-kind="firmware" data-id="${esc(item.id)}" aria-label="选用${esc(item.name)}">＋</button></article>`).join('')||'<a class="button small" href="#/equipment/firmware/new">新建固件 →</a>'}</div></section>`;
}
