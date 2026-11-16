import test from 'node:test';
import assert from 'node:assert/strict';
import { renderModuleTags, renderModuleToggles } from '../web/src/shared/ui/module-tags.mjs';

const optional = { id: 'foc-observer', title: '观测器', required: false, runtimeSwitchable: true };
function controls(html) {
  return [...html.matchAll(/<input\b([^>]+)>/g)].map(([, attributes]) => ({
    action: attributes.match(/data-action="([^"]+)"/)[1],
    checked: /\schecked(?:\s|$)/.test(attributes),
    disabled: /\sdisabled(?:\s|$)/.test(attributes),
    attributes,
  }));
}

test('cards expose only enabled configuration tags, never runtime without compilation', () => {
  assert.equal(renderModuleTags(undefined), '');
  assert.equal(renderModuleTags({ enabled: false, runtimeEnabled: true }), '');
  const compiled = renderModuleTags({ enabled: true, runtimeEnabled: false });
  assert.match(compiled, />编译期<\/span>/);
  assert.doesNotMatch(compiled, />运行期<\/span>/);
  const running = renderModuleTags({ enabled: true, runtimeEnabled: true });
  assert.match(running, />编译期<\/span>/);
  assert.match(running, />运行期<\/span>/);
  assert.match(running, /不代表设备正在运行/);
  assert.doesNotMatch(running, /<input|<button|data-action/);
});

test('optional module tags keep existing actions and actual checkbox semantics', () => {
  const html = renderModuleToggles(optional, { enabled: true, runtimeEnabled: false });
  const [runtime, compile] = controls(html);
  assert.deepEqual([compile.action, compile.checked, compile.disabled], ['toggle-module', true, false]);
  assert.deepEqual([runtime.action, runtime.checked, runtime.disabled], ['toggle-runtime', false, false]);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /data-module="foc-observer"/);
  assert.match(html, /aria-label="观测器 · 运行期配置"/);
  assert.match(html, /不代表设备正在运行/);
});

test('required modules show one required tag; optional runtime needs compilation', () => {
  const core = { id: 'foc-current', title: '电流环', required: true, runtimeSwitchable: false };
  const required = renderModuleToggles(core, { enabled: true, runtimeEnabled: true });
  assert.match(required, />必需<\/span>/); assert.doesNotMatch(required, /编译|运行|<input|<button/);
  const [compile] = controls(renderModuleToggles(optional, { enabled: false, runtimeEnabled: true }));
  assert.deepEqual([compile.checked, compile.disabled], [false, false]);
  const requiredSwitchable = controls(renderModuleToggles({ ...optional, required: true }, { enabled: true, runtimeEnabled: true }));
  assert.deepEqual(requiredSwitchable, []);
});

test('module metadata is escaped and rendering leaves configuration unchanged', () => {
  const module = Object.freeze({ ...optional, id: 'observer" data-bad="yes', title: '<img onerror="bad">' });
  const instance = Object.freeze({ enabled: true, runtimeEnabled: true });
  const html = renderModuleToggles(module, instance);
  assert.ok(html.includes('data-module="observer&quot; data-bad=&quot;yes"'));
  assert.ok(html.includes('&lt;img onerror=&quot;bad&quot;&gt;'));
  assert.doesNotMatch(html, /<img|data-bad="yes"/);
  assert.equal(renderModuleToggles(null, instance), '');
});
