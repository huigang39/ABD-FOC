/** Small entry points for the shared issue dialog. No project or view dependencies. */
import { notificationActionButton } from './notification-action.mjs';

export function issueNoticeButton(issues, { label = '查看检查结果', liveKey, showEmpty = false } = {}) {
  if (!issues?.length && !showEmpty) return '';
  issues ||= [];
  const status = issues.some(issue => issue.level === 'error') ? 'error' : issues.some(issue => ['pending','warning'].includes(issue.level)) ? 'warning' : 'normal';
  return notificationActionButton({ label, count: issues.length, level: status, action: 'show-issues', className: `issue-notice issue-notice-${status}`,
    data: { status, 'issue-ids': JSON.stringify(issues.map(issue => issue.id)), 'notice-title': label, ...(liveKey ? { live: liveKey } : {}) },
  });
}
