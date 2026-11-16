import { algorithmChildrenIssues } from './algorithm/children.mjs';
import { algorithmPathIssues } from './algorithm/foc-lifecycle/paths.mjs';
import { validateHardware } from './hardware/hw-board/validation.mjs';
import { sensorIssues } from './hardware/hw-drivers/sensors.mjs';
import { validateCompensation } from './algorithm/foc-compensation/validation.mjs';
import { validateCurrentLoop } from './algorithm/foc-current/design.mjs';
import { validateCalibration } from './application/app-calibration/validation.mjs';
import { validateCia402 } from './application/app-state/cia402.mjs';
import { validateSignalConsumers } from './algorithm/consumers.mjs';

/** Feature validation is pure; whole-project geometry and contracts remain in model. */
export function validateModuleConfiguration(project) {
  return [
    ...algorithmChildrenIssues(project),
    ...algorithmPathIssues(project),
    ...validateHardware(project),
    ...sensorIssues(project.instances['hw-drivers'].parameters),
    ...validateCompensation(project),
    ...validateCurrentLoop(project),
    ...validateCalibration(project),
    ...validateCia402(project),
    ...validateSignalConsumers(project),
  ];
}
