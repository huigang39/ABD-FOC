import { renderExtras as app_state } from './application/app-state/view.mjs';
import { renderExtras as app_runtime } from './application/app-runtime/view.mjs';
import { renderExtras as foc_current } from './algorithm/foc-current/view.mjs';
import { renderExtras as foc_feedback } from './algorithm/foc-feedback/view.mjs';
import { renderExtras as foc_compensation } from './algorithm/foc-compensation/view.mjs';
import { renderExtras as app_calibration } from './application/app-calibration/view.mjs';
import { renderExtras as app_comms } from './application/app-comms/view.mjs';
import { renderExtras as app_safety } from './application/app-safety/view.mjs';

const views = new Map([
  ['app-runtime', app_runtime],
  ['app-state', app_state],
  ['foc-current', foc_current],
  ['foc-feedback', foc_feedback],
  ['foc-compensation', foc_compensation],
  ['app-calibration', app_calibration],
  ['app-comms', app_comms],
  ['app-safety', app_safety],
]);
/** No module view owns navigation, storage or device access. */
export function renderModuleExtras(moduleId, context) {
  return views.get(moduleId)?.(context) || '';
}
