import { identifyMcu, getMcuCores } from './targets.mjs';
import { createCoreConfigs, coreCapabilities, H745_AHB_DIVIDERS } from './cores.mjs';

// H745 follows the local NEO 400/200 MHz profile. G474 uses Range 1 Normal
// at 150 MHz (DS12288: 150–170 MHz requires Boost). HPM5300 uses the vendor's
// default 360/180 MHz CPU/AHB preset, not each part's maximum CPU rating.
// https://www.hpmicro.com/Public/Uploads/uploadfile/files/20250417/HPM5300UMV10.pdf
// HPM motor timers share AHB; its SDK divides CPU by ceil(CPU / 200 MHz):
// https://github.com/hpmicro/hpm_sdk/blob/main/soc/HPM5300/HPM5361/hpm_clock_drv.c
// https://github.com/hpmicro/hpm_sdk/blob/main/soc/HPM5300/HPM5361/hpm_clock_drv.h
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const validCoreClock=(mcu,id,value)=>positive(value)&&value>=1&&value<=(coreCapabilities(mcu,id)?.maxClockHz??0);
const close=(left,right)=>Math.abs(left-right)<=4*Number.EPSILON*Math.max(1,Math.abs(left),Math.abs(right));
const h745Bus=(primary,bus)=>positive(bus)&&bus>=1&&bus<=240000000&&H745_AHB_DIVIDERS.some(divider=>close(primary/divider,bus));

function clockPlan(mcu,platform,{editedCoreId,fillOnly=false}={}) {
  const family=identifyMcu(mcu), configs=platform?.coreConfigs;
  if(family?.prefix==='STM32H745') {
    const primary=configs?.cm7?.clockHz, secondary=configs?.cm4?.clockHz;
    if(!validCoreClock(mcu,'cm7',primary))return null;
    if((editedCoreId==='cm4'||fillOnly)&&positive(secondary)&&!h745Bus(primary,secondary))return null;
    const bus=h745Bus(primary,secondary)?secondary:primary/2;
    return {busClockHz:bus,timerClockHz:bus,secondaryClockHz:bus};
  }
  if(family?.prefix==='STM32G474') {
    const primary=configs?.cm4?.clockHz;
    return validCoreClock(mcu,'cm4',primary)?{busClockHz:primary,timerClockHz:primary}:null;
  }
  if(family?.vendor==='hpmicro') {
    const primary=configs?.rv32?.clockHz;
    if(!validCoreClock(mcu,'rv32',primary))return null;
    const bus=primary/Math.max(1,Math.ceil(primary/200000000));
    return {busClockHz:bus,timerClockHz:bus};
  }
  return null;
}

/** Explicit core-clock edit only; never call this while importing saved values. */
export function syncDerivedClocks(mcu,platform,{editedCoreId}={}) {
  if(!platform||!identifyMcu(mcu))return platform;
  const plan=clockPlan(mcu,platform,{editedCoreId});
  platform.busClockHz=plan?.busClockHz??null;
  platform.timerClockHz=plan?.timerClockHz??null;
  if(plan?.secondaryClockHz&&platform.coreConfigs?.cm4&&editedCoreId!=='cm4')platform.coreConfigs.cm4.clockHz=plan.secondaryClockHz;
  return platform;
}

/** Explicit MCU selection resets automatic targets, without guessing board input clocks. */
export function applyMcuDefaults(mcu,platform) {
  if(!platform)return platform;
  platform.coreConfigs=createCoreConfigs(mcu);
  platform.busClockHz=null; platform.timerClockHz=null;
  return syncDerivedClocks(mcu,platform);
}

/** Legacy empty automatic fields can be filled; explicit values and errors stay visible. */
export function fillMissingAutomaticSettings(mcu,platform) {
  if(!platform||!identifyMcu(mcu))return platform;
  for(const core of getMcuCores(mcu)) {
    const settings=platform.coreConfigs?.[core.id], caps=coreCapabilities(mcu,core.id);
    if(!settings)continue;
    if(settings.systemTickHz===null)settings.systemTickHz=1000;
    if(caps?.fpu&&(settings.floatAbi===null||settings.floatAbi==='unselected'))settings.floatAbi='hard';
  }
  const plan=clockPlan(mcu,platform,{fillOnly:true});
  if(plan) {
    if(platform.busClockHz===null)platform.busClockHz=plan.busClockHz;
    const bus=platform.busClockHz, family=identifyMcu(mcu), primary=platform.coreConfigs?.rv32?.clockHz;
    const preservedHpmBus=family.vendor==='hpmicro'&&positive(bus)&&bus>=1&&bus<=200000000&&Number.isSafeInteger(primary/bus);
    if(platform.timerClockHz===null&&(close(bus,plan.busClockHz)||preservedHpmBus))platform.timerClockHz=bus;
  }
  return platform;
}
