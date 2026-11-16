import { sensorResources } from '../hw-board/resources.mjs';
import { driverResourceOccupants } from './resource-usage.mjs';

/** User-defined device metadata and peripheral bindings; no implied wire protocol. */
export const CUSTOM_DRIVER_INTERFACES = Object.freeze([
  ['adc', 'ADC'], ['spi', 'SPI'], ['i2c', 'I²C'], ['uart', 'UART'], ['rs485', 'RS-485'],
  ['abz', 'ABZ'], ['ssi', 'SSI'], ['biss', 'BiSS-C'], ['can', 'CAN'], ['custom', '自定义接口'],
].map(Object.freeze));
const keys = ['id', 'name', 'model', 'interface', 'resource', 'enabled', 'bitrate'];
const interfaceValues = new Set(['unselected', ...CUSTOM_DRIVER_INTERFACES.map(([value]) => value)]);

export function createCustomDriver(id = globalThis.crypto?.randomUUID?.() || `driver-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, type = 'uart') {
  if (!interfaceValues.has(type)) throw new Error('其他驱动的通信方式不是允许的选项。');
  return { id, name: '', model: '', interface: type, resource: '', enabled: true, bitrate: null };
}

export function checkCustomDriverShape(drivers) {
  if (!Array.isArray(drivers) || drivers.length > 64) throw new Error('其他驱动必须是不超过 64 项的数组。');
  const ids = new Set();
  for (const driver of drivers) {
    if (!driver || typeof driver !== 'object' || Array.isArray(driver)) throw new Error('其他驱动必须是对象。');
    for (const key of Object.keys(driver)) if (!keys.includes(key)) throw new Error(`其他驱动含未知字段：${key}`);
    for (const key of keys) if (key !== 'bitrate' && !Object.hasOwn(driver, key)) throw new Error(`其他驱动缺少字段：${key}`);
    for (const key of ['id', 'name', 'model', 'interface', 'resource']) if (typeof driver[key] !== 'string' || driver[key].length > 160) throw new Error(`其他驱动的 ${key} 必须是不超过 160 字的文本。`);
    if (!driver.id.trim() || ids.has(driver.id)) throw new Error('其他驱动的 ID 必须非空且唯一。');
    ids.add(driver.id);
    if (!interfaceValues.has(driver.interface)) throw new Error('其他驱动的通信方式不是允许的选项。');
    if (driver.bitrate != null && (typeof driver.bitrate !== 'number' || !Number.isFinite(driver.bitrate))) throw new Error('其他驱动的速率必须是有限数字或 null。');
    if (typeof driver.enabled !== 'boolean') throw new Error('其他驱动的启用状态必须是布尔值。');
  }
}

export function customDriverResources(resources = [], type = 'unselected') {
  return type === 'custom' ? resources.filter(resource => resource.instance) : sensorResources(resources, type);
}

export const customDriverRateKey = type => ['uart', 'rs485', 'can'].includes(type) ? 'bitrate' : ['spi', 'i2c', 'ssi', 'biss'].includes(type) ? 'clockHz' : '';

/** Bind only an unambiguous compatible interface. Rate writes require explicit user intent. */
export function syncCustomDriverResource(driver, resources = [], { writeRate = false, parameters } = {}) {
  const candidates = customDriverResources(resources, driver.interface);
  const existing = candidates.find(resource => resource.id === driver.resource);
  const available = parameters ? candidates.filter(resource => !driverResourceOccupants(parameters, resources, resource.id, { customId: driver.id }).length) : candidates;
  const resource = existing || (available.length === 1 ? available[0] : null);
  driver.resource = resource?.id || '';
  const key = customDriverRateKey(driver.interface);
  if (writeRate && resource && key && Object.hasOwn(resource.settings || {}, key) && (driver.bitrate === null || Number.isFinite(driver.bitrate) && driver.bitrate > 0)) resource.settings[key] = driver.bitrate;
  return resource;
}

/** Bind exactly the chosen existing port; never infer or create another resource. */
export function bindCustomDriverResource(driver, resourceId, resources = [], parameters) {
  const resource = customDriverResources(resources, driver.interface).find(resource => resource.id === resourceId);
  if (!resource) throw new Error('请选择已配置且与此驱动兼容的外设。');
  if (parameters && driverResourceOccupants(parameters, resources, resource.id, { customId: driver.id }).length) throw new Error('此外设已被其他驱动占用，请选择独立外设。');
  const key = customDriverRateKey(driver.interface), rate = key ? resource.settings?.[key] : null;
  driver.resource = resource.id;
  driver.bitrate = rate ?? null;
  return resource;
}

/** Keep explicitly bound drivers consistent with their existing peripheral rate. */
export function syncCustomDriverRates(parameters, resources = []) {
  for (const driver of parameters.customDrivers || []) {
    const resource = customDriverResources(resources, driver.interface).find(resource => resource.id === driver.resource);
    const key = customDriverRateKey(driver.interface);
    if (resource && key && Object.hasOwn(resource.settings || {}, key)) driver.bitrate = resource.settings[key];
  }
  return parameters;
}

export function customDriverIssues(parameters, resources = []) {
  const drivers = parameters?.customDrivers ?? [], issues = [];
  const issue = (id, level, title, message, itemId) => issues.push({ id: `custom-driver-${id}`, level, title, message, moduleId: 'hw-drivers', paramKey: 'customDrivers', ...(itemId ? { itemId } : {}) });
  try { checkCustomDriverShape(drivers); }
  catch (error) { issue('format', 'error', '其他驱动格式无效', error.message); return issues; }
  for (const driver of drivers) {
    if (!driver.enabled) continue;
    const name = driver.model.trim() || driver.name.trim() || '其他驱动';
    if (!driver.model.trim()) issue(`${driver.id}-model`, 'pending', `${name} · 型号待填写`, '填写器件型号。', driver.id);
    if (driver.interface === 'unselected') issue(`${driver.id}-interface`, 'pending', `${name} · 通信方式待确定`, '通过添加菜单选择串口或 SPI 驱动。', driver.id);
    const candidates = customDriverResources(resources, driver.interface);
    const available = candidates.filter(resource => !driverResourceOccupants(parameters, resources, resource.id, { customId: driver.id }).length);
    const resource = candidates.find(resource => resource.id === driver.resource) || (available.length === 1 ? available[0] : null);
    if (!resource) issue(`${driver.id}-resource`, 'pending', `${name} · 外设接口待确定`, candidates.length && !available.length ? '兼容外设已被其他驱动占用，请配置或选择独立外设。' : available.length > 1 ? '存在多个匹配接口；尚不能自动确定器件接入的外设。' : '在外设中配置对应接口后再关联此驱动。', driver.id);
    if (customDriverRateKey(driver.interface)) {
      if (driver.bitrate == null) issue(`${driver.id}-bitrate`, 'pending', `${name} · 外设速率待配置`, '在外设页配置波特率或时钟频率。', driver.id);
      else if (driver.bitrate <= 0) issue(`${driver.id}-bitrate`, 'error', `${name} · 外设速率无效`, '在外设页将波特率或时钟频率配置为正数。', driver.id);
    }
    issue(`${driver.id}-adapter`, 'pending', `${name} · 驱动实现待接入`, '当前保存器件信息与外设绑定；通信协议、数据解析和固件调用尚未接入。', driver.id);
  }
  return issues;
}
