/** Presentation follows the interaction, not just the severity of a message. */
export function noticeOptions(message, options = {}) {
  const level = ['success', 'info', 'warning', 'pending', 'error'].includes(options.level) ? options.level : 'info';
  const issues = options.issues || [];
  const presentation = options.presentation === 'dialog' || (options.presentation !== 'notification' && issues.length > 0) ? 'dialog' : 'notification';
  const details = String(message).length > 130 || String(message).split('\n').length > 3 || issues.length > 0;
  const duration = options.duration ?? (level === 'error' || details ? 0 : level === 'warning' || level === 'pending' ? 8000 : 4000);
  return { ...options, level, issues, presentation, details, duration };
}

const symbols = {
  success: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.2"/>',
  warning: '<path d="m12 3 10 18H2Z M12 9v5M12 17v.2"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
};
const svg = content => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;

export function createNotificationCenter({ host, onDetails, clock = globalThis }) {
  const doc = host.ownerDocument, records = new Map();
  const now = () => Date.now();
  function syncHost() {
    // A notification inside a modal remains readable/clickable without adding another modal.
    const parent = [...doc.querySelectorAll('dialog[open]')].at(-1) || doc.body;
    if (host.parentElement === parent) return;
    const focused = host.contains(doc.activeElement) ? doc.activeElement : null;
    parent.append(host);
    focused?.focus({ preventScroll: true });
  }
  function pause(record) {
    if (record.timer !== null) {
      clock.clearTimeout(record.timer); record.timer = null;
      record.remaining = Math.max(0, record.remaining - (now() - record.startedAt));
    }
  }
  function resume(record) {
    if (!records.has(record.key) || !record.options.duration || record.hovered || record.focused || doc.hidden || record.timer !== null) return;
    record.startedAt = now();
    record.timer = clock.setTimeout(() => dismiss(record.key), record.remaining);
  }
  function dismiss(key, restoreFocus = true) {
    const record = records.get(key); if (!record) return;
    pause(record);
    const focused = record.node.contains(doc.activeElement);
    records.delete(key); record.node.remove();
    if (focused && restoreFocus) {
      const target = [...records.values()].at(-1)?.close || (record.returnFocus?.isConnected ? record.returnFocus : doc.querySelector('#workspace'));
      target?.focus({ preventScroll: true });
    }
  }
  function show(message, incoming = {}) {
    const options = noticeOptions(message, incoming);
    const key = JSON.stringify([options.projectId || '', options.level, options.title || '', String(message), options.issues]);
    syncHost();
    const existing = records.get(key);
    if (existing) {
      existing.count++; existing.badge.hidden = false; existing.badge.textContent = `×${existing.count}`;
      pause(existing); existing.options = options; existing.remaining = options.duration; resume(existing); return;
    }
    const node = doc.createElement('section'); node.className = 'notification-toast'; node.dataset.level = options.level; node.dataset.details = String(options.details);
    node.setAttribute('role', options.level === 'error' ? 'alert' : 'status'); node.setAttribute('aria-atomic', 'true');
    const mark = doc.createElement('span'); mark.className = 'notification-toast-icon'; mark.innerHTML = svg(symbols[options.level] || symbols.warning);
    const content = doc.createElement('div'); content.className = 'notification-toast-content';
    if (options.title) { const title = doc.createElement('strong'); title.className = 'notification-toast-title'; title.textContent = options.title; content.append(title); }
    const text = doc.createElement('p'); text.className = 'notification-toast-message'; text.textContent = String(message); content.append(text);
    const badge = doc.createElement('span'); badge.className = 'notification-toast-count'; badge.hidden = true; content.append(badge);
    if (options.details) {
      const details = doc.createElement('button'); details.type = 'button'; details.className = 'notification-toast-action'; details.textContent = '查看详情';
      details.addEventListener('click', () => { const latest = records.get(key)?.options || options; dismiss(key, false); onDetails(message, { ...latest, presentation: 'dialog' }); }); content.append(details);
    }
    const close = doc.createElement('button'); close.type = 'button'; close.className = 'notification-toast-close'; close.setAttribute('aria-label', '关闭通知'); close.innerHTML = svg('<path d="m6 6 12 12m0-12L6 18"/>');
    close.addEventListener('click', () => dismiss(key));
    node.append(mark, content, close);
    const record = { key, node, close, badge, options, timer: null, remaining: options.duration, hovered: false, focused: false, count: 1, returnFocus: doc.activeElement };
    records.set(key, record);
    node.addEventListener('pointerenter', () => { record.hovered = true; pause(record); });
    node.addEventListener('pointerleave', () => { record.hovered = false; resume(record); });
    node.addEventListener('focusin', () => { record.focused = true; pause(record); });
    node.addEventListener('focusout', event => { record.focused = node.contains(event.relatedTarget); if (!record.focused) resume(record); });
    host.prepend(node); resume(record);
  }
  const visibility = () => records.forEach(record => doc.hidden ? pause(record) : resume(record));
  doc.addEventListener('visibilitychange', visibility);
  doc.addEventListener('close', syncHost, true);
  return { show, syncHost, destroy() { records.forEach(record => { pause(record); record.node.remove(); }); records.clear(); doc.removeEventListener('visibilitychange', visibility); doc.removeEventListener('close', syncHost, true); } };
}
