import { coreArchitectureName, getMcuCores } from '../../modules/hardware/hw-platform/targets.mjs';
import { coreFields, validateCoreConfigs } from '../../modules/hardware/hw-platform/cores.mjs';
import { edit, esc } from './view.mjs';
import { icon } from '../../shared/ui/icons.mjs';

/** Shared by project configuration and reusable driver hardware. */
export function renderPlatformConfiguration(mcu, platform, fields, renderField, {project, owner=''}={}) {
  const cores=getMcuCores(mcu), issues=validateCoreConfigs(mcu,platform,project);
  const unknown=Object.keys(platform.coreConfigs||{}).filter(id=>!cores.some(core=>core.id===id));
  const basicClock=fields.filter(field=>['clockSource','oscillatorHz'].includes(field.key));
  const dualArm=cores.some(core=>core.id==='cm7')&&cores.some(core=>core.id==='cm4');
  return `<div class="platform-flat">${fields.filter(field=>!field.group).map(renderField).join('')}
    <section class="hardware-resource platform-flat-section"><header class="hardware-resource-heading">${icon('clock')}<strong>时钟配置</strong></header><div class="hardware-resource-body"><div class="profile-form">${basicClock.map(renderField).join('')}</div></div></section>
    <div class="platform-cores">${cores.map((core,coreIndex)=>{
      const params=platform.coreConfigs?.[core.id]||{};
      const visible=coreFields(mcu,core.id,project).filter(field=>!['floatAbi','systemTickHz'].includes(field.key));
      const renderCoreField=field=>{
        const cache=['instructionCache','dataCache'].includes(field.key);
        const value=params[field.key], state=['enabled','disabled'].includes(value)?value:'unconfigured';
        const control=edit(field.label,cache?value==='enabled':value,'platform-core',field.key,{id:owner,child:core.id,type:cache?'boolean':field.type,min:field.min,max:field.max,unit:field.unit,phase:field.phase,description:field.description,...(!cache?{choices:field.options?.map(option=>[option.value,option.label])}:{})});
        const html=cache?control.replace('<input ',`<input id="platform-cache-${esc(encodeURIComponent(owner||'project'))}-${core.id}-${field.key}" `).replace('class="checkbox-field switch-field"','class="checkbox-field switch-field platform-cache-switch"').replace('data-value-type="boolean"',`data-value-type="cache-state" data-cache-state="${state}" aria-checked="${state==='unconfigured'?'mixed':String(value==='enabled')}"`):control;
        const errors=issues.filter(issue=>issue.level==='error'&&issue.coreId===core.id&&issue.coreKey===field.key);
        return html.replace(/<\/div>$/,`${errors.map(issue=>`<p class="field-error">${esc(issue.message)}</p>`).join('')}</div>`);
      };
      return `<section class="hardware-resource platform-flat-section platform-core" data-core="${core.id}"><header class="hardware-resource-heading">${icon('chip')}<strong>${esc(dualArm?core.id==='cm7'?'主核':'副核':core.label)}</strong><span class="attribute-tag core-id-tag core-id-trailing core-tone-${Math.min(coreIndex,1)}">${esc(coreArchitectureName(mcu, core.id))}</span></header><div class="hardware-resource-body"><div class="profile-form">${visible.map(renderCoreField).join('')}</div>${issues.filter(issue=>issue.coreId===core.id&&['floatAbi','systemTickHz'].includes(issue.coreKey)&&issue.level==='error').map(issue=>`<p class="field-error">${esc(issue.message)}</p>`).join('')}</div></section>`;
    }).join('')}${unknown.length?`<button class="button small" data-action="platform-prune-cores" data-id="${esc(owner)}">移除不属于当前 MCU 的内核配置</button>`:''}</div></div>`;
}
