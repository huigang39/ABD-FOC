import { coreArchitectureName, getMcuCores } from '../../modules/hardware/hw-platform/targets.mjs';
import { coreCapabilities, coreFields, coreRoles, validateCoreConfigs } from '../../modules/hardware/hw-platform/cores.mjs';
import { edit, esc } from './view.mjs';
import { fieldHelp } from '../../shared/ui/field-help.mjs';

/** Shared by project configuration and reusable driver hardware. */
export function renderPlatformConfiguration(mcu, platform, fields, renderField, {project, owner=''}={}) {
  const cores=getMcuCores(mcu), roles=coreRoles(mcu,project), issues=validateCoreConfigs(mcu,platform,project);
  const unknown=Object.keys(platform.coreConfigs||{}).filter(id=>!cores.some(core=>core.id===id));
  return `${fields.filter(field=>!field.group).map(renderField).join('')}
    <section class="hardware-field-group"><h3>芯片公共配置${fieldHelp('晶振、PLL 与总线由芯片共用，各核独立配置在下方。内核频率仍需满足完整时钟树和供电约束。','芯片公共配置')}</h3><div class="profile-form">${fields.filter(field=>field.group==='clock').map(renderField).join('')}</div></section>
    ${fields.some(field=>field.group==='memory')?`<section class="hardware-field-group"><h3>存储容量</h3><div class="profile-form">${fields.filter(field=>field.group==='memory').map(renderField).join('')}</div></section>`:''}
    <div class="platform-cores">${cores.map((core,coreIndex)=>{
      const params=platform.coreConfigs?.[core.id]||{}, caps=coreCapabilities(mcu,core.id);
      const samplingCore=project?.execution?.assignments?.['hw-board']||(cores.length===1?cores[0].id:'');
      const tasks=[core.id===samplingCore?'采样':'',core.id===roles.control?'电流环':'',roles.communicationEnabled&&core.id===roles.communication?'通信':''].filter(Boolean);
      return `<details class="resource-disclosure platform-core hardware-resource" data-core="${core.id}" data-state-key="platform-${esc(owner)}-${core.id}"><summary><strong>${esc(core.label)}</strong><span class="attribute-tag core-id-tag core-id-trailing core-tone-${Math.min(coreIndex,1)}">${esc(coreArchitectureName(mcu, core.id))}</span></summary><div class="hardware-resource-body">${caps.cache===false?`<p class="design-note">${esc(core.label)} 无独立指令 / 数据缓存${caps.fpu?` · ${esc(caps.fpu)}`:''}</p>`:caps.fpu?`<p class="design-note">${esc(caps.fpu)}</p>`:''}<div class="profile-form">${coreFields(mcu,core.id,project).map(field=>{
        const html=edit(field.label,params[field.key],'platform-core',field.key,{id:owner,child:core.id,type:field.type,min:field.min,max:field.max,unit:field.unit,phase:field.phase,description:field.description,choices:field.options?.map(option=>[option.value,option.label])});
        const errors=issues.filter(issue=>issue.level==='error'&&issue.coreId===core.id&&issue.coreKey===field.key);
        return html.replace(/<\/div>$/,`${errors.map(issue=>`<p class="field-error">${esc(issue.message)}</p>`).join('')}</div>`);
      }).join('')}</div></div></details>`;
    }).join('')}${unknown.length?`<button class="button small" data-action="platform-prune-cores" data-id="${esc(owner)}">移除不属于当前 MCU 的内核配置</button>`:''}</div>`;
}
