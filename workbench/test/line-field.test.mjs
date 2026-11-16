import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNoiseTable, valueNoise, quantizeLineWeight,
  createLineFields, getLineFieldCacheStats,
} from '../web/src/shared/effects/line-field.mjs';

test('noise is repeatable, bounded and continuous across wrapped coordinates', () => {
  const first = createNoiseTable(), second = createNoiseTable();
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, createNoiseTable(7320));
  assert.equal(first.length, 128 * 128);
  assert.ok(first.every(value => value >= -1 && value <= 1));
  assert.equal(valueNoise(first, 2, 3), first[3 * 128 + 2]);
  assert.equal(valueNoise(first, 130, 131), valueNoise(first, 2, 3));
  assert.ok(Math.abs(valueNoise(first, -0.00001, 4.5) - valueNoise(first, 0.00001, 4.5)) < 0.00001);
});

test('brightness has exactly four line-weight bands at the specified boundaries', () => {
  assert.deepEqual([0, 0.119, 0.12, 0.419, 0.42, 0.889, 0.89, 1].map(quantizeLineWeight), [0, 0, 1, 1, 2, 2, 3, 3]);
});

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) { for (const callback of this.listeners.get(type) || []) callback(event); }
  get listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
}

/** Minimal platform boundary: no browser, timers, layout engine or real graphics. */
function fakeSurface() {
  let sequence = 0, reads = 0, textDraws = 0, boxDraws = 0, diagonalLines = 0, styleReads = 0;
  const frames = new Map(), observers = [], media = [];
  const makeContext = () => { let lastX; return ({
    setTransform() {}, clearRect() {}, fillRect() {}, translate() {}, scale() {}, fill() {},
    beginPath() {}, moveTo(x) { lastX = x; }, lineTo(x) { if (x !== lastX) diagonalLines++; lastX = x; }, stroke() {}, strokeRect() { boxDraws++; }, fillText() { textDraws++; },
    getImageData() { reads++; return { data: new Uint8ClampedArray(300 * 300 * 4).fill(255) }; },
  }); };
  class Observer {
    targets = [];
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  }
  const win = new Events();
  Object.assign(win, {
    devicePixelRatio: 1, Path2D: class {},
    requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: () => { styleReads++; return { getPropertyValue: () => '' }; },
    IntersectionObserver: Observer, ResizeObserver: Observer, MutationObserver: Observer,
    matchMedia: query => { const value = new Events(); value.media = query; media.push(value); return value; },
  });
  const doc = new Events();
  Object.assign(doc, {
    defaultView: win, hidden: false, activeElement: null, documentElement: {}, dialogOpen: false,
    querySelector: () => doc.dialogOpen ? {} : null,
    createElement: () => ({ width: 0, height: 0, getContext: makeContext }),
  });
  const canvases = ['app', 'foc', 'hardware'].map(mark => {
    const card = new Events();
    card.contains = () => false;
    card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 280, height: 240 });
    return {
      ownerDocument: doc, dataset: { mark }, style: {}, width: 0, height: 0, card,
      getContext: makeContext, closest: () => card, setAttribute() {},
      getBoundingClientRect: () => ({ left: 20, top: 20, width: 200, height: 200 }),
    };
  });
  return {
    win, doc, canvases, observers, media, frames, root: { ownerDocument: doc, querySelectorAll: () => canvases },
    get reads() { return reads; },
    get textDraws() { return textDraws; },
    get boxDraws() { return boxDraws; },
    get diagonalLines() { return diagonalLines; },
    get styleReads() { return styleReads; },
    flush(time) { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); },
  };
}

test('paused DPR changes redraw once, three samples survive remount, and lifecycle cleanup stops work', t => {
  const surface = fakeSurface();
  const { win, doc, root, canvases, frames, observers, media } = surface;
  let available;
  let controller = createLineFields(root, { enabled: false, onAvailability: value => { available = value; } });
  t.after(() => controller.destroy());
  assert.equal(available, true);
  surface.flush(0);
  assert.equal(frames.size, 0);
  assert.equal(surface.reads, 3);
  assert.deepEqual(getLineFieldCacheStats().lengths, [3600, 3600, 3600]);
  assert.ok(canvases.every(canvas => canvas.width === 200 && canvas.height === 200));
  const previousStyles = surface.styleReads;
  controller.refreshAppearance(); surface.flush(8);
  assert.equal(surface.styleReads, previousStyles + 3, 'theme refresh rereads current canvas colors');
  assert.equal(frames.size, 0, 'theme refresh does not enable paused motion');

  win.devicePixelRatio = 2;
  media.find(value => value.media === '(resolution: 1dppx)').emit('change');
  assert.equal(frames.size, 1);
  surface.flush(16);
  assert.equal(frames.size, 0);
  assert.ok(canvases.every(canvas => canvas.width === 400 && canvas.height === 400));
  assert.equal(surface.reads, 3);
  canvases[0].card.emit('focusin');
  surface.flush(32);
  assert.equal(frames.size, 0, 'focus paints a stable frame without starting animation');

  controller.setEnabled(true);
  canvases[0].card.emit('pointerenter', { clientX: 120, clientY: 120 });
  surface.flush(48);
  assert.equal(frames.size, 1);
  assert.equal(surface.textDraws, 0, 'decorative logos never draw coordinate labels, including on focus and motion');
  assert.equal(surface.boxDraws, 0, 'hovering never draws detection boxes');
  assert.equal(surface.diagonalLines, 0, 'graphics contain vertical segments only, without auxiliary connections');
  doc.hidden = true; doc.emit('visibilitychange');
  assert.equal(frames.size, 0);
  doc.hidden = false; doc.emit('visibilitychange'); surface.flush(64);
  assert.equal(frames.size, 1);
  doc.dialogOpen = true; observers[2].callback([]); surface.flush(80);
  assert.equal(frames.size, 0);
  doc.dialogOpen = false; observers[2].callback([]); surface.flush(96);
  assert.equal(frames.size, 1);
  observers[0].callback(canvases.map(canvas => ({ target: canvas.card, isIntersecting: false })));
  surface.flush(112);
  assert.equal(frames.size, 0);

  controller.destroy();
  assert.ok(observers.every(observer => observer.disconnected));
  assert.ok([win, doc, ...media, ...canvases.map(canvas => canvas.card)].every(target => target.listenerCount === 0));
  assert.equal(frames.size, 0);
  controller = createLineFields(root, { enabled: false }); surface.flush(128);
  assert.equal(surface.reads, 3, 'full application rerenders reuse all three source tables');
  controller.setEnabled(true); surface.flush(144);
  controller.destroy();
  assert.equal(frames.size, 0, 'destroy cancels an already scheduled animation frame');
});

test('pages without fields preserve availability and unsupported graphics degrade gracefully', () => {
  let available = true, reports = 0;
  const onAvailability = value => { available = value; reports++; };
  const surface = fakeSurface();
  const empty = { ownerDocument: surface.doc, querySelectorAll: () => [] };
  const idle = createLineFields(empty, { onAvailability });
  assert.equal(available, true);
  assert.equal(reports, 0, 'an empty page cannot confirm graphics support');
  idle.setEnabled(true); idle.destroy();
  assert.equal(surface.frames.size, 0);

  for (const canvas of surface.canvases) canvas.getContext = () => null;
  const failedContext = createLineFields(surface.root, { onAvailability });
  assert.equal(available, false);
  failedContext.destroy();
  const afterContextFailure = createLineFields(empty, { onAvailability });
  assert.equal(available, false, 'navigation must preserve a previous Canvas 2D failure');
  assert.equal(reports, 1);
  afterContextFailure.destroy();

  surface.win.Path2D = undefined;
  const unsupported = createLineFields(surface.root, { onAvailability });
  assert.equal(available, false);
  unsupported.setEnabled(true); unsupported.destroy();
  const afterMissingApi = createLineFields(empty, { onAvailability });
  assert.equal(available, false, 'an empty route cannot restore a missing graphics API');
  afterMissingApi.destroy();
  assert.equal(surface.frames.size, 0);
});
