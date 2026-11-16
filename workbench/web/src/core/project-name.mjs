const unnamed = new Set(['', '未命名', '未命名工程', '未命名配置', '未命名驱动方案']);
const sequences = new Map();
const pad = value => String(value).padStart(2, '0');

/** Display names follow the user's local calendar, not the UTC storage timestamp. */
export function formatProjectTimestamp(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('工程命名时间无效。');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export const isUnnamedProjectName = name => typeof name === 'string' && unnamed.has(name.trim());

/** Only exact legacy placeholders and blank names are replaced; user names are preserved. */
export function normalizeProjectName(name, { date = new Date(), existingNames = [] } = {}) {
  if (!isUnnamedProjectName(name)) return name;
  const stamp = formatProjectTimestamp(date), occupied = new Set(existingNames);
  let sequence = sequences.get(stamp) || 0, candidate;
  do { sequence++; candidate = sequence === 1 ? stamp : `${stamp}_${sequence}`; } while (occupied.has(candidate));
  sequences.set(stamp, sequence);
  return candidate;
}
