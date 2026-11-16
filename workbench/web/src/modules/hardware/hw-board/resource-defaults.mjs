import { RESOURCE_PRESETS, createPresetResource } from './resources.mjs';

const topologyByCount = { 1:'single_shunt', 2:'two_shunt', 3:'three_shunt' };
const countByTopology = { single_shunt:1, two_shunt:2, three_shunt:3 };
const currentRows = board => board.resources.filter(resource => resource.preset === 'phase-current' && resource.kind === 'adc');
const uniqueId = (resources, base) => {
  let id = base, suffix = 2;
  while (resources.some(resource => resource.id === id)) id = `${base}-${suffix++}`;
  return id;
};
const appendPreset = (board, preset) => {
  if (board.resources.length >= 128) return null;
  const resource = createPresetResource(preset, uniqueId(board.resources, `common-${preset}`));
  board.resources.push(resource);
  return resource;
};

// Only explicitly classified current sampling is split. Legacy raw ADC resources
// may contain voltage and current channels together, so they remain untouched.
function splitCurrentRows(board) {
  const expanded = [];
  for (const resource of board.resources) {
    if (resource.preset !== 'phase-current' || resource.kind !== 'adc') { expanded.push(resource); continue; }
    const groups = new Map();
    for (const [signal,pin] of Object.entries(resource.pins)) {
      const match = /^IN[PN](\d+)$/.exec(signal);
      if (!match || !pin || pin === 'none') continue;
      const group = groups.get(match[1]) || {};
      group[signal] = pin;
      groups.set(match[1],group);
    }
    if (groups.size <= 1) { expanded.push(resource); continue; }
    const auxiliary = Object.fromEntries(Object.entries(resource.pins).filter(([signal,pin]) => pin && pin !== 'none' && !/^IN[PN]\d+$/.test(signal)));
    const template = structuredClone(resource);
    for (const [index,pins] of [...groups.values()].entries()) {
      const channel = structuredClone(template);
      if (index) channel.id = uniqueId([...board.resources,...expanded], `${resource.id}-channel-${index+1}`);
      channel.pins = { ...pins, ...(index === 0 ? auxiliary : {}) };
      expanded.push(channel);
    }
  }
  if (expanded.length <= 128) board.resources = expanded;
}

/** Populate editable common resources without assigning hardware or pin routes. */
export function ensureCommonResources(board) {
  if (!board || typeof board !== 'object') return board;
  if (board.resources == null) board.resources = [];
  if (!Array.isArray(board.resources)) return board;
  splitCurrentRows(board);
  let count = currentRows(board).length;
  if (!count) {
    count = countByTopology[board.currentTopology] || 3;
    for (let index=0; index<count; index++) appendPreset(board,'phase-current');
    count = currentRows(board).length;
  }
  for (const preset of RESOURCE_PRESETS.filter(item => item.common && item.id !== 'phase-current')) {
    if (!board.resources.some(resource => resource.preset === preset.id)) appendPreset(board,preset.id);
  }
  // Unexpected imported groups remain intact until an explicit channel resize.
  if (topologyByCount[count] && board.currentTopology !== 'inline') board.currentTopology = topologyByCount[count];
  return board;
}

/** Explicit user resize retains the first channels and all unrelated resources. */
export function resizeCurrentChannels(board, count) {
  if (!Number.isInteger(count) || !topologyByCount[count]) throw new Error('相电流采样通道数只能为 1、2 或 3。');
  ensureCommonResources(board);
  const channels = currentRows(board);
  if (board.resources.length + count - channels.length > 128) throw new Error('外设资源已达上限，无法增加相电流采样通道。');
  const removeIds = new Set(channels.slice(count).map(resource => resource.id));
  board.resources = board.resources.filter(resource => !removeIds.has(resource.id));
  for (let index=channels.length; index<count; index++) appendPreset(board,'phase-current');
  board.currentTopology = topologyByCount[count];
  return board;
}
