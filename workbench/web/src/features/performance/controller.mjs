import { isNumericInput, readNumericInput } from '../../shared/forms/numeric-input.mjs';
import { PERFORMANCE_LIMITS, createPerformanceDraft, createPerformanceRecord, savePerformanceRecord, removePerformanceRecord, parsePerformanceCsv } from './model.mjs';

/** Page state stays separate from project data until a measured record is saved. */
export function createPerformanceController({ getProject, commit, render, navigate, notify }) {
  let draft = null, projectId = '', routeAssembly = '';
  const drafts = new Map();
  const unsaved = new Set();
  const cleanDraft = () => { const { csvText, ...record } = draft; return record; };
  const draftKey = (assemblyId, kind) => JSON.stringify([assemblyId, kind]);
  function activate(assemblyId, kind = 'kt', fresh = false) {
    const key = draftKey(assemblyId, kind);
    if (fresh) unsaved.delete(drafts.get(key));
    if (fresh || !drafts.has(key)) drafts.set(key, { ...createPerformanceDraft(getProject(), assemblyId, kind), csvText: '' });
    draft = drafts.get(key);
    return draft;
  }
  function reset(assemblyId, kind = 'kt') {
    const project = getProject();
    if (!assemblyId || projectId !== project.id) { drafts.clear(); unsaved.clear(); }
    projectId = project.id;
    routeAssembly = '';
    return activate(assemblyId || project.catalog.activeAssemblyId, kind, true);
  }
  function state(route) {
    const project = getProject();
    if (!draft || projectId !== project.id) reset(route?.assemblyId);
    if (route) {
      if (route.assemblyId && route.assemblyId !== routeAssembly && draft.assemblyId !== route.assemblyId) activate(route.assemblyId, draft.kind);
      routeAssembly = route.assemblyId || '';
    }
    return draft;
  }
  function edit(input) {
    if (!input.dataset.performanceField && input.dataset.performanceRow === undefined) return false;
    state();
    const value = isNumericInput(input) ? readNumericInput(input) : input.value;
    if (input.dataset.performanceRow !== undefined) {
      const row = draft.samples[Number(input.dataset.performanceRow)];
      const key = input.dataset.performanceKey;
      if (row && ['currentA', 'speedRpm', 'torqueNm', 'series'].includes(key)) { row[key] = value; unsaved.add(draft); }
      render(true);
      return true;
    }
    const key = input.dataset.performanceField;
    if (key === 'kind') {
      // Separate drafts preserve unsaved points without relabeling their units.
      if (['kt', 'tn_curve'].includes(value) && value !== draft.kind) activate(draft.assemblyId, value);
      render();
    } else if (key === 'assemblyId') {
      activate(value, draft.kind);
      routeAssembly = value;
      navigate(`#/performance?assembly=${encodeURIComponent(value)}`);
    } else if (key.startsWith('conditions.')) {
      const field = key.slice('conditions.'.length);
      if (Object.hasOwn(draft.conditions, field)) { draft.conditions[field] = value; unsaved.add(draft); }
      render(true);
    } else if (['name', 'measuredAt', 'measurementSide', 'currentBasis', 'firmwareId', 'csvText'].includes(key)) {
      draft[key] = key === 'measuredAt' && value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : value;
      unsaved.add(draft);
      render(['assemblyId', 'measurementSide', 'currentBasis'].includes(key) ? false : true);
    }
    return true;
  }
  function action(name, data = {}) {
    if (!name.startsWith('performance-')) return false;
    state();
    try {
      if (name === 'performance-new') {
        reset(data.assembly || data.assemblyId || draft.assemblyId, data.kind || 'kt');
        navigate(`#/performance?assembly=${encodeURIComponent(draft.assemblyId)}`);
      } else if (name === 'performance-add-row') {
        if (draft.samples.length >= PERFORMANCE_LIMITS.samplesPerRecord) throw new Error(`每条记录最多 ${PERFORMANCE_LIMITS.samplesPerRecord} 个测量点。`);
        draft.samples.push({ [draft.kind === 'kt' ? 'currentA' : 'speedRpm']: null, torqueNm: null, series: '' });
        unsaved.add(draft);
        render();
      } else if (name === 'performance-remove-row') {
        const index = Number(data.index);
        if (Number.isInteger(index) && index >= 0 && index < draft.samples.length) { draft.samples.splice(index, 1); unsaved.add(draft); }
        render();
      } else if (name === 'performance-parse') {
        const samples = parsePerformanceCsv(draft.csvText, draft.kind);
        draft.samples = samples;
        unsaved.add(draft);
        render();
        notify(`已载入 ${samples.length} 个测量点`, { level: 'success' });
      } else if (name === 'performance-calculate') {
        createPerformanceRecord(getProject(), cleanDraft());
        render();
        notify('表格检查通过，曲线已更新', { level: 'success' });
      } else if (name === 'performance-save') {
        const next = savePerformanceRecord(getProject(), cleanDraft());
        const saved = next.performance.records.at(-1);
        commit(next);
        unsaved.delete(draft);
        navigate(`#/performance/${encodeURIComponent(saved.id)}`);
        notify('性能表格与曲线已保存到关节模组', { level: 'success' });
      } else if (name === 'performance-delete') {
        const record = getProject().performance?.records.find(item => item.id === data.id);
        commit(removePerformanceRecord(getProject(), data.id));
        reset(record?.assemblyId, record?.kind || 'kt');
        navigate(`#/performance?assembly=${encodeURIComponent(draft.assemblyId)}`);
        notify('测试记录已移除', { level: 'info' });
      }
    } catch (error) { notify(error.message, { level: 'error' }); }
    return true;
  }
  return { state, reset, edit, action, hasUnsavedDraft: () => unsaved.size > 0 };
}
