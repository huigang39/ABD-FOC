import { configurationFingerprint } from '../../core/contracts.mjs';

/** A successful report authorizes only the configuration that was inspected. */
export function getBuildInspectionState(project, state = {}) {
  const fingerprint = configurationFingerprint(project);
  const inspection = state.inspection || null;
  const pending = state.pendingAction === 'inspect' || (state.pendingAction === 'build' && state.busy === true);
  const current = !!inspection && inspection.stale !== true && inspection.fingerprint === fingerprint
    && (inspection.projectId === undefined || inspection.projectId === project?.id);
  const supported = current && !pending && inspection.supported === true
    && !inspection.issues?.some(issue => issue.level === 'error');
  const status = pending ? 'checking' : !inspection ? 'unchecked' : !current ? 'stale' : supported ? 'passed' : 'failed';
  const sourceReady=current&&!pending&&(inspection.sourceReady===undefined?supported:inspection.sourceReady===true&&!inspection.sourceIssues?.some(issue=>issue.level==='error'));
  return { fingerprint, current, supported, sourceReady, pending, status, inspection };
}
