import { identifyMcu } from './targets.mjs';

// ST DS12923 Rev 3 §3.10, §6.3.9; DS12288 Rev 6 §3.13, §5.3.7.
// HPM5300 DS Rev 0.11 §4.5 / UM Rev 1.0 §10 documents 24 MHz inputs only.
export const OSCILLATOR_SOURCES = Object.freeze({
  STM32H745: 'https://www.st.com/resource/en/datasheet/stm32h745ig.pdf',
  STM32G474: 'https://www.st.com/resource/en/datasheet/stm32g474re.pdf',
  HPM5300: 'https://www.hpmicro.com/Public/Uploads/uploadfile/files/20250417/HPM5300UMV10.pdf',
});
const names={external:'外部晶振',bypass:'外部有源时钟',internal:'内部振荡器'};
const mhz=value=>`${Number((value/1e6).toPrecision(10))} MHz`;

/** Input-source limits, not a proof of a PLL/divider configuration. Internal values are nominal. */
export function oscillatorLimits(mcu, source) {
  const family=identifyMcu(mcu)?.prefix;
  let bounds, note='', nominalValues;
  if(family==='STM32H745') {
    if(source==='external')bounds=[4e6,48e6];
    else if(source==='bypass')bounds=[4e6,50e6];
    else if(source==='internal'){bounds=[4e6,64e6];nominalValues=[4e6,64e6];note='内部主时钟源填写 CSI 4 MHz 或 HSI 64 MHz 标称频率；分频和 PLL 输出不在此处填写。';}
    else bounds=[1,64e6];
  } else if(family==='STM32G474') {
    if(source==='external')bounds=[4e6,48e6];
    else if(source==='bypass'){bounds=[1,48e6];note='旁路输入上限 48 MHz；电压缩放 Range 2 上限为 26 MHz，当前模型未配置该电压档位。';}
    else if(source==='internal'){bounds=[16e6,16e6];nominalValues=[16e6];note='内部主时钟源填写 HSI16 标称 16 MHz；HSI48 只用于 USB / RNG 等外设。';}
    else bounds=[1,48e6];
  } else if(/^HPM53(?:61|31|21|01)$/.test(family||'')) {
    bounds=names[source]?[24e6,24e6]:[1,24e6];
    if(names[source])nominalValues=[24e6];
    note='当前芯片资料支持 XTAL24M / RC24M 标称 24 MHz；晶振与有源输入均按 24 MHz 配置。';
  }
  return {min:bounds?.[0]??1,...(bounds?{max:bounds[1]}:{}),...(nominalValues?{nominalValues}:{}),name:names[source]||'输入时钟',note,source:OSCILLATOR_SOURCES[family]||(/^HPM53/.test(family||'')?OSCILLATOR_SOURCES.HPM5300:'')};
}

export function bindOscillatorField(field,mcu,platform={}) {
  if(field.key!=='oscillatorHz')return field;
  const {min,max,note}=oscillatorLimits(mcu,platform.clockSource);
  return {...field,min,...(max!==undefined?{max}:{}),description:[field.description,note].filter(Boolean).join(' ')};
}

export function validateOscillatorClock(mcu,platform={}) {
  const value=platform?.oscillatorHz;
  if(value==null)return [];
  const bounds=oscillatorLimits(mcu,platform.clockSource);
  let message='';
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0)message='输入时钟必须为有限正数。';
  else if(value<bounds.min||bounds.max!==undefined&&value>bounds.max)message=`${bounds.name}需${bounds.min===bounds.max?`为 ${mhz(bounds.min)}`:`在 ${mhz(bounds.min)}${bounds.max!==undefined?` 至 ${mhz(bounds.max)}`:' 以上'}`}，当前为 ${mhz(value)}。`;
  else if(bounds.nominalValues&&!bounds.nominalValues.includes(value))message=`${bounds.name}标称频率请选择 ${bounds.nominalValues.map(mhz).join(' 或 ')}；分频和 PLL 输出不在此处填写。`;
  return message?[{id:'clock-oscillator-range',level:'error',title:'输入时钟不符合当前时钟源',message,moduleId:'hw-platform',paramKey:'oscillatorHz'}]:[];
}
