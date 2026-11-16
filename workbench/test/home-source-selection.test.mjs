import test from 'node:test';
import assert from 'node:assert/strict';
import { installHomeSourceSelection, homeRouteForEvent } from '../web/src/features/architecture/interactions.mjs';

function fixture(initial = 'can') {
  const handlers = new Map(), changes = [];
  let source = initial, radios;
  const root = {
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: (type, fn) => { if (handlers.get(type) === fn) handlers.delete(type); },
  };
  const surface = { querySelectorAll: () => radios };
  const remount = () => {
    radios = ['can', 'ethercat', 'ethernet', 'jlink'].map(value => ({
      value, checked: value === source, disabled: false,
      matches: () => true, closest: () => surface,
    }));
  };
  const dispose = installHomeSourceSelection(root, { getSource: () => source, onChange: value => { source = value; changes.push(value); } });
  const card = kind => ({
    dataset: { homeSource: kind, homeRoute: kind === 'host' ? '#/project/protocol' : '#/debug' },
    closest: () => surface, contains: () => true,
  });
  const click = (kind, extra = {}, control = null) => {
    const node = card(kind);
    handlers.get('click')({ type: 'click', button: 0, target: { closest: selector => selector === '[data-home-source]' ? node : control }, ...extra });
  };
  const chooseRadio = value => {
    for (const radio of radios) radio.checked = radio.value === value;
    handlers.get('change')({ target: radios.find(radio => radio.value === value) });
  };
  remount();
  return { handlers, changes, click, chooseRadio, remount, dispose, card, get source() { return source; }, checked: () => radios.filter(radio => radio.checked).map(radio => radio.value) };
}

test('single-clicking a source card changes the native selection without opening its editor', () => {
  const f = fixture();
  f.click('debug');
  assert.equal(f.source, 'jlink'); assert.deepEqual(f.checked(), ['jlink']);
  f.click('host');
  assert.equal(f.source, 'can'); assert.deepEqual(f.checked(), ['can']);
  assert.equal(homeRouteForEvent({ type: 'click' }), '');
  const card = f.card('debug');
  assert.equal(homeRouteForEvent({ type: 'dblclick', target: { closest: selector => selector === '[data-home-route]' ? card : null } }), '#/debug');
});

test('native radio changes persist across rerenders and restore the last host transport', () => {
  const f = fixture();
  f.chooseRadio('ethercat');
  f.click('debug'); f.remount();
  assert.deepEqual(f.checked(), ['jlink']);
  f.click('host');
  assert.equal(f.source, 'ethercat'); assert.deepEqual(f.checked(), ['ethercat']);
  f.chooseRadio('ethernet'); f.chooseRadio('jlink'); f.remount(); f.click('host');
  assert.equal(f.source, 'ethernet'); assert.deepEqual(f.checked(), ['ethernet']);
  f.click('host');
  assert.deepEqual(f.changes, ['ethercat', 'jlink', 'ethercat', 'ethernet', 'jlink', 'ethernet']);
});

test('modified clicks and embedded controls keep ownership of their interactions', () => {
  const f = fixture('ethercat');
  for (const extra of [{ctrlKey:true}, {metaKey:true}, {shiftKey:true}, {altKey:true}, {button:2}, {defaultPrevented:true}]) f.click('debug', extra);
  f.click('debug', {}, { tagName: 'BUTTON' });
  assert.equal(f.source, 'ethercat'); assert.deepEqual(f.checked(), ['ethercat']);
  assert.deepEqual(f.changes, []);
});

test('source selection cleanup removes both event listeners', () => {
  const f = fixture();
  assert.deepEqual([...f.handlers.keys()], ['click', 'change']);
  f.dispose(); assert.equal(f.handlers.size, 0);
});
