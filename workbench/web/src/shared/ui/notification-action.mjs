import { esc } from '../esc.mjs';
import { icon } from './icons.mjs';

export const notificationActionLevel = level => level === 'error' ? 'error' : ['warning', 'pending'].includes(level) ? 'warning' : 'normal';

/** Compact notification actions retain their complete meaning for keyboard and assistive users. */
export function notificationActionButton({ label = '查看通知', count = null, level = 'normal', action, data = {}, className = '' } = {}) {
  const quantity = Number.isSafeInteger(count) && count >= 0 ? count : null;
  const description = `${label}${quantity === null ? '' : `，${quantity} 项`}`;
  const classes = className.replace(/[^a-zA-Z0-9 _-]/g, '');
  const attributes = Object.entries(data).filter(([key]) => /^[a-z][a-z0-9-]*$/.test(key) && !['action','level'].includes(key))
    .map(([key, value]) => ` data-${key}="${esc(value)}"`).join('');
  return `<button type="button" class="button notification-action${classes ? ` ${classes}` : ''}" data-action="${esc(action || '')}" data-level="${notificationActionLevel(level)}" aria-label="${esc(description)}" title="${esc(description)}"${attributes}>${icon('check')}${quantity === null ? '' : `<span class="notification-action-count" aria-hidden="true">${quantity}</span>`}</button>`;
}
