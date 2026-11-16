import test from 'node:test';
import assert from 'node:assert/strict';
import { installNumberWheelGuard } from '../web/src/shared/forms/number-wheel.mjs';

function element(options = {}) {
  return {
    localName: 'div', style: {}, parentElement: null,
    scrollTop: 0, scrollLeft: 0, scrollHeight: 600, clientHeight: 200, scrollWidth: 300, clientWidth: 300,
    scrollTo(options) {
      assert.equal(options.behavior, 'instant');
      if ('top' in options) this.scrollTop = options.top;
      if ('left' in options) this.scrollLeft = options.left;
    },
    ...options,
  };
}
function setup() {
  const root = element({ localName: 'html', scrollHeight: 1800, clientHeight: 600 });
  const listeners = new Map();
  const doc = {
    documentElement: root, scrollingElement: root,
    defaultView: { getComputedStyle: node => node.style, innerHeight: 600 },
    addEventListener(type, callback, options) { assert.equal(type, 'wheel'); assert.deepEqual(options, { capture: true, passive: false }); listeners.set(type, callback); },
    removeEventListener(type, callback, capture) { assert.equal(capture, true); assert.equal(listeners.get(type), callback); listeners.delete(type); },
  };
  installNumberWheelGuard(doc);
  const field = (parent = root, options = {}) => element({ localName: 'input', type: 'number', value: '24.5', parentElement: parent, ...options });
  const fire = (target, options = {}) => {
    const event = { target, deltaY: 40, deltaX: 0, deltaMode: 0, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...options };
    listeners.get('wheel')?.(event);
    return event;
  };
  return { root, doc, field, fire, listeners };
}

test('capture delegation blocks numeric stepping, keeps value/focus, and scrolls the page', () => {
  const { root, doc, field, fire } = setup();
  const input = field(null);
  // Created after installation, as all dynamic forms are.
  input.parentElement = root;
  input.blur = () => assert.fail('wheel must not blur an active numeric field');
  doc.activeElement = input;
  assert.equal(fire(input).defaultPrevented, true);
  assert.equal(input.value, '24.5');
  assert.equal(doc.activeElement, input);
  assert.equal(root.scrollTop, 40);
});

test('nearest scroll container consumes motion before the page, including edge remainder', () => {
  const { root, field, fire } = setup();
  const pane = element({ parentElement: root, style: { overflowY: 'auto' }, scrollTop: 380 });
  fire(field(pane));
  assert.equal(pane.scrollTop, 400);
  assert.equal(root.scrollTop, 20);
  fire(field(pane), { deltaY: -50 });
  assert.equal(pane.scrollTop, 350);
  assert.equal(root.scrollTop, 20);
});

test('overscroll containment and open dialogs keep the background stationary at an edge', () => {
  for (const options of [
    { style: { overflowY: 'auto', overscrollBehaviorY: 'contain' } },
    { localName: 'dialog', open: true, style: { overflowY: 'auto' } },
  ]) {
    const { root, field, fire } = setup();
    const pane = element({ parentElement: root, scrollTop: 400, ...options });
    assert.equal(fire(field(pane)).defaultPrevented, true);
    assert.equal(root.scrollTop, 0);
    assert.equal(pane.scrollTop, 400);
  }
});

test('line, page, shift-horizontal and RTL wheel offsets keep their directions', () => {
  const { root, field, fire } = setup();
  const input = field(root, { style: { lineHeight: '24px' } });
  fire(input, { deltaY: 2, deltaMode: 1 });
  assert.equal(root.scrollTop, 48);
  fire(input, { deltaY: 1, deltaMode: 2 });
  assert.equal(root.scrollTop, 648);
  const pane = element({ parentElement: root, scrollWidth: 700, style: { overflowX: 'auto' } });
  fire(field(pane), { shiftKey: true, deltaY: 55 });
  assert.equal(pane.scrollLeft, 55);
  assert.equal(root.scrollTop, 648);
  pane.style.direction = 'rtl'; pane.scrollLeft = 0;
  fire(field(pane), { deltaX: -35, deltaY: 0 });
  assert.equal(pane.scrollLeft, -35);
});

test('ordinary fields, browser zoom, handled or uncancelable events retain native behavior', () => {
  const { root, field, fire } = setup();
  for (const [inputOptions, eventOptions] of [
    [{ type: 'text' }, {}], [{ type: 'range' }, {}], [{ readOnly: true }, {}], [{ disabled: true }, {}],
    [{}, { ctrlKey: true }], [{}, { cancelable: false }],
  ]) {
    assert.equal(fire(field(root, inputOptions), eventOptions).defaultPrevented, false);
    assert.equal(root.scrollTop, 0);
  }
  fire(field(), { defaultPrevented: true, preventDefault: () => assert.fail('already handled') });
  assert.equal(root.scrollTop, 0);
});

test('composed path supports numeric fields across an open shadow root', () => {
  const { root, field, fire } = setup();
  const host = element({ parentElement: root });
  const input = field(null, { getRootNode: () => ({ host }) });
  assert.equal(fire(host, { composedPath: () => [input, host, root] }).defaultPrevented, true);
  assert.equal(root.scrollTop, 40);
});

test('installation is idempotent, cleanup removes the listener, and no document is harmless', () => {
  const { doc, field, fire, listeners } = setup();
  const cleanup = installNumberWheelGuard(doc);
  assert.equal(installNumberWheelGuard(doc), cleanup);
  assert.equal(listeners.size, 1);
  cleanup();
  assert.equal(listeners.size, 0);
  assert.equal(fire(field()).defaultPrevented, false);
  assert.equal(typeof installNumberWheelGuard(null), 'function');
});
