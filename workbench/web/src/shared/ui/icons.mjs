// Local SVG symbols keep controls independent of system fonts and icon services.
export const ICON_NAMES = new Set([
  'overview', 'guide', 'shelf', 'versions', 'link', 'check', 'build', 'wave',
  'play', 'pause', 'settings', 'folder', 'import', 'export', 'save', 'chip',
  'algorithm', 'application', 'clock', 'database', 'target', 'shield', 'cycle',
  'rotor', 'eye', 'current', 'axes', 'board', 'pulse', 'services', 'grip',
  'plus', 'arrow-right', 'close', 'box', 'edit', 'copy', 'trash', 'motor',
]);

export function icon(name, extraClass = '') {
  const symbol = ICON_NAMES.has(name) ? name : 'box';
  const classes = extraClass.replace(/[^a-zA-Z0-9 _-]/g, '');
  return `<svg class="ui-icon${classes ? ` ${classes}` : ''}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="/assets/icons.svg#${symbol}"></use></svg>`;
}

export const LAYER_ICONS = { hardware: 'chip', foc: 'algorithm', app: 'application' };
export const MODULE_ICONS = {
  'app-runtime': 'clock', 'app-state': 'clock', 'app-params': 'database', 'app-comms': 'link',
  'app-motion': 'wave', 'app-calibration': 'target', 'app-safety': 'shield',
  'foc-lifecycle': 'shield', 'foc-feedback': 'rotor', 'foc-observer': 'eye',
  'foc-current': 'current', 'foc-modulation': 'axes', 'foc-safety': 'shield',
  'foc-compensation': 'settings',
  'hw-platform': 'chip', 'hw-board': 'board', 'hw-drivers': 'target',
  'hw-safety': 'shield',
};
