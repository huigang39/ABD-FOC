import { renderAlgorithmChildren } from './children-view.mjs';

/** Compatibility entry point for the retired combined editor; no free routing controls. */
export function renderProcessingChains(project) {
  return ['foc-observer','foc-filter'].map(id=>renderAlgorithmChildren(project,{id})).join('');
}
