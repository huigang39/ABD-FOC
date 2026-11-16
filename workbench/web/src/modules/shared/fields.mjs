/** Shared parameter primitives; feature choices belong to their module. */
export const choices = (items) => items.map(([value, label]) => ({ value, label }));
export const unset = ['unselected', '尚未确定'];
export const capabilityChoices = choices([['unconfirmed', '尚未确认'], ['present', '支持'], ['absent', '不支持']]);
export const number = (key, label, unit, phase, description, extra = {}) => ({ key, label, type: 'number', unit, phase, description, required: true, defaultValue: null, ...extra });
export const integer = (key, label, phase, description, extra = {}) => ({ key, label, type: 'integer', phase, description, required: true, defaultValue: null, min: 1, step: 1, ...extra });
export const select = (key, label, options, phase, description, extra = {}) => ({ key, label, type: 'select', options, phase, description, required: true, defaultValue: 'unselected', ...extra });
export const capability = (key, label) => select(key, label, capabilityChoices, 'init', '表示设计中的传感器能力声明；仍需以实际硬件确认。', { defaultValue: 'unconfirmed' });

