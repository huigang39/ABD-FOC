import { configurationFingerprint } from '../../core/contracts.mjs';

/** Module borders reflect live device health, never configuration progress. */
export function getModuleHealth(project, key, diagnostics = null, now = Date.now()) {
  const age = now - diagnostics?.observedAt;
  const live = project?.id && diagnostics?.source === 'device' && diagnostics.connected === true
    && diagnostics.projectId === project.id && diagnostics.fingerprint === configurationFingerprint(project)
    && Number.isFinite(diagnostics.observedAt) && age >= 0 && age <= 1000;
  const status = live ? diagnostics.modules?.[key]?.status : null;
  if (status === 'error') return { state: 'error', label: '设备报错' };
  if (status === 'warning') return { state: 'warning', label: '设备警告' };
  if (status === 'ok') return { state: 'ok', label: '关节模组已连接，无报错' };
  return { state: 'unknown', label: '尚无有效的关节模组连接诊断' };
}
