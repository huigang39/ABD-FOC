/** Maintained routes, not an inferred full chip pinout. NEO routes are from
 * neofsa/NeoFsa.ioc and hardware_boot_config.h (STM32H745IIK6 / UFBGA176).
 * Datasheet: https://www.st.com/resource/en/datasheet/stm32h745ii.pdf
 * New parts require their own package/pinmux metadata and generator adapter.
 */
import { resourceSettingOptions } from '../hw-platform/options.mjs';
import { H745_KINDS, H745_RESOURCES } from './h745-pin-data.mjs';
export const RESOURCE_KINDS = H745_KINDS;
const h745 = H745_RESOURCES;
const kindSettings = {
  pwm: [ ['mode','工作模式','select',[['pwm','PWM 发波']]], ['alignment','对齐方式','select',[['center','中心对齐'],['edge','边沿对齐']]], ['polarity','输出有效电平','select',[['high','高有效'],['low','低有效']]] ],
  adc: [ ['sampleCycles','采样时间','number','周期'], ['trigger','触发来源','text',''] ],
  uart: [ ['bitrate','波特率','number','bit/s'], ['physical','电气接口','select',[['ttl','UART 电平'],['rs485','RS-485'],['rs422','RS-422']]], ['parity','校验','select',[['none','无'],['even','偶校验'],['odd','奇校验']]], ['stopBits','停止位','select',[['1','1'],['2','2']]] ],
  spi: [ ['clockHz','通信时钟','number','Hz'], ['mode','SPI 模式','select',[['0','Mode 0'],['1','Mode 1'],['2','Mode 2'],['3','Mode 3']]], ['wordBits','字长','integer','bit'] ],
  i2c: [ ['clockHz','总线时钟','number','Hz'] ],
  gpio: [ ['direction','方向','select',[['input','输入'],['output','输出']]], ['pull','上下拉','select',[['none','无'],['up','上拉'],['down','下拉']]], ['initialLevel','输出初始电平','select',[['low','低'],['high','高']]] ],
  timer: [ ['mode','工作模式','select',[['base','定时'],['pwm','PWM 发波'],['capture','输入捕获'],['encoder','编码器']]], ['clockHz','计数时钟','number','Hz'], ['periodUs','计时周期','number','μs'] ],
  lptim: [ ['clockHz','计数时钟','number','Hz'], ['periodUs','计时周期','number','μs'] ],
  comparator: [ ['thresholdMv','比较阈值','number','mV'] ],
};
export const resourceFields = kind => kindSettings[kind] || [];
export const getMcuResources = mcu => mcu === 'STM32H745IIK6' ? structuredClone(h745) : [];
export const resourceRoute = (mcu, resource) => getMcuResources(mcu).find(route => route.kind === resource.kind && route.instance === resource.instance);
export function createResource(kind = 'uart', id = globalThis.crypto?.randomUUID?.() || `resource-${Date.now()}`) {
  if (!RESOURCE_KINDS.some(([value]) => value === kind)) throw new Error('外设类型无效。');
  return { id, name:'', kind, instance:'', pins:{}, settings:Object.fromEntries(resourceFields(kind).map(([key,,type]) => [key, ['number','integer'].includes(type) ? null : ''])) };
}
export function selectResourceInstance(resource, mcu, instance) {
  const route = getMcuResources(mcu).find(item => item.kind === resource.kind && item.instance === instance);
  if (!route) throw new Error('当前 MCU 尚未维护此外设的引脚映射。');
  resource.instance = instance;
  resource.pins = Object.fromEntries(Object.keys(route.pins).map(signal => [signal, '']));
}
export function checkResourceShape(resources) {
  if (!Array.isArray(resources) || resources.length > 128) throw new Error('外设资源必须为不超过 128 项的数组。');
  const ids = new Set();
  for (const r of resources) {
    if (!r || typeof r !== 'object' || Object.keys(r).some(key => !['id','name','kind','instance','pins','settings'].includes(key))) throw new Error('外设资源格式无效。');
    for (const key of ['id','name','kind','instance']) if (typeof r[key] !== 'string' || r[key].length > 120) throw new Error(`外设 ${key} 必须是文本。`);
    if (!r.id || ids.has(r.id)) throw new Error('外设资源 ID 必须唯一且非空。');
    ids.add(r.id);
    if (!RESOURCE_KINDS.some(([kind]) => kind === r.kind)) throw new Error('外设类型无效。');
    if (!r.pins || Array.isArray(r.pins) || typeof r.pins !== 'object' || Object.values(r.pins).some(pin => typeof pin !== 'string' || pin.length > 40)) throw new Error('引脚配置无效。');
    if (!r.settings || Array.isArray(r.settings) || typeof r.settings !== 'object') throw new Error('外设参数无效。');
    for (const [key, value] of Object.entries(r.settings)) {
      const field = resourceFields(r.kind).find(field => field[0] === key);
      if (!field) throw new Error(`未知外设参数：${key}`);
      if (['number','integer'].includes(field[2]) && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || field[2] === 'integer' && !Number.isSafeInteger(value))) throw new Error(`外设参数 ${key} 必须为有效数字。`);
      if (['text','select'].includes(field[2]) && typeof value !== 'string') throw new Error(`外设参数 ${key} 必须为文本。`);
      if (field[2] === 'select' && value && !field[3].some(([option]) => option === value)) throw new Error(`外设参数 ${key} 不是允许的选项。`);
    }
  }
}
export function sensorResources(resources, type) {
  const kinds = { uart:'uart', rs485:'uart', spi:'spi', adc:'adc', i2c:'i2c', abz:'timer', ssi:'spi', biss:'spi', can:'can' };
  return (resources || []).filter(resource => resource.kind === kinds[type] && resource.instance && (type !== 'rs485' || resource.settings.physical === 'rs485'));
}
export function resourceIssues(mcu, resources = []) {
  const issues = [], usedPins = new Map(), usedInstances = new Set();
  const add = (id,level,title,message) => issues.push({ id:`pcba-${id}`, level, title, message, moduleId:'hw-board', paramKey:'resources' });
  try { checkResourceShape(resources); } catch(error) { add('format','error','外设配置格式无效',error.message); return issues; }
  if (!resources.length) add('empty','pending','尚未分配 PCBA 外设','添加 PWM、ADC、通信接口和硬件故障输入。');
  for (const resource of resources) {
    const name = resource.name || resource.instance || '未命名外设', route = resourceRoute(mcu, resource);
    if (!route) { add(resource.id,'pending',`${name} · 外设映射待适配`,'需要完整 MCU 型号、封装及对应外设引脚表。'); continue; }
    if(!kindSettings[resource.kind])add(`${resource.id}-adapter`,'pending',`${name} · 参数与生成适配待完成`,'已收录芯片实例与封装引脚，尚未实现此外设的参数校验和初始化代码。');
    if (resource.kind !== 'gpio' && usedInstances.has(resource.instance)) add(`${resource.id}-duplicate`,'error','外设重复分配',`${resource.instance} 已配置；多个传感器可引用同一接口，无需重复添加。`);
    usedInstances.add(resource.instance);
    const activePins = Object.entries(resource.pins).filter(([,pin]) => pin);
    if (Object.keys(route.pins).length && !activePins.length) add(`${resource.id}-pins`,'pending',`${name} · 引脚待分配`,'请从当前外设支持的引脚中选择。');
    for (const [signal,pin] of activePins) {
      if (!route.pins[signal]?.includes(pin)) add(`${resource.id}-${signal}`,'error','引脚不支持所选外设',`${name} / ${signal} 不能使用 ${pin}，请核对 MCU 与引脚映射。`);
      if (usedPins.has(pin)) add(`${resource.id}-${signal}-conflict`,'error','引脚重复分配',`${pin} 同时分配给 ${usedPins.get(pin)} 和 ${name}。`);
      usedPins.set(pin,name);
    }
    for (const [key,label,type] of resourceFields(resource.kind)) {
      if(key==='initialLevel'&&resource.settings.direction!=='output')continue;
      const value = resource.settings[key];
      const choices = resourceSettingOptions(mcu, resource, key);
      if (choices && value !== null && value !== undefined && value !== '' && !choices.some(option => option.value === value)) add(`${resource.id}-${key}-choice`,'error',`${name} · ${label}不受支持`,'请从当前 MCU 和外设支持的选项中选择。');
      if (['number','integer'].includes(type) && value != null && (value < 0 || value === 0 && key !== 'deadtimeNs')) add(`${resource.id}-${key}`,'error',`${name} · ${label}无效`,'请输入符合器件要求的正数。');
      if (value === null || value === undefined || value === '') add(`${resource.id}-${key}-empty`,'pending',`${name} · ${label}待配置`,'补充外设参数后再检查构建支持。');
    }
    if (resource.kind === 'adc' && resource.settings.trigger === 'HRTIM1' && !resources.some(item => item.kind === 'pwm' && item.instance === 'HRTIM1')) add(`${resource.id}-trigger-resource`,'pending',`${name} · 触发源待配置`,'先添加并配置 HRTIM1 PWM 外设。');
    if (resource.kind === 'uart' && !resource.pins.RX) add(`${resource.id}-rx`,'pending',`${name} · 接收引脚待配置`,'接收传感器数据需要 RX 引脚。');
    if (resource.kind === 'uart' && resource.settings.physical === 'rs485' && !resource.pins.DE) add(`${resource.id}-de`,'pending',`${name} · RS-485 方向控制待配置`,'当前适配采用外设 DE 控制，请分配 DE 引脚。');
  }
  return issues;
}

export const isPwmResource = resource => resource?.kind==='pwm'||resource?.kind==='timer'&&resource.settings.mode==='pwm';
