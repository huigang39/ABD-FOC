import { INTERRUPT_LEVELS } from '../hw-platform/priorities.mjs';
import { isPwmResource } from '../hw-board/resources.mjs';
export const TRIP_SOURCES = [['comparator','比较器输出'],['external','外部故障输入']];
export const TRIP_ROUTES = [['break','PWM 硬件刹车'],['interrupt','外部中断关断']];
export function createTripPath(id = globalThis.crypto?.randomUUID?.() || `trip-${Date.now()}`) {
  return { id, source:'external', inputResource:'', pwmResource:'', route:'interrupt', activeLevel:'low', filterCycles:0, priority:'emergency', latch:true, compiled:true, enabled:true };
}
export function checkTripShape(paths) {
  if (!Array.isArray(paths) || paths.length > 32) throw new Error('保护路径必须为不超过 32 项的数组。');
  const ids = new Set();
  for (const path of paths) {
    if (!path || typeof path !== 'object' || Object.keys(path).some(key => !['id','source','inputResource','pwmResource','route','activeLevel','filterCycles','priority','latch','compiled','enabled'].includes(key))) throw new Error('保护路径格式无效。');
    for (const key of ['id','source','inputResource','pwmResource','route','activeLevel']) if (typeof path[key] !== 'string') throw new Error(`保护路径 ${key} 必须是文本。`);
    if (!path.id || ids.has(path.id)) throw new Error('保护路径 ID 必须唯一且非空。');
    ids.add(path.id);
    for(const key of ['compiled','enabled'])if(path[key]!==undefined&&typeof path[key]!=='boolean')throw Error('保护路径开关必须是布尔值。');
    if (!TRIP_SOURCES.some(([key]) => key === path.source) || !TRIP_ROUTES.some(([key]) => key === path.route) || !['low','high'].includes(path.activeLevel)) throw new Error('保护路径选项无效。');
    for (const key of ['filterCycles']) if (!Number.isSafeInteger(path[key]) || path[key] < 0) throw new Error('保护优先级和滤波周期必须为非负整数。');
    if(!INTERRUPT_LEVELS.some(level=>level.value===path.priority))throw Error('请选择有效的中断优先级等级。');
    if (typeof path.latch !== 'boolean') throw new Error('保护锁存配置必须为布尔值。');
  }
}
export function tripIssues(paths = [], resources = [], platform = {}) {
  const issues = [];
  const add = (id,level,title,message) => issues.push({ id:`hardware-trip-${id}`, level,title,message,moduleId:'hw-safety',paramKey:'tripPaths' });
  try { checkTripShape(paths); } catch(error) { add('format','error','保护路径格式无效',error.message); return issues; }
  if (!paths.length) add('empty','pending','硬件保护路径待配置','选择比较器或故障输入，并指定 PWM 关断路径。');
  for (const path of paths) {
    if(path.compiled===false||path.enabled===false)continue;
    const input = resources.find(resource => resource.id === path.inputResource);
    const pwm = resources.find(resource => resource.id === path.pwmResource);
    if (!input) add(`${path.id}-input`,path.inputResource?'error':'pending','保护输入未绑定','从 PCBA 已配置的故障输入或比较器中选择。');
    else if (!['gpio','comparator'].includes(input.kind) || input.kind === 'gpio' && input.settings.direction !== 'input') add(`${path.id}-input-type`,'error','保护输入类型不符','故障输入必须是 GPIO 输入或比较器输出。');
    if (!isPwmResource(pwm)) add(`${path.id}-pwm`,path.pwmResource?'error':'pending','关断目标未绑定','选择 PCBA 中配置为 PWM 发波的定时器。');
    if (path.source === 'external' && path.activeLevel !== 'low') add(`${path.id}-polarity`,'error','外部故障输入必须低有效','DRV8353 等 nFAULT 输出以低电平表示故障；高有效配置会在正常状态误触发或永不触发。');
    if (!path.latch) add(`${path.id}-latch`,'error','故障后必须锁存关断','故障撤销不能自动恢复输出；清除锁存和重新使能由应用状态机授权。');
    if (path.route === 'interrupt') {
      if (path.filterCycles !== 0) add(`${path.id}-filter`,'error','外部中断路径不支持 PWM 滤波周期','滤波周期只适用于已适配的硬件刹车输入。');
      if (platform.architecture === 'arm' && platform.irqPriorityBits && path.priority >= 2 ** platform.irqPriorityBits) add(`${path.id}-priority`,'error','中断优先级超出范围','优先级必须落在 MCU 实现的优先级位数范围内。');
      add(`${path.id}-latency`,'pending','中断关断响应待验证','此路径经过 CPU；需要确认中断屏蔽、抢占关系和最坏关断延迟。');
    } else {
      // Pin availability alone never establishes a chip-internal fault route.
      add(`${path.id}-routing`,'pending','硬件刹车路由待适配','需确认实际输入到 PWM 刹车端的连接、极性与滤波；不能从 GPIO 名称推断可直连。');
    }
  }
  return issues;
}
