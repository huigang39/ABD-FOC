import app_state from './application/app-state/definition.mjs';
import app_runtime from './application/app-runtime/definition.mjs';
import app_params from './application/app-params/definition.mjs';
import app_comms from './application/app-comms/definition.mjs';
import app_motion from './application/app-motion/definition.mjs';
import app_calibration from './application/app-calibration/definition.mjs';
import app_safety from './application/app-safety/definition.mjs';
import foc_lifecycle from './algorithm/foc-lifecycle/definition.mjs';
import foc_feedback from './algorithm/foc-feedback/definition.mjs';
import foc_observer from './algorithm/foc-observer/definition.mjs';
import foc_filter from './algorithm/foc-filter/definition.mjs';
import foc_current from './algorithm/foc-current/definition.mjs';
import foc_modulation from './algorithm/foc-modulation/definition.mjs';
import foc_compensation from './algorithm/foc-compensation/definition.mjs';
import hw_platform from './hardware/hw-platform/definition.mjs';
import hw_board from './hardware/hw-board/definition.mjs';
import hw_drivers from './hardware/hw-drivers/definition.mjs';
import hw_safety from './hardware/hw-safety/definition.mjs';

function freezeDeep(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}
/** Explicit registration keeps order deterministic in browser and firmware generation. */
export const MODULES = freezeDeep([
  app_runtime,
  app_state,
  app_motion,
  app_comms,
  app_calibration,
  app_params,
  app_safety,
  foc_current,
  foc_feedback,
  foc_modulation,
  foc_observer,
  foc_filter,
  foc_compensation,
  foc_lifecycle,
  hw_platform,
  hw_board,
  hw_drivers,
  hw_safety
]);
export const MODULE_IDS = Object.freeze(MODULES.map(module => module.id));
