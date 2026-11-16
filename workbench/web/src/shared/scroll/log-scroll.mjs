const END_TOLERANCE_PX = 4;
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const clamp = (value, maximum) => Math.min(maximum, Math.max(0, finite(value)));
const logs = root => root?.querySelectorAll?.('[data-log-key]') || [];

function visible(node) {
  if (!node.dataset?.logKey || node.hidden || finite(node.clientHeight) <= 0 || finite(node.clientWidth) <= 0) return false;
  if (node.getClientRects && node.getClientRects().length === 0) return false;
  const view = node.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(node);
  return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse';
}

function limits(node) {
  return {
    top: Math.max(0, finite(node.scrollHeight) - finite(node.clientHeight)),
    left: Math.max(0, finite(node.scrollWidth) - finite(node.clientWidth)),
  };
}

/** Capture before either a partial update or a full workspace replacement. */
export function captureLogScroll(root) {
  const snapshot = new Map();
  for (const node of logs(root)) {
    if (!visible(node)) continue;
    const maximum = limits(node);
    const top = clamp(node.scrollTop, maximum.top);
    snapshot.set(node.dataset.logKey, {
      top,
      left: clamp(node.scrollLeft, maximum.left),
      atEnd: maximum.top - top <= END_TOLERANCE_PX,
    });
  }
  return snapshot;
}

/** Follow new output only when already at the end; other readers keep their place. */
export function restoreLogScroll(root, snapshot = new Map()) {
  for (const node of logs(root)) {
    if (!visible(node)) continue;
    const previous = snapshot.get(node.dataset.logKey);
    const maximum = limits(node);
    const follow = node.dataset.logFollow === 'end' && (!previous || previous.atEnd);
    node.scrollTop = follow ? maximum.top : clamp(previous?.top, maximum.top);
    node.scrollLeft = clamp(previous?.left, maximum.left);
  }
}
