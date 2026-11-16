/** Decorative, deterministic line fields. No device state or external assets. */
export const LINE_FIELD_GRID = 60;
const GRID = LINE_FIELD_GRID, SEGMENTS = 30, COUNT = GRID * SEGMENTS;
const WEIGHTS = [0.38, 1.12, 2.28, 3.80], ALPHAS = [0.15, 0.64, 0.93, 1];
const MARKS = Object.freeze({
  // Three rounded 7 × 7 cells and a plus, matching assets/icons.svg#application.
  application: { seed: 3, scale: 0.82, strokeWidth: 1.7, path: 'M4.5 3H8.5A1.5 1.5 0 0 1 10 4.5V8.5A1.5 1.5 0 0 1 8.5 10H4.5A1.5 1.5 0 0 1 3 8.5V4.5A1.5 1.5 0 0 1 4.5 3ZM15.5 3H19.5A1.5 1.5 0 0 1 21 4.5V8.5A1.5 1.5 0 0 1 19.5 10H15.5A1.5 1.5 0 0 1 14 8.5V4.5A1.5 1.5 0 0 1 15.5 3ZM4.5 14H8.5A1.5 1.5 0 0 1 10 15.5V19.5A1.5 1.5 0 0 1 8.5 21H4.5A1.5 1.5 0 0 1 3 19.5V15.5A1.5 1.5 0 0 1 4.5 14ZM14 17.5h7M17.5 14v7' },
  // Three 120°-shifted sine paths, matching the algorithm symbol in assets/icons.svg.
  algorithm: { seed: 29, scale: 0.84, strokeWidth: 1.8, path: 'M2 12C3.111 9.906 4.222 7.851 5.333 6.804C6.444 5.757 7.556 5.757 8.667 6.804C9.778 7.851 10.889 9.906 12 12C13.111 14.094 14.222 16.149 15.333 17.196C16.444 18.243 17.556 18.243 18.667 17.196C19.778 16.149 20.889 14.094 22 12 M2 6.804C3.111 7.851 4.222 9.906 5.333 12C6.444 14.094 7.556 16.149 8.667 17.196C9.778 18.243 10.889 18.243 12 17.196C13.111 16.149 14.222 14.094 15.333 12C16.444 9.906 17.556 7.851 18.667 6.804C19.778 5.757 20.889 5.757 22 6.804 M2 17.196C3.111 18.243 4.222 18.243 5.333 17.196C6.444 16.149 7.556 14.094 8.667 12C9.778 9.906 10.889 7.851 12 6.804C13.111 5.757 14.222 5.757 15.333 6.804C16.444 7.851 17.556 9.906 18.667 12C19.778 14.094 20.889 16.149 22 17.196' },
  hardware: { seed: 51, scale: 0.80, path: 'M5 5H19V19H5ZM8 8V16H16V8ZM7 1H9V5H7ZM11 1H13V5H11ZM15 1H17V5H15ZM7 19H9V23H7ZM11 19H13V23H11ZM15 19H17V23H15ZM1 7H5V9H1ZM1 11H5V13H1ZM1 15H5V17H1ZM19 7H23V9H19ZM19 11H23V13H19ZM19 15H23V17H19Z' },
});
const ALIASES = { app: 'application', foc: 'algorithm', application: 'application', algorithm: 'algorithm', hardware: 'hardware' };
const sourceCache = new Map();
let sampleCount = 0;

export function createNoiseTable(seed = 7319, size = 128) {
  const table = new Float32Array(size * size);
  let state = seed | 0;
  for (let i = 0; i < table.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    table[i] = (state >>> 0) / 4294967295 * 2 - 1;
  }
  return table;
}
const noiseTable = createNoiseTable();
const smooth = value => value * value * (3 - 2 * value);
const wrap = (value, size) => ((value % size) + size) % size;
export function valueNoise(table, x, y, size = 128) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const x0 = wrap(ix, size), x1 = wrap(ix + 1, size), y0 = wrap(iy, size), y1 = wrap(iy + 1, size);
  const a = table[y0 * size + x0] * (1 - fx) + table[y0 * size + x1] * fx;
  const b = table[y1 * size + x0] * (1 - fx) + table[y1 * size + x1] * fx;
  return a * (1 - fy) + b * fy;
}
export function quantizeLineWeight(value) { return value < 0.12 ? 0 : value < 0.42 ? 1 : value < 0.89 ? 2 : 3; }

/** Read-only diagnostics; source arrays and canvas objects are never exposed. */
export function getLineFieldCacheStats() {
  return { sampleCount, marks: [...sourceCache.keys()], lengths: [...sourceCache.values()].map(value => value.length) };
}

function sampleMark(doc, Path, name) {
  if (sourceCache.has(name)) return sourceCache.get(name);
  const canvas = doc.createElement('canvas');
  canvas.width = 300; canvas.height = 300;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = '#000'; context.fillRect(0, 0, 300, 300);
    context.translate(150, 150);
    const scale = 300 * MARKS[name].scale / 24;
    context.scale(scale, scale); context.translate(-12, -12);
    const mark = MARKS[name], path = new Path(mark.path);
    if (mark.strokeWidth) {
      context.strokeStyle = '#fff'; context.lineWidth = mark.strokeWidth;
      context.lineCap = 'round'; context.lineJoin = 'round'; context.stroke(path);
    } else { context.fillStyle = '#fff'; context.fill(path, 'evenodd'); }
    const pixels = context.getImageData(0, 0, 300, 300).data;
    sampleCount++;
    const field = new Float32Array(GRID * GRID);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      let sum = 0;
      for (let sy = 0; sy < 5; sy++) for (let sx = 0; sx < 5; sx++) {
        const at = ((y * 5 + sy) * 300 + x * 5 + sx) * 4;
        sum += (0.2126 * pixels[at] + 0.7152 * pixels[at + 1] + 0.0722 * pixels[at + 2]) / 255;
      }
      field[y * GRID + x] = sum / 25;
    }
    sourceCache.set(name, field);
    return field;
  } finally { canvas.width = 0; canvas.height = 0; }
}

function updateSegments(scene, dt, moving) {
  if (!moving) { scene.dx.fill(0); scene.dy.fill(0); scene.vx.fill(0); scene.vy.fill(0); scene.pulse = 0; }
  const radius = scene.side / 4;
  for (let column = 0; column < GRID; column++) for (let segment = 0; segment < SEGMENTS; segment++) {
    const row = segment * 2, at = column * SEGMENTS + segment;
    const base = (scene.source[row * GRID + column] + scene.source[(row + 1) * GRID + column]) / 2;
    const noise = valueNoise(noiseTable, column * 0.15 + scene.mark.seed, row * 0.16 - scene.time * 0.17);
    scene.brightness[at] = Math.max(0, Math.min(1, base * 0.94 + noise * 0.12 * (0.25 + base * 0.75)));
    if (!moving) continue;
    const px = scene.left + (column + 0.5) * scene.cell - scene.pointerX;
    const py = scene.top + (row + 1) * scene.cell - scene.pointerY;
    const distance = Math.hypot(px, py), influence = Math.max(0, 1 - distance / radius) ** 2 * scene.pulse * 25;
    const tx = distance > 0.001 ? px / distance * influence : 0;
    const ty = distance > 0.001 ? py / distance * influence * 0.58 : 0;
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, 1 / 30); remaining -= step;
      scene.vx[at] += ((tx - scene.dx[at]) * 145 - scene.vx[at] * 19) * step;
      scene.vy[at] += ((ty - scene.dy[at]) * 145 - scene.vy[at] * 19) * step;
      scene.dx[at] += scene.vx[at] * step; scene.dy[at] += scene.vy[at] * step;
    }
  }
  if (moving) scene.pulse *= Math.exp(-dt * 5.5);
}
function paint(scene) {
  const ctx = scene.context;
  ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
  ctx.strokeStyle = scene.ink; ctx.lineCap = 'butt';
  const halfLength = Math.max(0.05, scene.cell - 0.35);
  for (let weight = 0; weight < 4; weight++) {
    ctx.beginPath(); ctx.lineWidth = WEIGHTS[weight] * scene.cell / 5.25; ctx.globalAlpha = ALPHAS[weight];
    for (let column = 0; column < GRID; column++) for (let segment = 0; segment < SEGMENTS; segment++) {
      const at = column * SEGMENTS + segment;
      if (quantizeLineWeight(scene.brightness[at]) !== weight) continue;
      const x = scene.left + (column + 0.5) * scene.cell + scene.dx[at];
      const y = scene.top + (segment * 2 + 1) * scene.cell + scene.dy[at];
      ctx.moveTo(x, y - halfLength); ctx.lineTo(x, y + halfLength);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
/** Creates independent canvases under root; all listeners are passive and decorative. */
export function createLineFields(root, { enabled = false, onAvailability } = {}) {
  const doc = root?.ownerDocument || (root?.nodeType === 9 ? root : null);
  const win = doc?.defaultView;
  let disposed = false, requested = Boolean(enabled), raf = 0, lastTime = null, availability;
  const scenes = [], removeListeners = [];
  const notify = value => { if (availability !== value) { availability = value; onAvailability?.(value); } };
  const inert = { setEnabled() {}, refreshAppearance() {}, destroy() { disposed = true; } };
  if (!root?.querySelectorAll) { notify(false); return inert; }
  if (!win?.Path2D || !win.requestAnimationFrame) { notify(false); return inert; }
  const canvases = [...root.querySelectorAll('canvas.line-field[data-mark]')];
  // No context was tested on this page: preserve the application's known capability.
  if (!canvases.length) return inert;
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    removeListeners.push(() => target.removeEventListener(event, handler, options));
  };
  for (const canvas of canvases) {
    const name = ALIASES[canvas.dataset.mark], card = canvas.closest('.layer-entry');
    if (!name || !card) continue;
    try {
      const context = canvas.getContext('2d'), source = context && sampleMark(doc, win.Path2D, name);
      if (!context || !source) continue;
      canvas.setAttribute('aria-hidden', 'true'); canvas.style.pointerEvents = 'none';
      const scene = {
        canvas, card, context, source, mark: MARKS[name], visible: true, dirty: true, layoutDirty: true,
        width: 0, height: 0, dpr: 0, time: 0, pulse: 0,
        pointerX: -1e6, pointerY: -1e6, pulseX: -1e6, pulseY: -1e6, pending: null,
        dx: new Float32Array(COUNT), dy: new Float32Array(COUNT), vx: new Float32Array(COUNT), vy: new Float32Array(COUNT),
        brightness: new Float32Array(COUNT),
      };
      scenes.push(scene);
    } catch { /* Unsupported graphics contexts leave the ordinary card fully usable. */ }
  }
  notify(scenes.length > 0);
  if (!scenes.length) return inert;
  let dialogOpen = Boolean(doc.querySelector('dialog[open]'));
  // The application owns the motion preference; explicit user choices take priority.
  const moving = scene => requested && !doc.hidden && !dialogOpen && scene.visible;
  function request() {
    if (!disposed && !doc.hidden && !raf) raf = win.requestAnimationFrame(frame);
  }
  function refresh(layout = false) {
    for (const scene of scenes) { scene.dirty = true; scene.layoutDirty ||= layout; }
    lastTime = null;
    if (doc.hidden) { if (raf) win.cancelAnimationFrame(raf); raf = 0; }
    else request();
  }
  function measure(scene) {
    const rect = scene.canvas.getBoundingClientRect(), cardRect = scene.card.getBoundingClientRect();
    scene.width = rect.width; scene.height = rect.height;
    scene.offsetX = rect.left - cardRect.left; scene.offsetY = rect.top - cardRect.top;
    scene.side = Math.min(rect.width, rect.height) * 0.90; scene.cell = scene.side / GRID;
    scene.left = (rect.width - scene.side) / 2; scene.top = (rect.height - scene.side) / 2;
    const style = win.getComputedStyle(scene.canvas);
    scene.ink = style.getPropertyValue('--line-field-ink').trim() || 'rgba(141, 163, 183, 0.55)';
    scene.layoutDirty = false;
    return cardRect;
  }
  function frame(timestamp) {
    raf = 0;
    if (disposed || doc.hidden) { lastTime = null; return; }
    const dt = lastTime === null ? 1 / 60 : Math.min(0.1, Math.max(0, (timestamp - lastTime) / 1000));
    lastTime = timestamp;
    let again = false;
    for (const scene of scenes) {
      if (!scene.visible) continue;
      const dpr = win.devicePixelRatio || 1, running = moving(scene);
      if (!running && !scene.dirty && scene.dpr === dpr) continue;
      let cardRect;
      if (scene.layoutDirty) cardRect = measure(scene);
      if (scene.width <= 0 || scene.height <= 0) { scene.dirty = false; continue; }
      const width = Math.round(scene.width * dpr), height = Math.round(scene.height * dpr);
      if (scene.canvas.width !== width || scene.canvas.height !== height || scene.dpr !== dpr) {
        scene.canvas.width = width; scene.canvas.height = height; scene.dpr = dpr;
      }
      if (scene.pending) {
        cardRect ||= scene.card.getBoundingClientRect();
        const pointer = scene.pending;
        scene.pointerX = pointer.x - cardRect.left - scene.offsetX;
        scene.pointerY = pointer.y - cardRect.top - scene.offsetY;
        if (pointer.pulse || Math.hypot(scene.pointerX - scene.pulseX, scene.pointerY - scene.pulseY) > 1.5) {
          scene.pulse = running ? 1 : 0; scene.pulseX = scene.pointerX; scene.pulseY = scene.pointerY;
        }
        scene.pending = null;
      }
      if (running) scene.time += dt;
      updateSegments(scene, dt, running);
      paint(scene); scene.dirty = false;
      again ||= running;
    }
    if (again) request(); else lastTime = null;
  }
  for (const scene of scenes) {
    const pointer = (event, entering = false) => {
      scene.pending = { x: event.clientX, y: event.clientY, pulse: entering || scene.pending?.pulse };
      if (entering) { scene.dirty = true; request(); }
    };
    listen(scene.card, 'pointerenter', event => pointer(event, true), { passive: true });
    listen(scene.card, 'pointermove', event => pointer(event), { passive: true });
    listen(scene.card, 'pointerdown', event => pointer(event, true), { passive: true });
    const leave = () => { scene.pending = null; scene.pulse = 0; scene.dirty = true; request(); };
    listen(scene.card, 'pointerleave', leave, { passive: true });
    listen(scene.card, 'pointercancel', leave, { passive: true });
    listen(scene.card, 'pointerup', event => { if (event.pointerType !== 'mouse') leave(); }, { passive: true });
  }
  const intersection = win.IntersectionObserver ? new win.IntersectionObserver(entries => {
    for (const entry of entries) for (const scene of scenes) if (scene.card === entry.target) { scene.visible = entry.isIntersecting; scene.dirty = true; }
    refresh();
  }, { threshold: 0 }) : null;
  const resize = win.ResizeObserver ? new win.ResizeObserver(() => refresh(true)) : null;
  for (const scene of scenes) { intersection?.observe(scene.card); resize?.observe(scene.canvas); resize?.observe(scene.card); }
  const mutations = win.MutationObserver ? new win.MutationObserver(() => {
    const open = Boolean(doc.querySelector('dialog[open]'));
    if (open !== dialogOpen) { dialogOpen = open; refresh(); }
  }) : null;
  mutations?.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true });
  listen(doc, 'visibilitychange', () => refresh());
  listen(win, 'resize', () => refresh(true), { passive: true });
  let dprMedia, dprListener;
  function watchDpr() {
    if (dprMedia && dprListener) dprMedia.removeEventListener?.('change', dprListener);
    dprMedia = win.matchMedia?.(`(resolution: ${win.devicePixelRatio || 1}dppx)`);
    dprListener = () => { watchDpr(); refresh(true); };
    dprMedia?.addEventListener?.('change', dprListener);
  }
  watchDpr(); request();
  return {
    setEnabled(value) { if (disposed) return; requested = Boolean(value); refresh(); },
    refreshAppearance() { if (disposed) return; refresh(true); },
    destroy() {
      if (disposed) return;
      disposed = true;
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0; intersection?.disconnect(); resize?.disconnect(); mutations?.disconnect();
      dprMedia?.removeEventListener?.('change', dprListener);
      for (const remove of removeListeners) remove();
    },
  };
}
