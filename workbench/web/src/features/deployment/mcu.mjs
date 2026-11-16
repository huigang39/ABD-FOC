import { identifyMcu } from '../../modules/hardware/hw-platform/targets.mjs';
import { createCoreSettings, coreCapabilities } from '../../modules/hardware/hw-platform/cores.mjs';
import { applyMcuDefaults, fillMissingAutomaticSettings } from '../../modules/hardware/hw-platform/defaults.mjs';
export { MCU_FAMILIES, identifyMcu, getMcuCores, coreArchitectureName } from '../../modules/hardware/hw-platform/targets.mjs';
/** applyDefaults is reserved for an explicit MCU selection, never import or shelf reuse. */
export function syncMcuArchitecture(target,hardware,{replaceCores=false,applyDefaults=false}={}) {
  const info=identifyMcu(target?.mcu);
  if(info)target.vendor=info.vendor;
  if(hardware?.['hw-platform']) {
    const platform=hardware['hw-platform'];
    platform.architecture=info?.architecture||'unselected';
    // Rebuild even shared core IDs on explicit selection: G474 cm4 is not H745 cm4.
    if(applyDefaults)applyMcuDefaults(target.mcu,platform);
    // Metadata normalization and pruning preserve stored clock / ABI choices.
    platform.coreConfigs ??= {};
    if(replaceCores)for(const id of Object.keys(platform.coreConfigs))if(!info?.cores.some(core=>core.id===id))delete platform.coreConfigs[id];
    for(const core of info?.cores||[]){
      platform.coreConfigs[core.id]??=createCoreSettings(target.mcu,core.id);
      platform.coreConfigs[core.id].irqPriorityBits=coreCapabilities(target.mcu,core.id)?.irqPriorityBits??null;
    }
    fillMissingAutomaticSettings(target.mcu,platform);
  }
  return info;
}
