import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLogScroll, restoreLogScroll } from '../web/src/shared/scroll/log-scroll.mjs';

function log(key, values = {}) {
  return {
    dataset: { logKey: key }, clientHeight: 100, clientWidth: 200,
    scrollHeight: 1000, scrollWidth: 600, scrollTop: 0, scrollLeft: 0,
    getClientRects: () => [{}],
    ...values,
  };
}
function root(...nodes) {
  return { querySelectorAll(selector) { assert.equal(selector, '[data-log-key]'); return nodes; } };
}
const following = (key, values = {}) => log(key, { ...values, dataset: { logKey: key, logFollow: 'end' } });

test('a reader above the end keeps vertical and horizontal positions after replacement', () => {
  const previous = following('build:one', { scrollTop: 230.5, scrollLeft: 70 });
  const snapshot = captureLogScroll(root(previous));
  const replacement = following('build:one', { scrollHeight: 1500 });
  restoreLogScroll(root(replacement), snapshot);
  assert.equal(replacement.scrollTop, 230.5);
  assert.equal(replacement.scrollLeft, 70);
  assert.equal(previous.scrollTop, 230.5);
});

test('build and flash logs follow the end only within the four-pixel tolerance', () => {
  for (const distance of [0, 3.5, 4, 4.5, 5]) {
    const before = following('flash:one', { scrollTop: 900 - distance });
    const after = following('flash:one', { scrollHeight: 1400 });
    restoreLogScroll(root(after), captureLogScroll(root(before)));
    assert.equal(after.scrollTop, distance <= 4 ? 1300 : 900 - distance);
  }
});

test('a log that previously fit in its viewport follows newly overflowing output', () => {
  const before = following('build:one', { scrollHeight: 60 });
  const after = following('build:one', { scrollHeight: 600 });
  restoreLogScroll(root(after), captureLogScroll(root(before)));
  assert.equal(after.scrollTop, 500);
});

test('new identities start at the end for output and at the top for source files', () => {
  const snapshot = captureLogScroll(root(
    following('build:old', { scrollTop: 250, scrollLeft: 100 }),
    log('source:job:file-a', { scrollTop: 350, scrollLeft: 120 }),
  ));
  const build = following('build:new');
  const flash = following('flash:new');
  const source = log('source:job:file-b', { scrollTop: 77, scrollLeft: 88 });
  restoreLogScroll(root(build, flash, source), snapshot);
  assert.equal(build.scrollTop, 900);
  assert.equal(flash.scrollTop, 900);
  assert.equal(build.scrollLeft, 0);
  assert.equal(source.scrollTop, 0);
  assert.equal(source.scrollLeft, 0);
});

test('source files never follow new content even when their previous position was at the end', () => {
  const before = log('source:job:file-a', { scrollTop: 900, scrollLeft: 100 });
  const after = log('source:job:file-a', { scrollHeight: 1600 });
  restoreLogScroll(root(after), captureLogScroll(root(before)));
  assert.equal(after.scrollTop, 900);
  assert.equal(after.scrollLeft, 100);
});

test('shortened content clamps both axes to the new scroll range', () => {
  const before = following('build:one', { scrollTop: 450, scrollLeft: 200 });
  const after = following('build:one', { scrollHeight: 300, scrollWidth: 250 });
  restoreLogScroll(root(after), captureLogScroll(root(before)));
  assert.equal(after.scrollTop, 200);
  assert.equal(after.scrollLeft, 50);
  const fits = following('build:one', { scrollHeight: 80, scrollWidth: 100 });
  restoreLogScroll(root(fits), captureLogScroll(root(before)));
  assert.equal(fits.scrollTop, 0);
  assert.equal(fits.scrollLeft, 0);
});

test('hidden and zero-sized logs neither create snapshots nor receive scroll changes', () => {
  const hidden = [
    following('hidden-attribute', { hidden: true }),
    following('closed-details', { getClientRects: () => [] }),
    following('zero-height', { clientHeight: 0 }),
    following('zero-width', { clientWidth: 0 }),
    following('visibility-hidden', { ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: 'hidden' }) } } }),
  ];
  assert.equal(captureLogScroll(root(...hidden)).size, 0);
  for (const node of hidden) { node.scrollTop = 41; node.scrollLeft = 9; }
  restoreLogScroll(root(...hidden));
  for (const node of hidden) {
    assert.equal(node.scrollTop, 41);
    assert.equal(node.scrollLeft, 9);
  }
  const emptyKey = following('', { scrollTop: 20 });
  assert.equal(captureLogScroll(root(emptyKey)).size, 0);
});

test('snapshots are independent values and empty roots are harmless', () => {
  const node = following('build:one', { scrollTop: 120 });
  const snapshot = captureLogScroll(root(node));
  node.scrollTop = 900;
  assert.deepEqual(snapshot.get('build:one'), { top: 120, left: 0, atEnd: false });
  assert.equal(captureLogScroll(null).size, 0);
  assert.doesNotThrow(() => restoreLogScroll(null));
});
