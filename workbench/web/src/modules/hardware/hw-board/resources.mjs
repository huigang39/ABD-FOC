/** Maintained routes, not an inferred full chip pinout. NEO routes are from
 * neofsa/NeoFsa.ioc and hardware_boot_config.h (STM32H745IIK6 / UFBGA176).
 * Datasheet: https://www.st.com/resource/en/datasheet/stm32h745ii.pdf
 * New parts require their own package/pinmux metadata and generator adapter.
 */
import { resourceSettingOptions } from '../hw-platform/options.mjs';
import { H745_KINDS, H745_RESOURCES } from './h745-pin-data.mjs';
export const RESOURCE_KINDS = H745_KINDS.map(([kind,label]) => [kind, kind==='uart'?'UART':label]);
export const RESOURCE_PRESETS = Object.freeze([
  { id:'phase-current', label:'相电流采样', kind:'adc', common:true },
  { id:'bus-voltage', label:'母线电压采样', kind:'adc', common:true },
  { id:'temperature', label:'温度采样', kind:'adc', common:true },
  { id:'pwm', label:'PWM', kind:'pwm', common:true },
  { id:'terminal-voltage', label:'端电压采样', kind:'adc', common:false },
].map(Object.freeze));
// ADC resources may describe different channel groups of the same peripheral.
export const canShareResourceInstance = kind => ['adc','gpio'].includes(kind);
const h745 = H745_RESOURCES;
const kindSettings = {
  pwm: [ ['mode','工作模式','select',[['pwm','PWM 发波']]], ['alignment','对齐方式','select',[['center','中心对齐'],['edge','边沿对齐']]], ['polarity','输出有效电平','select',[['high','高有效'],['low','低有效']]] ],
  adc: [ ['sampleCycles','采样时长','number','周期'], ['trigger','触发来源','text',''], ['currentGain','电流测量链增益','number','V/A'] ],
  uart: [ ['bitrate','波特率','number','bit/s'], ['physical','电气接口','select',[['ttl','UART 电平'],['rs485','RS-485'],['rs422','RS-422']]], ['parity','校验','select',[['none','无'],['even','偶校验'],['odd','奇校验']]], ['stopBits','停止位','select',[['1','1'],['2','2']]] ],
  spi: [ ['clockHz','通信时钟','number','Hz'], ['mode','SPI 模式','select',[['0','Mode 0'],['1','Mode 1'],['2','Mode 2'],['3','Mode 3']]], ['wordBits','字长','integer','bit'] ],
  i2c: [ ['clockHz','总线时钟','number','Hz'] ],
  gpio: [ ['direction','方向','select',[['input','输入'],['output','输出']]], ['pull','上下拉','select',[['none','无'],['up','上拉'],['down','下拉']]], ['initialLevel','输出初始电平','select',[['low','低'],['high','高']]] ],
  timer: [ ['mode','工作模式','select',[['base','定时'],['pwm','PWM 发波'],['capture','输入捕获'],['encoder','编码器']]], ['clockHz','计数时钟','number','Hz'], ['periodUs','计时周期','number','μs'] ],
  lptim: [ ['clockHz','计数时钟','number','Hz'], ['periodUs','计时周期','number','μs'] ],
  comparator: [ ['thresholdMv','比较阈值','number','mV'] ],
};
export const resourceFields = kind => kindSettings[kind] || [];
// The family-only UI choice explicitly refers to this maintained IIK6 / UFBGA176 map.
// Other H745 package names are not aliases and still require their own pin map.
export const getMcuResources = mcu => ['STM32H745', 'STM32H745IIK6'].includes(mcu) ? structuredClone(h745) : [];
export const resourceRoute = (mcu, resource) => getMcuResources(mcu).find(route => route.kind === resource.kind && route.instance === resource.instance);
/** PWM choices require maintained output routes; basic timers have no outputs. */
export function resourceInstanceOptions(mcu, resource) {
  const pwm = resource.preset === 'pwm' || isPwmResource(resource);
  return getMcuResources(mcu).filter(route => pwm
    ? ['pwm', 'timer'].includes(route.kind) && Object.entries(route.pins).some(([signal, pins]) => (route.kind === 'pwm' ? /^[A-E][12]$/ : /^CH\d+$/).test(signal) && pins.length)
    : route.kind === resource.kind);
}
/** Logical bridge channels are shown only when both signals exist in this MCU route. */
export function pwmPhasePairs(mcu, resource) {
  if (!isPwmResource(resource)) return [];
  const pins = resourceRoute(mcu, resource)?.pins || {};
  const signals = [['A1','A2'],['B1','B2'],['C1','C2']].every(pair => pair.every(signal => pins[signal]))
    ? [['A1','A2'],['B1','B2'],['C1','C2']]
    : [['CH1','CH1N'],['CH2','CH2N'],['CH3','CH3N']].every(pair => pair.every(signal => pins[signal]))
      ? [['CH1','CH1N'],['CH2','CH2N'],['CH3','CH3N']] : [];
  return signals.map(([main, complementary], index) => ({ phase: ['U','V','W'][index], main, complementary }));
}

export function resourceSignalLayout(mcu, resource) {
  const route = resourceRoute(mcu, resource), available = Object.keys(route?.pins || {});
  const pairs = pwmPhasePairs(mcu, resource), complementary = new Set(pairs.map(pair => pair.complementary));
  const basic = pairs.length ? pairs.map(pair => pair.main) : ({
    uart: ['TX','RX', ...(resource.settings.physical === 'rs485' ? ['DE'] : [])],
    spi: ['SCK','MISO','MOSI'], i2c: ['SCL','SDA'], can: ['RX','TX'], gpio: ['IO'],
    timer: resource.settings.mode === 'encoder' ? ['CH1','CH2'] : resource.settings.mode === 'pwm' ? available.filter(signal => /^CH\d+N?$/.test(signal)).sort((a,b) => a.localeCompare(b, 'en', { numeric:true })) : resource.settings.mode === 'capture' ? ['CH1'] : [],
    dac: ['OUT1'],
  }[resource.kind] || []).filter(signal => available.includes(signal));
  const active = Object.keys(resource.pins || {}).filter(signal => resource.pins[signal] && resource.pins[signal] !== 'none' && !complementary.has(signal));
  const primary = pairs.length ? basic : [...new Set([...basic, ...active])];
  const advanced = [...new Set([...complementary, ...available, ...Object.keys(resource.pins || {})])].filter(signal => !primary.includes(signal));
  return { primary, advanced, pairs };
}

export function resourceSettingLayout(resource) {
  const fields = resourceFields(resource.kind).filter(([key]) => (key !== 'initialLevel' || resource.settings.direction === 'output') && !['trigger','currentGain'].includes(key) && !((resource.kind === 'pwm' || resource.preset === 'pwm') && ['mode','alignment','polarity'].includes(key)));
  const common = {
    pwm: ['alignment','polarity'], adc: ['sampleCycles','trigger','currentGain'], uart: ['bitrate','physical'],
    spi: ['clockHz','mode'], i2c: ['clockHz'], gpio: ['direction','pull','initialLevel'],
    timer: ['mode','periodUs'], lptim: ['periodUs'], comparator: ['thresholdMv'],
  }[resource.kind] || [];
  return { primary: fields.filter(([key]) => common.includes(key)), advanced: fields.filter(([key]) => !common.includes(key)) };
}

/** A complementary pin is inferred only from a single maintained, unoccupied route. */
export function selectResourcePin(resource, mcu, signal, value, resources = []) {
  const pin = value === 'none' ? '' : value;
  const route = resourceRoute(mcu, resource);
  if (pin && !route?.pins[signal]?.includes(pin)) throw new Error('此引脚不支持当前外设信号。');
  resource.pins[signal] = pin;
  const pair = pwmPhasePairs(mcu, resource).find(pair => pair.main === signal);
  if (!pin || !pair || resource.pins[pair.complementary]) return;
  const candidates = route.pins[pair.complementary];
  if (candidates.length !== 1) return;
  const companion = candidates[0];
  const occupied = [resource, ...resources.filter(item => item !== resource)].some(item => Object.entries(item.pins || {}).some(([key, assigned]) => assigned === companion && !(item.id === resource.id && key === pair.complementary)));
  if (!occupied) resource.pins[pair.complementary] = companion;
}
export function createResource(kind = 'uart', id = globalThis.crypto?.randomUUID?.() || `resource-${Date.now()}`) {
  if (!RESOURCE_KINDS.some(([value]) => value === kind)) throw new Error('外设类型无效。');
  return { id, name:'', kind, instance:'', pins:{}, settings:Object.fromEntries(resourceFields(kind).map(([key,,type]) => [key, ['number','integer'].includes(type) ? null : ''])) };
}
export function createPresetResource(preset, id) {
  const definition = RESOURCE_PRESETS.find(item => item.id === preset);
  if (!definition) throw new Error('外设预设无效。');
  const resource = createResource(definition.kind, id);
  resource.preset = definition.id;
  resource.name = definition.label;
  if (resource.kind === 'pwm') resource.settings.mode = 'pwm';
  return resource;
}
export function selectResourceInstance(resource, mcu, instance) {
  const route = resourceInstanceOptions(mcu, resource).find(item => item.instance === instance);
  if (!route) throw new Error('当前 MCU 尚未维护此外设的引脚映射。');
  if (resource.kind === route.kind && resource.instance === instance) return;
  const pwm = resource.preset === 'pwm' || isPwmResource(resource);
  if (resource.kind !== route.kind) {
    resource.kind = route.kind;
    resource.settings = createResource(route.kind).settings;
  }
  if (pwm) resource.settings.mode = 'pwm';
  resource.instance = instance;
  resource.pins = {};
  resource.pins = Object.fromEntries(resourceSignalLayout(mcu, resource).primary.map(signal => [signal, '']));
}
/** Select one ADC input channel; changing it clears the previous pin assignment. */
export function selectAdcChannel(resource, mcu, channel) {
  const route=resourceRoute(mcu,resource);
  if(resource.kind!=='adc'||!/^IN[PN]\d+$/.test(channel)||!route?.pins[channel])throw new Error('请选择当前 ADC 支持的采样通道。');
  const selected=Object.keys(resource.pins).find(signal=>/^IN[PN]\d+$/.test(signal));
  if(selected!==channel)resource.pins={[channel]:''};
}
export function checkResourceShape(resources) {
  if (!Array.isArray(resources) || resources.length > 128) throw new Error('外设资源必须为不超过 128 项的数组。');
  const ids = new Set();
  for (const r of resources) {
    if (!r || typeof r !== 'object' || Object.keys(r).some(key => !['id','name','kind','instance','pins','settings','preset'].includes(key))) throw new Error('外设资源格式无效。');
    for (const key of ['id','name','kind','instance']) if (typeof r[key] !== 'string' || r[key].length > 120) throw new Error(`外设 ${key} 必须是文本。`);
    if (!r.id || ids.has(r.id)) throw new Error('外设资源 ID 必须唯一且非空。');
    ids.add(r.id);
    if (!RESOURCE_KINDS.some(([kind]) => kind === r.kind)) throw new Error('外设类型无效。');
    if (Object.hasOwn(r,'preset') && !RESOURCE_PRESETS.some(preset => preset.id === r.preset && (preset.kind === r.kind || preset.id === 'pwm' && r.kind === 'timer' && r.settings?.mode === 'pwm'))) throw new Error('外设预设与类型不匹配。');
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
  const issues = [], usedPins = new Map(), usedInstances = new Set(), adcChannels = new Map(), adcTriggers = new Map();
  const add = (id,level,title,message) => issues.push({ id:`pcba-${id}`, level, title, message, moduleId:'hw-board', paramKey:'resources' });
  try { checkResourceShape(resources); } catch(error) { add('format','error','外设配置格式无效',error.message); return issues; }
  if (!resources.length) add('empty','pending','尚未分配 PCBA 外设','添加 PWM、ADC、通信接口和硬件故障输入。');
  for (const resource of resources) {
    const name = resource.name || resource.instance || '未命名外设', route = resourceRoute(mcu, resource);
    // Optional for ADCs that do not measure current; validate even before pin routing is ready.
    if (resource.kind === 'adc' && resource.settings.currentGain != null && resource.settings.currentGain <= 0) add(`${resource.id}-currentGain`,'error',`${name} · 电流测量链增益无效`,'电流测量链增益必须为正数；不测量电流的 ADC 可留空。');
    if (!route) { add(resource.id,'pending',`${name} · 外设映射待适配`,'需要完整 MCU 型号、封装及对应外设引脚表。'); continue; }
    if(!kindSettings[resource.kind])add(`${resource.id}-adapter`,'pending',`${name} · 参数与生成适配待完成`,'已收录芯片实例与封装引脚，尚未实现此外设的参数校验和初始化代码。');
    if (!canShareResourceInstance(resource.kind) && usedInstances.has(resource.instance)) add(`${resource.id}-duplicate`,'error','外设重复分配',`${resource.instance} 已配置；多个传感器可引用同一接口，无需重复添加。`);
    usedInstances.add(resource.instance);
    const activePins = Object.entries(resource.pins).filter(([,pin]) => pin);
    if (resource.kind === 'adc') {
      const trigger = resource.settings.trigger;
      const sharedTrigger = adcTriggers.get(resource.instance);
      if (trigger && sharedTrigger && trigger !== sharedTrigger.value) add(`${resource.id}-shared-trigger`,'error','共享 ADC 触发来源不一致',`${resource.instance} 与 ${sharedTrigger.name} 共用 ADC，请使用一致的触发来源。`);
      if (trigger && !sharedTrigger) adcTriggers.set(resource.instance,{value:trigger,name});
      for (const [signal] of activePins) {
        // Positive/negative differential inputs belong to the same ADC channel.
        const channel = signal.replace(/^IN[PN](\d+)$/, '$1'), key = `${resource.instance}:${channel}`;
        const previous = adcChannels.get(key);
        if (previous && previous.id !== resource.id) add(`${resource.id}-${signal}-channel-conflict`,'error','ADC 采样通道重复分配',`${resource.instance} / ${signal} 同时分配给 ${previous.name} 和 ${name}，请选择不同通道。`);
        else adcChannels.set(key,{id:resource.id,name});
      }
    }
    if (Object.keys(route.pins).length && !activePins.length) add(`${resource.id}-pins`,'pending',`${name} · 引脚待分配`,'请从当前外设支持的引脚中选择。');
    for (const [signal,pin] of activePins) {
      if (!route.pins[signal]?.includes(pin)) add(`${resource.id}-${signal}`,'error','引脚不支持所选外设',`${name} / ${signal} 不能使用 ${pin}，请核对 MCU 与引脚映射。`);
      if (usedPins.has(pin)) add(`${resource.id}-${signal}-conflict`,'error','引脚重复分配',`${pin} 同时分配给 ${usedPins.get(pin)} 和 ${name}。`);
      usedPins.set(pin,name);
    }
    for (const [key,label,type] of resourceFields(resource.kind)) {
      if (resource.kind === 'adc' && (key === 'currentGain' || key === 'trigger' && !resource.settings.trigger)) continue;
      if(key==='initialLevel'&&resource.settings.direction!=='output')continue;
      const value = resource.settings[key];
      const choices = resourceSettingOptions(mcu, resource, key);
      if (choices && value !== null && value !== undefined && value !== '' && !choices.some(option => option.value === value)) add(`${resource.id}-${key}-choice`,'error',`${name} · ${label}不受支持`,'请从当前 MCU 和外设支持的选项中选择。');
      if (['number','integer'].includes(type) && value != null && (value < 0 || value === 0 && key !== 'deadtimeNs')) add(`${resource.id}-${key}`,'error',`${name} · ${label}无效`,'请输入符合器件要求的正数。');
      // Historical HRTIM alignment/polarity remain serializable, but are no
      // longer editable or required; PWM mode is fixed by the resource type.
      if ((value === null || value === undefined || value === '') && !(resource.kind === 'pwm' && ['mode','alignment','polarity'].includes(key))) add(`${resource.id}-${key}-empty`,'pending',`${name} · ${label}待配置`,'补充外设参数后再检查构建支持。');
    }
    if (resource.kind === 'adc' && resource.settings.trigger === 'HRTIM1' && !resources.some(item => item.kind === 'pwm' && item.instance === 'HRTIM1')) add(`${resource.id}-trigger-resource`,'pending',`${name} · 触发源待配置`,'先添加并配置 HRTIM1 PWM 外设。');
    if (resource.kind === 'uart' && !resource.pins.RX) add(`${resource.id}-rx`,'pending',`${name} · 接收引脚待配置`,'接收传感器数据需要 RX 引脚。');
    if (resource.kind === 'uart' && resource.settings.physical === 'rs485' && !resource.pins.DE) add(`${resource.id}-de`,'pending',`${name} · RS-485 方向控制待配置`,'当前适配采用外设 DE 控制，请分配 DE 引脚。');
  }
  return issues;
}

export const isPwmResource = resource => resource?.kind==='pwm'||resource?.kind==='timer'&&resource.settings?.mode==='pwm';
