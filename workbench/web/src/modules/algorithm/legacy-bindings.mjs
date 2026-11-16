import { OBSERVER_OUTPUTS, resolveAlgorithmSignal } from './signals.mjs';

/** Old publication choices are retained until the user explicitly removes them. */
export function legacyObserverBindings(project) {
  const parameters=project.instances['foc-observer']?.parameters||{};
  return OBSERVER_OUTPUTS.filter(([key])=>parameters[key]&&parameters[key]!=='none').map(([key,label])=>({
    moduleId:'foc-observer',key,label,reference:parameters[key],signalLabel:resolveAlgorithmSignal(project,parameters[key])?.label||parameters[key],
  }));
}

export function resetLegacyObserverBindings(project) {
  const parameters=project.instances['foc-observer']?.parameters;
  if(parameters)for(const {key} of legacyObserverBindings(project))parameters[key]='none';
}
