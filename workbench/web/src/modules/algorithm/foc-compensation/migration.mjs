/** Convert only with the timing stored beside these algorithm settings. */
export function migrateAngleDelayParameters(instances) {
  const children = instances?.['foc-compensation']?.parameters?.children;
  if (!Array.isArray(children)) return false;
  const board = instances?.['hw-board']?.parameters;
  const frequency = board?.pwmHz, divider = board?.currentLoopDivider;
  const knownPeriod = Number.isFinite(frequency) && frequency > 0 && Number.isSafeInteger(divider) && divider > 0;
  let changed = false;
  for (const child of children) {
    if (child?.type !== 'angle_delay' || !child.parameters || typeof child.parameters !== 'object' || Array.isArray(child.parameters)) continue;
    const parameters = child.parameters;
    if (!Object.hasOwn(parameters, 'delayCycles')) { parameters.delayCycles = null; changed = true; }
    if (!Object.hasOwn(parameters, 'delayUs')) { parameters.delayUs = null; changed = true; }
    // Explicit saved cycle values, including invalid values, belong to validation.
    if (parameters.delayCycles !== null || !knownPeriod || !Number.isFinite(parameters.delayUs)) continue;
    const cycles = parameters.delayUs * frequency / divider / 1e6;
    if (!Number.isFinite(cycles)) continue;
    parameters.delayCycles = cycles;
    parameters.delayUs = null;
    changed = true;
  }
  return changed;
}
