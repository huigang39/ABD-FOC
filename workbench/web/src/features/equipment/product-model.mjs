/** Product naming is independent of supported firmware targets and electrical ratings. */
export const REDUCER_TYPE_NAMES = Object.freeze({ H: '谐波', E: '行星' });
const SENSOR_VARIANTS = ['KW', 'LD', 'SMH', 'XH'];
const token = value => typeof value === 'string' ? value.trim().toUpperCase() : '';

export function formatProductModelName({ series, size, reducerType, encoder, torqueSensor }) {
  const parts = [token(series), String(size ?? '').trim(), token(reducerType), token(encoder), token(torqueSensor)];
  if (!/^[A-Z][A-Z0-9]*$/.test(parts[0]) || !/^[1-9]\d*$/.test(parts[1]) || !Object.hasOwn(REDUCER_TYPE_NAMES, parts[2]) || !parts.slice(3).every(part => /^[A-Z][A-Z0-9]*$/.test(part))) {
    throw new Error('型号需包含系列、尺寸代号、减速机类型（H / E）、编码器名称和力矩传感器名称。');
  }
  return parts.join('_');
}

export function parseProductModelName(name) {
  if (typeof name !== 'string') return null;
  const parts = name.trim().toUpperCase().split('_');
  if (parts.length !== 5) return null;
  const [series, size, reducerType, encoder, torqueSensor] = parts;
  const fields = { series, size, reducerType, encoder, torqueSensor };
  try { return { ...fields, name: formatProductModelName(fields), reducerName: REDUCER_TYPE_NAMES[reducerType] }; }
  catch { return null; }
}

export function neo75hModelName(variant = 'KW') {
  const sensor = token(variant);
  if (!SENSOR_VARIANTS.includes(sensor)) throw new Error(`未知 NEO_75_H 力矩传感器配置：${String(variant)}`);
  return formatProductModelName({ series: 'NEO', size: '75', reducerType: 'H', encoder: 'GW', torqueSensor: sensor });
}

