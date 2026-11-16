/** Confirmed CPU metadata only; pin mux, Flash size and timing are not inferred. */
export const MCU_FAMILIES = [
  {prefix:'STM32G474',vendor:'st',architecture:'arm',label:'Arm Cortex-M4',cores:[{id:'cm4',label:'Cortex-M4'}],source:'https://www.st.com/resource/en/datasheet/stm32g474mb.pdf'},
  {prefix:'STM32H745',vendor:'st',architecture:'arm',label:'Arm Cortex-M7 + Cortex-M4',cores:[{id:'cm7',label:'Cortex-M7'},{id:'cm4',label:'Cortex-M4'}],source:'https://www.st.com/resource/en/datasheet/stm32h745ig.pdf'},
  ...['HPM5361','HPM5331','HPM5321','HPM5301'].map(prefix=>({prefix,vendor:'hpmicro',architecture:'riscv',label:'RISC-V',cores:[{id:'rv32',label:'RISC-V'}],source:'https://www.hpmicro.com/en/product-center/microcontroller/hpm5300/5300-selection-table'})),
];
export function identifyMcu(model) {
  if(typeof model!=='string')return null;
  const normalized=model.trim().toUpperCase();
  return MCU_FAMILIES.find(family=>normalized===family.prefix||(normalized.startsWith(family.prefix)&&/^[A-Z0-9]+$/.test(normalized.slice(family.prefix.length))))||null;
}
/** Detached entries: callers cannot change the shared chip catalog. */
export function getMcuCores(model) {
  return (identifyMcu(model)?.cores || []).map(({id,label})=>({id,label}));
}
