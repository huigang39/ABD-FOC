/** Physical phase health requires an explicit, fresh diagnostic for this project. */
export function getPhaseHealth(project, phase, diagnostics = null, now = Date.now()) {
  const name = String(phase).toUpperCase();
  const unknown = {state:'unknown',label:'未检测',message:`${name} 相尚无有效的实时诊断，不能判断是否缺相。`};
  if (!['U','V','W'].includes(name) || !project?.id || diagnostics?.source !== 'device' || diagnostics.connected !== true || diagnostics.projectId !== project.id) return unknown;
  const age = now - diagnostics.observedAt;
  if (!Number.isFinite(diagnostics.observedAt) || !Number.isFinite(age) || age < 0 || age > 1000) return unknown;
  const item = diagnostics.phases?.[name];
  const state = {ok:'ok',warning:'warning',missing:'error',error:'error'}[item?.status];
  if (!state) return unknown;
  const label = {ok:'正常',warning:'警告',missing:'缺相',error:'故障'}[item.status];
  return {state,label,message:typeof item.message === 'string' && item.message.trim() ? item.message : `${name} 相${label}。`};
}
