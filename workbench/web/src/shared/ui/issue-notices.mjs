/** Small entry points for the shared issue dialog. No project or view dependencies. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function issueNoticeButton(issues, { label = '查看检查结果', liveKey, showEmpty = false } = {}) {
  if (!issues?.length && !showEmpty) return '';
  issues ||= [];
  const status = issues.some(issue => issue.level === 'error') ? 'error' : issues.some(issue => ['pending','warning'].includes(issue.level)) ? 'warning' : 'success';
  return `<button type="button" class="button small issue-notice issue-notice-${status}" data-status="${status}" data-action="show-issues" data-issue-ids="${escape(JSON.stringify(issues.map(issue => issue.id)))}" data-notice-title="${escape(label)}"${liveKey ? ` data-live="${escape(liveKey)}"` : ''}>${escape(label)} <span class="issue-notice-count">${issues.length}</span></button>`;
}
