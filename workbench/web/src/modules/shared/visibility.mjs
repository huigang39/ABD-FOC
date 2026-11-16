import { observerUsesModelAngle } from '../algorithm/children.mjs';
import { getMcuCores } from '../hardware/hw-platform/targets.mjs';
import { sensorFieldVisible } from '../hardware/hw-drivers/sensors.mjs';

/** Shared by editing, runtime configuration and validation. */
export function parameterVisible(project, moduleId, field) {
  if (field.hidden) return false;
  if (field.exceptionCore) return getMcuCores(project.target.mcu).some(core=>core.id===field.exceptionCore);
  const params = project.instances[moduleId]?.parameters || {};
  if (field.architectureOnly && field.architectureOnly !== project.instances['hw-platform'].parameters.architecture) return false;
  if (moduleId === 'foc-feedback' && field.key === 'forcedAngleRad') return params.angleSource === 'forced';
  if (moduleId === 'hw-drivers') return sensorFieldVisible(field, params);
  if (moduleId === 'app-state' && /^(cia402|profile)/.test(field.key)) return params.stateMachine === 'cia402';
  if (moduleId === 'foc-observer' && field.key === 'startupStrategy') return observerUsesModelAngle(project);
  if (moduleId === 'app-params' && field.key === 'zeroSamples') return Boolean(params.zeroing?.length);
  if (moduleId === 'app-calibration' && field.key === 'maxCurrentA') return params.procedures?.some(value => ['electrical_zero','hall','friction'].includes(value)) === true;
  return true;
}
