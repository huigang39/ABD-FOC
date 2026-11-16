import { INTERRUPT_LEVELS } from './priorities.mjs';
import { bindOscillatorField } from './clocks.mjs';
/** STM32H745 limits from ST's stm32h745xx.h, stm32h7xx_hal_adc.h and
 * stm32h7xx_hal_spi.c. Other MCU families need their own verified capability table.
 * Numeric choices retain their numeric JSON/storage type.
 */
const h745 = mcu => /^STM32H745[A-Z0-9]*$/i.test(mcu || '');
const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
const options = (values, unit = '') => values.map(value => ({ value, label: `${value}${unit ? ` ${unit}` : ''}` }));
export function hardwareFieldOptions(mcu, moduleId, key) {
  if(moduleId==='hw-platform'&&['controlIrqPriority','communicationIrqPriority'].includes(key))return INTERRUPT_LEVELS;
  if (!h745(mcu)) return undefined;
  if (moduleId === 'hw-board' && key === 'adcBits') return options([8, 10, 12, 14, 16], 'bit');
  if (moduleId === 'hw-platform') {
    if (key === 'irqPriorityBits') return options([4], 'bit');
    if (['controlIrqPriority', 'communicationIrqPriority'].includes(key)) return options(range(0, 15));
  }
  return undefined;
}
export function bindHardwareField(field, mcu, moduleId, platform = {}) {
  if(moduleId==='hw-platform')field=bindOscillatorField(field,mcu,platform);
  const choices = hardwareFieldOptions(mcu, moduleId, field.key);
  return choices ? { ...field, options: choices } : field;
}
export function resourceSettingOptions(mcu, resource, key) {
  if (!h745(mcu)) return undefined;
  if(resource.kind==='timer'&&key==='mode'){const modes=[{value:'base',label:'定时'}];if(!['TIM6','TIM7'].includes(resource.instance))modes.push({value:'pwm',label:'PWM 发波'},{value:'capture',label:'输入捕获'});if(['TIM1','TIM2','TIM3','TIM4','TIM5','TIM8'].includes(resource.instance))modes.push({value:'encoder',label:'编码器'});return modes;}
  if (resource.kind === 'adc' && key === 'sampleCycles') return options([1.5, 2.5, 8.5, 16.5, 32.5, 64.5, 387.5, 810.5], '周期');
  // The board adapter selects the concrete regular/injected event.
  if (resource.kind === 'adc' && key === 'trigger') return [{ value: 'software', label: '软件触发' }, { value: 'HRTIM1', label: 'HRTIM1 · PWM 同步触发' }];
  if (resource.kind === 'spi' && key === 'wordBits') {
    if (['SPI1','SPI2','SPI3'].includes(resource.instance)) return options(range(4, 32), 'bit');
    if (['SPI4','SPI5','SPI6'].includes(resource.instance)) return options(range(4, 16), 'bit');
  }
  return undefined;
}
