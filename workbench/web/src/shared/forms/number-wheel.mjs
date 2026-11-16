const installed = new WeakMap();
const finite = value => Number.isFinite(value) ? value : 0;
const parentOf = node => node?.parentElement || node?.getRootNode?.().host || null;
const isNumberInput = node => node?.localName === 'input' && node.type === 'number';

function wheelPixels(event, input, doc) {
  const style = doc.defaultView?.getComputedStyle?.(input);
  const line = Number.parseFloat(style?.lineHeight) || 16;
  const page = doc.documentElement?.clientHeight || doc.defaultView?.innerHeight || 800;
  const scale = event.deltaMode === 1 ? line : event.deltaMode === 2 ? page : 1;
  let x = finite(event.deltaX) * scale, y = finite(event.deltaY) * scale;
  if (event.shiftKey && !x) { x = y; y = 0; }
  return { x, y };
}

function move(node, axis, delta, style) {
  const vertical = axis === 'y';
  const position = vertical ? 'scrollTop' : 'scrollLeft';
  const extent = vertical ? 'scrollHeight' : 'scrollWidth';
  const viewport = vertical ? 'clientHeight' : 'clientWidth';
  const maximum = Math.max(0, finite(node[extent]) - finite(node[viewport]));
  const before = finite(node[position]);
  // RTL horizontal scrolling uses negative scrollLeft in modern browsers.
  const minimum = !vertical && style.direction === 'rtl' ? -maximum : 0;
  const upper = minimum < 0 ? 0 : maximum;
  const next = Math.min(upper, Math.max(minimum, before + delta));
  if (next !== before) {
    // Force immediate wheel-sized movement even when CSS requests smooth scrolling.
    if (node.scrollTo) node.scrollTo({ [vertical ? 'top' : 'left']: next, behavior: 'instant' });
    else node[position] = next;
  }
  return delta - (finite(node[position]) - before);
}

/** Preserve scrolling without handing the wheel default action to a number input. */
function scrollAncestors(input, event, doc) {
  const remaining = wheelPixels(event, input, doc);
  const root = doc.scrollingElement || doc.documentElement;
  let node = parentOf(input), sawRoot = false;
  while (node && (remaining.x || remaining.y)) {
    const style = doc.defaultView?.getComputedStyle?.(node) || {};
    const isRoot = node === root;
    sawRoot ||= isRoot;
    for (const axis of ['x', 'y']) {
      if (!remaining[axis]) continue;
      const overflow = style[axis === 'y' ? 'overflowY' : 'overflowX'];
      const scrollable = /^(auto|scroll|overlay)$/.test(overflow || '') || (isRoot && !/^(hidden|clip)$/.test(overflow || ''));
      if (!scrollable) continue;
      remaining[axis] = move(node, axis, remaining[axis], style);
      if (/^(contain|none)$/.test(style[axis === 'y' ? 'overscrollBehaviorY' : 'overscrollBehaviorX'] || '')) remaining[axis] = 0;
    }
    // Never move the page behind an open dialog when its own scroll reaches an edge.
    if (node.localName === 'dialog' && node.open) return;
    node = parentOf(node);
  }
  // Supports documents whose scrollingElement is not on the element parent chain.
  if (!sawRoot && root && (remaining.x || remaining.y)) {
    const style = doc.defaultView?.getComputedStyle?.(root) || {};
    for (const axis of ['x', 'y']) if (remaining[axis] && !/^(hidden|clip)$/.test(style[axis === 'y' ? 'overflowY' : 'overflowX'] || '')) move(root, axis, remaining[axis], style);
  }
}

/** Install once for all current and future numeric fields; returns cleanup. */
export function installNumberWheelGuard(doc = globalThis.document) {
  if (!doc?.addEventListener) return () => {};
  if (installed.has(doc)) return installed.get(doc);
  const listener = event => {
    // Ctrl+wheel includes touchpad pinch-to-zoom, which must remain a browser action.
    if (event.ctrlKey || event.defaultPrevented || event.cancelable === false) return;
    const input = (event.composedPath?.() || [event.target]).find(isNumberInput);
    if (!input || input.disabled || input.readOnly) return;
    event.preventDefault();
    if (event.defaultPrevented) scrollAncestors(input, event, doc);
  };
  doc.addEventListener('wheel', listener, { capture: true, passive: false });
  const cleanup = () => {
    doc.removeEventListener('wheel', listener, true);
    installed.delete(doc);
  };
  installed.set(doc, cleanup);
  return cleanup;
}
