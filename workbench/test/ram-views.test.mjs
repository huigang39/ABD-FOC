import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRam } from '../web/src/features/deployment/ram-view.mjs';
import { ramAction, ramEdit } from '../web/src/features/deployment/ram.mjs';

function fixture() {
  return {
    target: { mcu: 'STM32H745IIK6', board: 'PCB-A' },
    memory: {
      layout: { banks: [{ id: 'flash-a', name: '固件 Flash' }] },
      ram: {
        mcu: 'STM32H745IIK6',
        banks: [{ id: 'ram-a', name: '快速 RAM <A>', baseAddress: 0x24000000, sizeKiB: 64, cores: ['cm7', 'cm4'], executable: true, dma: false }],
        placements: [{ id: 'current-code', name: '电流环代码', kind: 'code', coreId: 'cm7', bankId: 'ram-a', offsetKiB: 4, sizeKiB: 16, loadBankId: 'flash-a' }],
      },
    },
  };
}

const controls = html => [...html.matchAll(/<select\b[^]*?<\/select>/g)].map(match => match[0]);
const control = (html, id, key) => controls(html).find(markup => markup.includes(`data-id="${id}"`) && markup.includes(`data-key="${key}"`));
const button = (html, action) => [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(markup => markup.includes(`data-action="${action}"`));

test('runtime memory renders planned capacity, editable capabilities and actual core access', () => {
  const project = fixture();
  const original = structuredClone(project);
  const html = renderRam(project);
  assert.match(html, /<h2 id="ram-heading">RAM<\/h2>/);
  assert.match(html, /已规划 16 KiB/);
  assert.match(html, /aria-valuenow="25"/);
  assert.match(html, /0x24000000 – 0x2400FFFF/);
  assert.match(html, /0x24001000 – 0x24004FFF/);
  assert.match(html, /快速 RAM &lt;A&gt;/);
  assert.match(html, /<table[^>]*ram-bank-table/);
  for (const key of ['executable', 'dma']) {
    assert.match(html, new RegExp(`<input type="checkbox"[^>]*data-edit="ram-bank"[^>]*data-key="${key}"`));
  }
  for (const coreId of ['cm7', 'cm4']) {
    assert.match(html, new RegExp(`<input type="checkbox"[^>]*data-key="cores"[^>]*data-child="${coreId}"[^>]*checked`));
  }
  assert.ok(button(html, 'ram-reset'));
  assert.match(html, /自定义分配尚未映射到链接脚本/);
  assert.match(html, /未分配的容量不代表固件实际空闲空间/);
  assert.deepEqual(project, original);
});

test('uses have actual choices and only code or data offer Flash loading sources', () => {
  const project = fixture();
  const base = project.memory.ram.placements[0];
  project.memory.ram.placements = ['code', 'data', 'stack', 'heap', 'shared', 'dma'].map(kind => ({ ...base, id: kind, kind, loadBankId: kind === 'code' ? 'flash-a' : '' }));
  const html = renderRam(project);
  for (const kind of ['code', 'data', 'stack', 'heap', 'shared', 'dma']) {
    const uses = control(html, kind, 'kind');
    for (const choice of ['code', 'data', 'stack', 'heap', 'shared', 'dma']) assert.ok(uses.includes(`value="${choice}"`));
    assert.ok(control(html, kind, 'bankId').includes('value="ram-a"'));
    assert.ok(control(html, kind, 'coreId').includes('value="cm7"'));
    assert.equal(Boolean(control(html, kind, 'loadBankId')), kind === 'code' || kind === 'data');
  }
  assert.match(control(html, 'data', 'loadBankId'), /value="flash-a"[^>]*>固件 Flash<\/option>/);
  assert.ok(button(html, 'ram-clear-load-source'));
  assert.match(html, /零初始化数据可不指定加载源/);
  assert.match(html, /加载地址是镜像在 Flash 中的存储位置，运行地址是启动后在 RAM 中的位置/);
  for (const markup of controls(html)) {
    assert.doesNotMatch(markup, />选择 Flash<\/option>|>待确认<\/option>|>未确认<\/option>/);
    for (const option of markup.matchAll(/<option\b([^>]*)>[^]*?<\/option>/g)) {
      if (/value="(?:|unselected|unconfirmed)"/.test(option[1])) {
        assert.match(option[1], /\bhidden\b/);
        assert.match(option[1], /\bdisabled\b/);
      }
    }
  }
});

test('verified MCU preset is available only for empty matching plans and does not allocate automatically', () => {
  const project = fixture();
  delete project.memory.ram;
  const before = structuredClone(project);
  const html = renderRam(project);
  assert.ok(button(html, 'ram-preset'));
  assert.match(html, /预设不会自动占用任何区域/);
  assert.equal(button(html, 'ram-reset'), undefined);
  assert.match(button(html, 'ram-add-placement'), /\bdisabled\b/);
  assert.deepEqual(project, before);
  assert.equal(button(renderRam(fixture()), 'ram-preset'), undefined);
  project.target.mcu = 'CustomMCU';
  assert.equal(button(renderRam(project), 'ram-preset'), undefined);
  assert.doesNotMatch(button(renderRam(project), 'ram-add-bank'), /\bdisabled\b/);
  project.target.mcu = '';
  assert.match(button(renderRam(project), 'ram-add-bank'), /\bdisabled\b/);
});

test('unknown capacities and unfinished allocations remain editable without invented usage', () => {
  const project = fixture();
  project.target.mcu = 'CustomMCU';
  project.memory.ram.mcu = 'CustomMCU';
  const bank = project.memory.ram.banks[0];
  bank.sizeKiB = null;
  bank.baseAddress = null;
  bank.cores = [];
  project.memory.ram.placements[0] = { ...project.memory.ram.placements[0], bankId: '', offsetKiB: null, sizeKiB: null, coreId: '', loadBankId: '' };
  const html = renderRam(project);
  assert.match(html, /ram-capacity-unknown/);
  assert.doesNotMatch(html, /aria-valuenow=/);
  assert.match(html, /内核列表随 MCU 型号确定/);
  assert.match(html, /data-state-key="ram-geometry" open/);
  assert.match(html, /data-state-key="ram-placement-current-code" open/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});

test('budget overflow stays bounded visually while retaining its true planned total', () => {
  const project = fixture();
  project.memory.ram.placements[0].sizeKiB = 96;
  const html = renderRam(project);
  assert.match(html, /已规划 96 KiB/);
  assert.match(html, /aria-valuenow="100"/);
  assert.match(html, /style="width:100%"/);
  assert.doesNotMatch(html, /实际剩余|已使用/);
});

test('validation feedback is collected into the shared issue button and bindings can be confirmed', () => {
  const project = fixture();
  project.memory.ram.mcu = 'STM32G474';
  const html = renderRam(project, [
    { id: 'ram-overlap', level: 'error', title: '地址交叠严重', message: '不可行内显示的具体错误', designPage: 'memory' },
    { id: 'memory-overlap', level: 'error', title: 'Flash overlap', designPage: 'memory' },
  ]);
  assert.match(html, /data-action="show-issues"/);
  assert.match(html, /data-issue-ids="\[&quot;ram-overlap&quot;\]"/);
  assert.doesNotMatch(html, /地址交叠严重|不可行内显示的具体错误|memory-overlap/);
  assert.ok(button(html, 'ram-rebind'));
  assert.match(html, /区域表依据：STM32G474 · 当前 MCU：STM32H745IIK6/);
});

test('switching loaded code or data to another use keeps its source visible and removable', () => {
  for (const initialKind of ['code', 'data']) {
    const project = fixture();
    project.memory.ram.placements[0].kind = initialKind;
    for (const kind of ['stack', 'heap', 'shared', 'dma']) {
      const changed = ramEdit(project, 'ram-placement', { id: 'current-code', key: 'kind' }, kind);
      assert.equal(changed.memory.ram.placements[0].loadBankId, 'flash-a');
      const html = renderRam(changed);
      assert.match(html, /保留的 Flash 加载源/);
      assert.match(html, /<output class="ram-source-value">固件 Flash<\/output>/);
      assert.match(button(html, 'ram-clear-load-source'), /data-id="current-code"/);
      assert.equal(control(html, 'current-code', 'loadBankId'), undefined);
      const cleared = ramAction(changed, 'ram-clear-load-source', { id: 'current-code' });
      assert.equal(cleared.memory.ram.placements[0].loadBankId, '');
      assert.equal(button(renderRam(cleared), 'ram-clear-load-source'), undefined);
    }
  }
});

test('placement titles expose independent live targets when names change', () => {
  const project = fixture();
  project.memory.ram.placements.push({ ...project.memory.ram.placements[0], id: 'other-code', name: '另一项分配' });
  const target = html => [...html.matchAll(/<strong data-live="(ram-placement-title-[^"]+)">([^]*?)<\/strong>/g)].map(([, key, title]) => [key, title]);
  assert.deepEqual(target(renderRam(project)), [['ram-placement-title-current-code', '电流环代码'], ['ram-placement-title-other-code', '另一项分配']]);
  const changed = ramEdit(project, 'ram-placement', { id: 'current-code', key: 'name' }, '新名称 <实时>');
  assert.deepEqual(target(renderRam(changed)), [['ram-placement-title-current-code', '新名称 &lt;实时&gt;'], ['ram-placement-title-other-code', '另一项分配']]);
});
