import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceSelectMenus, listSelectOptions, placeSelectPop, mcuCoreTags } from '../web/src/shared/ui/select-menu.mjs';

const option = (value, label = value, extra = {}) => ({ tagName: 'OPTION', value, textContent: label, disabled: false, hidden: false, ...extra });

test('扁平与分组选项统一展平，隐藏占位与禁用项按原样标记', () => {
  const select = { children: [
    option('', '—', { hidden: true, disabled: true }),
    option('STM32H7', 'STM32H7'),
    { tagName: 'OPTGROUP', label: '编码器', children: [option('MC_ENCODER_GW_OUTER', 'GW Outer'), option('BAD', 'BAD · 待适配', { disabled: true })] },
  ] };
  assert.deepEqual(listSelectOptions(select), [
    { group: '', options: [{ value: '', label: '—', disabled: true, hidden: true }] },
    { group: '', options: [{ value: 'STM32H7', label: 'STM32H7', disabled: false, hidden: false }] },
    { group: '编码器', options: [
      { value: 'MC_ENCODER_GW_OUTER', label: 'GW Outer', disabled: false, hidden: false },
      { value: 'BAD', label: 'BAD · 待适配', disabled: true, hidden: false },
    ] },
  ]);
  assert.deepEqual(listSelectOptions({ children: [] }), []);
});

test('弹层定位：空间足够朝下展开，底部不足向上翻折，左右夹在视口内', () => {
  const viewport = { width: 800, height: 600 };
  const popRect = { width: 200, height: 100 };
  const down = placeSelectPop({ left: 40, top: 100, bottom: 140, width: 180 }, popRect, viewport);
  assert.deepEqual(down, { top: 146, left: 40, openUp: false });
  const cramped = placeSelectPop({ left: 40, top: 560, bottom: 590, width: 180 }, popRect, viewport);
  assert.equal(cramped.openUp, true);
  assert.equal(cramped.top, 560 - 100 - 6);
  const right = placeSelectPop({ left: 900, top: 40, bottom: 80, width: 180 }, { width: 300, height: 100 }, viewport);
  assert.equal(right.left, 800 - 300 - 8);
  assert.equal(right.openUp, false);
  assert.equal(placeSelectPop({ left: 4, top: 40, bottom: 80, width: 100 }, { width: 300, height: 100 }, viewport).left, 8);
  const high = placeSelectPop({ left: 40, top: 50, bottom: 55, width: 180 }, popRect, { width: 800, height: 60 });
  assert.equal(high.openUp, true);
  assert.equal(high.top, 8);
});

test('增强入口对空根、无匹配选择器与已增强项安全返回', () => {
  assert.equal(enhanceSelectMenus(null), 0);
  assert.equal(enhanceSelectMenus({ querySelectorAll: () => [] }), 0);
  const enhanced = { closest: () => ({}) };
  assert.equal(enhanceSelectMenus({ querySelectorAll: () => [enhanced] }), 0);
});

test('MCU 核心标签按核心逐枚输出架构全称：双核两枚、单核一枚、未收录与空值为空', () => {
  assert.deepEqual(mcuCoreTags('STM32H745'), ['Arm Cortex-M7', 'Arm Cortex-M4']);
  assert.deepEqual(mcuCoreTags('STM32H745IIK6'), ['Arm Cortex-M7', 'Arm Cortex-M4']);
  assert.deepEqual(mcuCoreTags('STM32G474RE'), ['Arm Cortex-M4']);
  assert.deepEqual(mcuCoreTags('HPM5361'), ['RISC-V']);
  assert.deepEqual(mcuCoreTags(''), []);
  assert.deepEqual(mcuCoreTags('STM32F103C8'), []);
});
