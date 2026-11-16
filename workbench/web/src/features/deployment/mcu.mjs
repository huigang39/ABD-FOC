import { identifyMcu } from '../../modules/hardware/hw-platform/targets.mjs';
import { createCoreSettings, coreCapabilities } from '../../modules/hardware/hw-platform/cores.mjs';
export { MCU_FAMILIES, identifyMcu, getMcuCores, coreArchitectureName } from '../../modules/hardware/hw-platform/targets.mjs';
export function syncMcuArchitecture(target,hardware,{replaceCores=false}={}) {
  const info=identifyMcu(target?.mcu);
  if(info)target.vendor=info.vendor;
  if(hardware?.['hw-platform']) {
    const platform=hardware['hw-platform'];
    platform.architecture=info?.architecture||'unselected';
    // Preserve existing per-core settings; missing cores are explicit empty drafts.
    platform.coreConfigs ??= {};
    if(replaceCores)for(const id of Object.keys(platform.coreConfigs))if(!info?.cores.some(core=>core.id===id))delete platform.coreConfigs[id];
    for(const core of info?.cores||[]){
      platform.coreConfigs[core.id]??=createCoreSettings(target.mcu,core.id);
      platform.coreConfigs[core.id].irqPriorityBits=coreCapabilities(target.mcu,core.id)?.irqPriorityBits??null;
    }
  }
  return info;
}
