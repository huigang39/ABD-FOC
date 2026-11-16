// Factors describe physical quantities only; stored field units remain unchanged.
const groups = [
  [['ns', 1e-9], ['μs', 1e-6, ['us', 'µs']], ['ms', 1e-3], ['s', 1]],
  [['Hz', 1], ['kHz', 1e3], ['MHz', 1e6]],
  [['mA', 1e-3], ['A', 1]],
  [['mV', 1e-3], ['V', 1]],
  [['mΩ', 1e-3, ['mOhm']], ['Ω', 1, ['Ohm']]],
  [['μH', 1e-6, ['uH', 'µH']], ['mH', 1e-3], ['H', 1]],
  [['byte', 1, ['B']], ['KiB', 1024], ['MiB', 1048576]],
  [['rad', 1], ['°', Math.PI / 180, ['deg']], ['arcmin', Math.PI / 10800]],
  [['rad/s', 1], ['rpm', Math.PI / 30, ['RPM']]],
  [['N·mm', 1e-3], ['N·m', 1]],
  [['μWb', 1e-6], ['mWb', 1e-3], ['Wb', 1]],
  [['bit/s', 1], ['kbit/s', 1e3], ['Mbit/s', 1e6]],
  [['°C', 1], ['°F', 1], ['K', 1]],
  [['mA/rad', 1e-3], ['A/rad', 1]],
  [['mA/(rad/s)', 1e-3], ['A/(rad/s)', 1]],
  [['mV/A', 1e-3], ['V/A', 1]],
  [['mV/(A·s)', 1e-3], ['V/(A·s)', 1]],
  [['N·mm/(rad/s)', 1e-3], ['N·m/(rad/s)', 1]],
  [['N·mm/s', 1e-3], ['N·m/s', 1]],
  [['N·mm/原始单位', 1e-3], ['N·m/原始单位', 1]],
  [['N·mm/A', 1e-3], ['N·m/A', 1]],
  [['rad/s²', 1], ['°/s²', Math.PI / 180], ['rpm/s', Math.PI / 30]],
];
const catalog = new Map();
for (const [group, entries] of groups.entries()) for (const [symbol, factor, aliases = []] of entries) {
  const unit = Object.freeze({ symbol, factor, group });
  for (const alias of [symbol, ...aliases]) catalog.set(alias, unit);
}
export const normalizeUnit = symbol => catalog.get(String(symbol ?? '').trim())?.symbol || '';
export function compatibleUnits(symbol) {
  const unit = catalog.get(String(symbol ?? '').trim());
  return unit ? groups[unit.group].map(([label]) => label) : [];
}
export function convertUnit(value, from, to) {
  if (value === null) return null;
  const source = catalog.get(String(from).trim()), target = catalog.get(String(to).trim());
  if (!source || !target || source.group !== target.group || !Number.isFinite(value)) return NaN;
  if (source.symbol === target.symbol) return value;
  if (['°C', '°F', 'K'].includes(source.symbol)) {
    const celsius=source.symbol==='°F'?(value-32)*(5/9):source.symbol==='K'?value-273.15:value;
    return target.symbol==='°F'?celsius*(9/5)+32:target.symbol==='K'?celsius+273.15:celsius;
  }
  if (value === 0) return value;
  const ratio = source.factor / target.factor;
  const exponent = Math.round(Math.log10(ratio));
  // Decimal prefixes must not turn an integer μs/Hz value into a fractional float.
  if (Math.abs(ratio / 10 ** exponent - 1) < 1e-14) {
    const [digits, power = '0'] = String(value).toLowerCase().split('e');
    return Number(`${digits}e${Number(power) + exponent}`);
  }
  return value * ratio;
}
export function defaultDisplayUnit(base, value, label = '') {
  const unit = normalizeUnit(base);
  if (unit === 'Hz' && (value >= 1e6 || /主频|时钟|clock/i.test(label))) return 'MHz';
  return unit;
}
