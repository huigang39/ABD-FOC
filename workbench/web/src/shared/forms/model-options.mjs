import { selectOptions, isEmptyChoice } from './select-control.mjs';

// Maintained design options. Firmware support is checked separately at build time.
// Adding a name does not provide a driver, resource mapping or code generator.
const entries = {
  // Keep the concrete package value used by the maintained pin mapping.
  mcu: [{ value: 'STM32H745IIK6', label: 'STM32H745IIK6' }],
  board: [{ value: 'NEO', label: 'NEO' }],
  encoder: [{ value: 'MC_ENCODER_GW_OUTER', label: '弓望' }, { value: 'MC_ENCODER_JG', label: '金刚' }],
  torque: [['KW','坤维'], ['XH','星汇'], ['LD','蓝点'], ['SMH','三木禾']].map(([model,label]) => ({ value: `MC_TOR_SENSOR_${model}`, label })),
  gateDriver: [{ value: 'DRV8353S', label: 'DRV8353' }, { value: 'discrete', label: '分立驱动' }],
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
  if (['target', 'driver'].includes(scope) && key === 'mcu') return key;
  if (['module', 'driver-hardware'].includes(scope)) {
    if (['motorEncoderModel', 'outputEncoderModel'].includes(key)) return 'encoder';
    if (key === 'torqueSensorModel') return 'torque';
    if (key === 'gateDriverModel') return 'gateDriver';
  }
  return '';
}

const legacyModelLabels = {
  encoder: { MC_ENCODER_GW_INNER:'弓望', 'GW 外圈':'弓望', 'GW 内圈':'弓望', 'GW Outer':'弓望', 'GW Inner':'弓望', gongwang:'弓望', jingang:'金刚' },
  torque: { KW:'坤维', XH:'星汇', LD:'蓝点', SMH:'三木禾' },
  gateDriver: { DRV8353:'DRV8353' },
};
export function modelSelect(group, value, attributes = '') {
  const options = getModelOptions(group);
  const unknown = !isEmptyChoice(value) && !options.some(option => option.value === value);
  // Keep the current value visible without promoting it to a selectable model.
  const aliases = legacyModelLabels[group];
  const preservedLabel = aliases && Object.hasOwn(aliases,value) ? aliases[value] : group === 'mcu' && value === 'STM32H745' ? value : `${value} · 待适配`;
  const displayed = unknown ? [{ value, label: preservedLabel, disabled: true }, ...options] : options;
  return `<select class="field-select" ${attributes} data-empty="${isEmptyChoice(value)}" data-option-group="${group}">${selectOptions(displayed, value)}</select>`;
}
