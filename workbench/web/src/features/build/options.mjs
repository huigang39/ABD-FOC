import { MODULES } from '../../core/catalog.mjs';

export const OPTIMIZATION_LEVELS = Object.freeze(['O0', 'Og', 'O1', 'O2', 'O3', 'Os', 'Oz']);

const moduleIds = new Set(MODULES.map(module => module.id));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Missing keys inherit the global setting; only explicit overrides are stored. */
export function checkModuleOptimizations(map) {
  if (!plain(map)) throw new Error('build.moduleOptimizations 必须是对象。');
  for (const [moduleId, optimization] of Object.entries(map)) {
    if (!moduleIds.has(moduleId)) throw new Error(`build.moduleOptimizations 含未知模块：${moduleId}`);
    if (!OPTIMIZATION_LEVELS.includes(optimization)) {
      throw new Error(`build.moduleOptimizations.${moduleId} 不是允许的优化等级。`);
    }
  }
}

/** Runtime enablement does not change which compiler options a module receives. */
export function getModuleOptimization(project, moduleId) {
  if (!moduleIds.has(moduleId)) throw new Error(`未知模块：${moduleId}`);
  const map = project?.build?.moduleOptimizations;
  const setting = map && Object.hasOwn(map, moduleId) ? map[moduleId] : 'inherit';
  if (setting !== 'inherit' && !OPTIMIZATION_LEVELS.includes(setting)) {
    throw new Error(`build.moduleOptimizations.${moduleId} 不是允许的优化等级。`);
  }
  return {
    setting,
    effective: setting === 'inherit' ? project?.build?.optimization ?? 'unselected' : setting,
    compiled: project?.instances?.[moduleId]?.enabled === true,
  };
}
