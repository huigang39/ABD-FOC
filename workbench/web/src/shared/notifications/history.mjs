import { sanitizeIssueMessageParts } from '../ui/issue-message.mjs';

const STORAGE_KEY = 'actuator-console.notifications.v1';
const ISSUE_FIELDS = ['id', 'title', 'message', 'level', 'moduleId', 'paramKey', 'designPage', 'itemId', 'path'];
const LEVELS = new Set(['info', 'success', 'warning', 'error', 'pending']);
const text = value => typeof value === 'string' ? value : '';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copyIssues = issues => (Array.isArray(issues) ? issues : []).filter(plain).map(issue => {
  const result = Object.fromEntries(ISSUE_FIELDS.filter(key => typeof issue[key] === 'string').map(key => [key, issue[key]]));
  const messageParts = sanitizeIssueMessageParts(issue.messageParts);
  if (messageParts) result.messageParts = messageParts;
  return result;
});
const copyEntry = entry => ({ ...entry, issues: copyIssues(entry.issues) });
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const projectKey = entry => entry.projectId ? `id:${entry.projectId}` : `name:${entry.projectName}`;
const contentKey = entry => JSON.stringify([entry.level, entry.title, entry.message, entry.issues.map(issue => JSON.stringify(issue)).sort()]);

function validEntry(entry) {
  return plain(entry) && typeof entry.id === 'string' && entry.id.length > 0 && LEVELS.has(entry.level)
    && typeof entry.title === 'string' && typeof entry.message === 'string'
    && typeof entry.projectId === 'string' && typeof entry.projectName === 'string'
    && date(entry.createdAt) && date(entry.updatedAt) && Date.parse(entry.updatedAt) >= Date.parse(entry.createdAt)
    && Number.isSafeInteger(entry.count) && entry.count > 0 && typeof entry.read === 'boolean'
    && Array.isArray(entry.issues) && entry.issues.every(plain);
}

/** The bell summarizes unread notifications, independently of the history filter. */
export function notificationIndicator(entries) {
  const unread = entries.filter(entry => !entry.read);
  return {
    count: unread.length,
    level: unread.some(entry => entry.level === 'error') ? 'error'
      : unread.some(entry => entry.level === 'warning' || entry.level === 'pending') ? 'warning' : 'normal',
  };
}

/** Independent local history; storage failures never interrupt notification delivery. */
export function createNotificationHistory({ storage, limit = 100, onChange = () => {} } = {}) {
  const capacity = Number.isSafeInteger(limit) && limit > 0 ? limit : 100;
  let entries = [], persistent = false, sequence = 0;
  try {
    persistent = Boolean(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');
    if (persistent) {
      const stored = storage.getItem(STORAGE_KEY);
      if (stored !== null && stored !== undefined) {
        const payload = JSON.parse(stored);
        if (!plain(payload) || payload.version !== 1 || !Array.isArray(payload.entries) || !payload.entries.every(validEntry)
          || new Set(payload.entries.map(entry => entry.id)).size !== payload.entries.length) throw new Error('Invalid notification history');
        entries = payload.entries.map(entry => ({
          id: entry.id, level: entry.level, title: entry.title, message: entry.message, issues: copyIssues(entry.issues),
          projectId: entry.projectId, projectName: entry.projectName, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
          count: entry.count, read: entry.read,
        })).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, capacity);
      }
    }
  } catch {
    entries = [];
    persistent = false;
  }

  function changed() {
    if (persistent) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries })); }
      catch { persistent = false; }
    }
    try { onChange(entries.map(copyEntry)); }
    catch { /* A view callback must not break the notification producer. */ }
  }

  return {
    get entries() { return entries.map(copyEntry); },
    get persistent() { return persistent; },

    add(value = {}) {
      const input = plain(value) ? value : {}, now = Date.now(), timestamp = new Date(now).toISOString();
      const notification = {
        level: LEVELS.has(input.level) ? input.level : 'info', title: text(input.title), message: text(input.message),
        issues: copyIssues(input.issues), projectId: text(input.projectId), projectName: text(input.projectName),
      };
      const key = contentKey(notification), project = projectKey(notification);
      const index = entries.findIndex(entry => {
        const elapsed = now - Date.parse(entry.updatedAt);
        return elapsed >= 0 && elapsed <= 10000 && projectKey(entry) === project && contentKey(entry) === key;
      });
      if (index !== -1) {
        const previous = entries[index];
        const entry = { ...previous, ...notification, updatedAt: timestamp, count: Math.min(Number.MAX_SAFE_INTEGER, previous.count + 1), read: false };
        if (index === 0 && JSON.stringify(entry) === JSON.stringify(previous)) return copyEntry(previous);
        entries.splice(index, 1); entries.unshift(entry);
        changed();
        return copyEntry(entry);
      }
      const entry = {
        id: globalThis.crypto?.randomUUID?.() || `notification-${now}-${++sequence}-${Math.random().toString(36).slice(2, 10)}`,
        ...notification, createdAt: timestamp, updatedAt: timestamp, count: 1, read: false,
      };
      entries.unshift(entry); entries = entries.slice(0, capacity);
      changed();
      return copyEntry(entry);
    },

    markRead(id) {
      const entry = entries.find(entry => entry.id === id);
      if (!entry || entry.read) return false;
      entry.read = true;
      // updatedAt tracks the latest occurrence, not when its notification was read.
      changed();
      return true;
    },

    markAllRead() {
      if (!entries.some(entry => !entry.read)) return false;
      for (const entry of entries) entry.read = true;
      changed();
      return true;
    },

    clear() {
      if (!entries.length) return false;
      entries = [];
      changed();
      return true;
    },
  };
}
