import { MODULES } from '../web/src/core/catalog.mjs';
const modules = new Map(MODULES.map(module => [module.id, module]));
const text = (value, limit = 1200) => typeof value === 'string' ? value.slice(0, limit) : '';

/** Only diagnostics intended for the configuration editor cross this boundary. */
export function publicIssues(issues = []) {
  return issues.slice(0, 200).map((issue, index) => {
    const moduleId = modules.has(issue.moduleId) ? issue.moduleId : undefined;
    const candidate = issue.paramKey || (issue.path?.startsWith(`${moduleId}.`) ? issue.path.split('.')[1] : undefined);
    const paramKey = moduleId && modules.get(moduleId).params.some(param => param.key === candidate) ? candidate : undefined;
    const path = moduleId ? `instances.${moduleId}${paramKey ? `.parameters.${paramKey}` : ''}`
      : /^(?:build|target|memory|execution|design|catalog)(?:\.[\w-]+)*$/.test(issue.path || '') ? issue.path : '';
    const item = { id: text(issue.id, 200) || `check-${index}`, code: text(issue.code, 100) || 'CONFIGURATION', level: ['error','warning','pending','info'].includes(issue.level) ? issue.level : 'error', title: text(issue.title, 200) || '配置检查', message: text(issue.message) || '请核对当前配置。' };
    if (moduleId) item.moduleId = moduleId;
    if (paramKey) item.paramKey = paramKey;
    if (path) item.path = path;
    if (['structures','interfaces','faults','protocol','equipment','build','versions','memory'].includes(issue.designPage)) item.designPage = issue.designPage;
    if (typeof issue.itemId === 'string') item.itemId = text(issue.itemId, 200);
    return item;
  });
}

export class BuildFailure extends Error {
  constructor(code, message, { status = 422, stage = 'validation', issues = [] } = {}) {
    super(message); this.name = 'BuildFailure'; this.code = code; this.status = status; this.stage = stage; this.issues = publicIssues(issues);
  }
}

export function failureResponse(error, requestId) {
  const safe = error instanceof BuildFailure ? error : new BuildFailure('INTERNAL_ERROR', '构建服务未能完成请求，请稍后重试。', { status: 500, stage: 'service' });
  return { status: safe.status, body: { requestId, ...(safe.fingerprint ? { fingerprint: safe.fingerprint } : {}), error: { code: safe.code, stage: safe.stage, message: safe.message }, issues: safe.issues } };
}
