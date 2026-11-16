import { MCU_FAMILIES } from '../../features/deployment/mcu.mjs';
import { selectOptions, isEmptyChoice } from './select-control.mjs';

// Maintained design options. Firmware support is checked separately at build time.
// Adding a name does not provide a driver, resource mapping or code generator.
const entries = {
  mcu: [...new Set([...MCU_FAMILIES.map(family => family.prefix), 'STM32H745IIK6'])].map(value => ({ value, label: value })),
  board: [{ value: 'NEO', label: 'NEO' }],
  encoder: [{ value: 'MC_ENCODER_GW_OUTER', label: 'GW Outer' }, { value: 'MC_ENCODER_GW_INNER', label: 'GW Inner' }],
  torque: ['KW', 'LD', 'SMH', 'XH'].map(label => ({ value: `MC_TOR_SENSOR_${label}`, label })),
};
for (const options of Object.values(entries)) {
  options.forEach(Object.freeze);
  Object.freeze(options);
}
Object.freeze(entries);

export function getModelOptions(group) {
  if (!Object.hasOwn(entries, group)) throw new Error(`未知型号分组：${String(group)}。`);
  return entries[group];
}

export function optionGroupFor(scope, key) {
  if (['target', 'driver'].includes(scope) && ['mcu', 'board'].includes(key)) return key;
  if (['module', 'driver-hardware'].includes(scope)) {
    if (['motorEncoderModel', 'outputEncoderModel'].includes(key)) return 'encoder';
    if (key === 'torqueSensorModel') return 'torque';
  }
  return '';
}

export function modelSelect(group, value, attributes = '') {
  const options = getModelOptions(group);
  const unknown = !isEmptyChoice(value) && !options.some(option => option.value === value);
  // Keep the current value visible without promoting it to a selectable model.
  const displayed = unknown ? [{ value, label: `${value} · 待适配`, disabled: true }, ...options] : options;
  return `<select class="field-select" ${attributes} data-empty="${isEmptyChoice(value)}" data-option-group="${group}">${selectOptions(displayed, value)}</select>`;
}
