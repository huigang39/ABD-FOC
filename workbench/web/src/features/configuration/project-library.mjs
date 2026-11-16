import { parseProject, serializeProject } from '../../core/model.mjs';
import { isUnnamedProjectName } from '../../core/project-name.mjs';
import { createPerformance } from '../performance/model.mjs';

export const PROJECT_LIBRARY_KEY = 'abd-foc.projects.v1';
export const PROJECT_BACKUP_FORMAT = 'abd-foc-project-library';
const clone = value => structuredClone(value);
const checkedProject = (value, options) => parseProject(serializeProject(value), options);
const newId = () => globalThis.crypto?.randomUUID?.() || `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Save project configuration separately from the console's shared shelf/history. */
function configurationSnapshot(project) {
  const next = clone(project), catalog = next.catalog;
  const assembly = catalog.assemblies.find(item => item.id === catalog.activeAssemblyId);
  const actuatorIds = new Set([catalog.activeActuatorId, assembly?.actuatorId]);
  const driverIds = new Set([catalog.activeDriverId, assembly?.driverId]);
  catalog.actuators = catalog.actuators.filter(item => actuatorIds.has(item.id));
  catalog.drivers = catalog.drivers.filter(item => driverIds.has(item.id));
  catalog.assemblies = assembly ? [assembly] : [];
  next.performance = createPerformance();
  return checkedProject(next);
}

function record(id, project) {
  return { id, configuration: configurationSnapshot(project) };
}

function checkedLibrary(value) {
  const candidate = clone(value);
  if (candidate?.version !== 1 || !Array.isArray(candidate.projects) || typeof candidate.activeId !== 'string') throw new Error('工程列表格式无效');
  const ids = new Set();
  for (const item of candidate.projects) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('工程标识无效或重复');
    ids.add(item.id);
  }
  if (!ids.has(candidate.activeId)) throw new Error('当前工程不在列表中');
  const active = candidate.projects.find(item => item.id === candidate.activeId);
  const existingNames = [candidate.workspace?.name, ...candidate.projects.map(item => item.configuration?.name)].filter(name => typeof name === 'string' && !isUnnamedProjectName(name));
  // The workspace and its active snapshot represent the same named project.
  if (isUnnamedProjectName(candidate.workspace?.name) && typeof active.configuration?.name === 'string' && !isUnnamedProjectName(active.configuration.name)) candidate.workspace.name = active.configuration.name;
  candidate.workspace = checkedProject(candidate.workspace, { existingNames });
  existingNames.push(candidate.workspace.name);
  for (const item of candidate.projects) {
    if (item.id === candidate.activeId && isUnnamedProjectName(item.configuration?.name)) item.configuration.name = candidate.workspace.name;
    item.configuration = checkedProject(item.configuration, { existingNames });
    existingNames.push(item.configuration.name);
  }
  return candidate;
}

/** One storage write commits the active workspace and project selection together. */
export function createProjectLibrary({ storage, current, key = PROJECT_LIBRARY_KEY } = {}) {
  const initial = checkedProject(current);
  let state = { version: 1, activeId: current.id, workspace: initial, projects: [record(current.id, initial)] };
  let error = '', restored = false, savedRaw = null;
  try {
    savedRaw = storage?.getItem(key) ?? null;
    if (savedRaw) {
      state = checkedLibrary(JSON.parse(savedRaw)); restored = true;
    }
  } catch (cause) { error = `工程列表未能读取，已保留原始记录：${cause.message}`; }
  const checkWritable = () => {
    if (error) throw new Error(error);
    if (!storage?.setItem) throw new Error('浏览器存储不可用。');
    if ((storage.getItem(key) ?? null) !== savedRaw) throw new Error('工程列表已在其他标签页更新。请先导出本页修改，再刷新页面；已阻止旧记录覆盖。');
  };
  const persist = next => {
    checkWritable();
    const raw = JSON.stringify(next);
    storage.setItem(key, raw);
    savedRaw = raw;
    state = next;
  };
  const capture = project => {
    const next = clone(state);
    const index = next.projects.findIndex(item => item.id === state.activeId);
    next.projects[index] = record(state.activeId, project);
    return next;
  };
  const normalize = project => checkedProject(project, { existingNames: state.projects.map(item => item.configuration.name) });
  return {
    get activeId() { return state.activeId; },
    get current() { return clone(state.workspace); },
    get error() { return error; },
    get restored() { return restored; },
    list(project = state.workspace) {
      return state.projects.map(item => ({
        id: item.id,
        name: item.id === state.activeId && !isUnnamedProjectName(project.name) ? project.name : item.configuration.name,
        updatedAt: item.id === state.activeId ? project.updatedAt : item.configuration.updatedAt,
      }));
    },
    load(id) {
      const item = state.projects.find(entry => entry.id === id);
      if (!item) throw new Error('工程不存在，请重新选择。');
      return clone(item.configuration);
    },
    save(project) {
      const normalized = normalize(project), next = capture(normalized);
      next.workspace = normalized;
      persist(next);
    },
    exportBackup(project = state.workspace) {
      const normalized = normalize(project), next = capture(normalized);
      next.workspace = normalized;
      return JSON.stringify({ format: PROJECT_BACKUP_FORMAT, library: next }, null, 2);
    },
    restoreBackup(backup, project = state.workspace) {
      if (backup?.format !== PROJECT_BACKUP_FORMAT) throw new Error('完整数据备份格式无效');
      const next = checkedLibrary(backup.library);
      const normalized = normalize(project), previous = capture(normalized);
      previous.workspace = normalized;
      checkWritable();
      const recoveryKey = `${key}.recovery.${newId()}`;
      storage.setItem(recoveryKey, JSON.stringify(previous));
      persist(next);
      return { project: clone(next.workspace), recoveryKey };
    },
    replace(currentProject, nextProject, { savedId = '' } = {}) {
      const next = capture(normalize(currentProject));
      if (savedId && !next.projects.some(item => item.id === savedId)) throw new Error('工程不存在，请重新选择。');
      const id = savedId || newId();
      const normalized = checkedProject(nextProject, { existingNames: next.projects.map(item => item.configuration.name) });
      const index = next.projects.findIndex(item => item.id === id);
      if (index >= 0) next.projects[index] = record(id, normalized);
      else next.projects.push(record(id, normalized));
      next.activeId = id;
      next.workspace = normalized;
      persist(next);
      return id;
    },
  };
}
