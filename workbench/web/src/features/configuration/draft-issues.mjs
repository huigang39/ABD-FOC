/** Surface rejected form drafts without writing invalid values into the project. */
export function numericDraftIssues(errors, {moduleId: fallbackModule = '', page = '', itemId = ''} = {}) {
  return errors.map((error, index) => {
    const moduleId = error.moduleId || fallbackModule;
    const identity = [error.scope, moduleId, error.id, error.child, error.section, error.owner, error.key, index].map(value=>encodeURIComponent(value || '')).join(':');
    return { id:`input-draft:${identity}`, level:'error', title:`${error.label}输入错误`, message:`${error.label}：${error.message}`,
      ...(moduleId ? {moduleId} : {}), paramKey:error.key,
      ...(error.scope === 'platform-core' ? {coreId:error.child, coreKey:error.key} : {}),
      ...(page === 'equipment' ? {designPage:'equipment', itemId:error.id || itemId} : {}),
    };
  });
}
