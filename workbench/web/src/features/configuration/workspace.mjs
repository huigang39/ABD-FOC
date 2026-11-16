/** One console owns its shelf and measurement history; configuration files select
 * reusable assets and replace control settings without replacing that library. */
import { parseProject, serializeProject } from '../../core/model.mjs';
import { createPerformance } from '../performance/model.mjs';
import { applyDriver, assetFingerprint, checkCatalogShape, constrainCurrentLimit, createCatalog, getActiveActuator, getActiveDriver } from '../equipment/model.mjs';

const clone = value => structuredClone(value);
const stable = value => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));

/** Detached objects can be used by the guide without exposing mutable shelf entries. */
export function getConfigurationSelection(current) {
  const actuator = getActiveActuator(current), driver = getActiveDriver(current);
  const assembly = current.catalog?.assemblies?.find(item => item.id === current.catalog.activeAssemblyId) || null;
  return clone({ assembly, actuator, driver, hardwareMode: driver ? 'reuse' : 'custom' });
}

function limitCurrent(next) {
  const actuator = getActiveActuator(next), driver = getActiveDriver(next);
  const existing = next.instances['app-motion'].parameters.currentLimitA;
  const limit = constrainCurrentLimit(existing, actuator?.motor.maxCurrentA, driver?.maxCurrentA);
  if (limit !== existing) {
    next.instances['app-motion'].parameters.currentLimitA = limit;
    next.provenance['app-motion.currentLimitA'] = 'user';
  }
}
function clearAssembly(next) { next.catalog.activeAssemblyId = ''; next.catalog.appliedFingerprint = ''; }

export function selectConfigurationActuator(current, actuatorId) {
  checkCatalogShape(current.catalog);
  if (!current.catalog.actuators.some(item => item.id === actuatorId)) throw new Error('请从货架选择存在的执行器。');
  const next = clone(current), assembly = getConfigurationSelection(current).assembly;
  next.catalog.activeActuatorId = actuatorId;
  if (!assembly || assembly.actuatorId !== actuatorId || assembly.driverId !== getActiveDriver(current)?.id) clearAssembly(next);
  limitCurrent(next);
  return next;
}

export function selectConfigurationDriver(current, driverId) {
  const actuatorId = getActiveActuator(current)?.id || '', assembly = getConfigurationSelection(current).assembly;
  const next = applyDriver(current, driverId);
  next.catalog.activeActuatorId = actuatorId;
  if (assembly && assembly.actuatorId === actuatorId && assembly.driverId === driverId) {
    next.catalog.activeAssemblyId = assembly.id;
    next.catalog.appliedFingerprint = assetFingerprint(next.catalog, assembly.id);
  }
  limitCurrent(next);
  return next;
}

/** Custom hardware starts with current editable values; saved drivers stay intact. */
export function beginCustomHardware(current) {
  checkCatalogShape(current.catalog);
  const next = clone(current);
  next.catalog.activeActuatorId = getActiveActuator(current)?.id || '';
  next.catalog.activeDriverId = '';
  clearAssembly(next);
  return next;
}

function mergeAssets(destination, source, rewrite = item => item) {
  const mapping = new Map();
  for (const sourceItem of source) {
    const imported = rewrite(clone(sourceItem));
    const existing = destination.find(item => item.id === imported.id);
    if (!existing) { destination.push(imported); mapping.set(sourceItem.id, imported.id); continue; }
    if (same(existing, imported)) { mapping.set(sourceItem.id, existing.id); continue; }
    // Deterministic copy IDs make repeated import of the same conflicting file
    // idempotent. Existing objects, names and historical references are untouched.
    let sequence = 2;
    while (true) {
      const copy = { ...imported, id: `${imported.id}-import-${sequence}` };
      const candidate = destination.find(item => item.id === copy.id);
      if (!candidate) { destination.push(copy); mapping.set(sourceItem.id, copy.id); break; }
      if (same(candidate, copy)) { mapping.set(sourceItem.id, candidate.id); break; }
      sequence++;
    }
  }
  return mapping;
}

function requireReference(entries, id, label) {
  if (id && !entries.some(item => item.id === id)) throw new Error(`${label}引用不存在：${id}`);
}
function checkSelection(catalog) {
  requireReference(catalog.actuators, catalog.activeActuatorId, '当前执行器');
  requireReference(catalog.drivers, catalog.activeDriverId, '当前驱动器');
  requireReference(catalog.assemblies, catalog.activeAssemblyId, '当前关节模组');
  const assembly = catalog.assemblies.find(item => item.id === catalog.activeAssemblyId);
  if (assembly && (assembly.actuatorId !== catalog.activeActuatorId || assembly.driverId !== catalog.activeDriverId)) throw new Error('当前关节模组与执行器、驱动器选型不一致。');
}

/** Returns a detached next state. Persistence/commit belongs to the caller. */
export function applyImportedConfiguration(current, incoming) {
  // Full schema validation happens before constructing or exposing the result.
  serializeProject(current);
  const source = typeof incoming === 'string' ? parseProject(incoming) : parseProject(serializeProject(incoming));
  const catalog = clone(current.catalog);
  const actuatorIds = mergeAssets(catalog.actuators, source.catalog.actuators);
  const driverIds = mergeAssets(catalog.drivers, source.catalog.drivers);
  const mapped = (ids, id) => ids.get(id) || id || '';
  const assemblyIds = mergeAssets(catalog.assemblies, source.catalog.assemblies, item => ({
    ...item, actuatorId: mapped(actuatorIds, item.actuatorId), driverId: mapped(driverIds, item.driverId),
  }));
  for (const original of source.catalog.assemblies) {
    const item = catalog.assemblies.find(entry => entry.id === assemblyIds.get(original.id));
    requireReference(catalog.actuators, item.actuatorId, '导入关节模组的执行器');
    requireReference(catalog.drivers, item.driverId, '导入关节模组的驱动器');
  }
  const assembly = source.catalog.assemblies.find(item => item.id === source.catalog.activeAssemblyId);
  catalog.activeAssemblyId = mapped(assemblyIds, source.catalog.activeAssemblyId);
  catalog.activeActuatorId = mapped(actuatorIds, source.catalog.activeActuatorId || assembly?.actuatorId);
  catalog.activeDriverId = mapped(driverIds, source.catalog.activeDriverId || assembly?.driverId);
  checkSelection(catalog);
  const wasApplied = assembly && source.catalog.appliedFingerprint === assetFingerprint(source.catalog, assembly.id);
  catalog.appliedFingerprint = wasApplied ? assetFingerprint(catalog, catalog.activeAssemblyId) : '';
  const next = {
    ...source, id: current.id, revision: current.revision, updatedAt: current.updatedAt,
    catalog, performance: clone(current.performance || createPerformance()),
  };
  serializeProject(next);
  return next;
}

/** Portable configuration: only the selected assembly/actuator/driver closure.
 * Measurement history is a console resource and is never exported as configuration.
 */
export function exportConfiguration(current) {
  const { assembly, actuator, driver } = getConfigurationSelection(current);
  const exported = clone(current);
  exported.catalog = {
    ...createCatalog(),
    actuators: actuator ? [actuator] : [], drivers: driver ? [driver] : [], assemblies: assembly ? [assembly] : [],
    activeActuatorId: actuator?.id || current.catalog.activeActuatorId || '',
    activeDriverId: driver?.id || current.catalog.activeDriverId || '',
    activeAssemblyId: assembly?.id || current.catalog.activeAssemblyId || '',
    appliedFingerprint: assembly ? current.catalog.appliedFingerprint : '',
  };
  checkSelection(exported.catalog);
  exported.performance = createPerformance();
  return serializeProject(exported);
}
