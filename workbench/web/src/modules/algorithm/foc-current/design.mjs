import { getActiveActuator } from '../../../features/equipment/model.mjs';

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const active = instance => instance?.enabled === true && instance.runtimeEnabled === true;

/** Continuous PI design from motor data; actual discrete coefficients belong to the firmware implementation. */
export function getCurrentLoopDesign(project) {
  const params = project.instances?.['foc-current']?.parameters || {};
  const timing = project.instances?.['hw-board']?.parameters || {};
  const selected = getActiveActuator(project);
  const actuator = selected ? structuredClone(selected) : null;
  const bandwidthHz = typeof params.bandwidthHz === 'number' && Number.isFinite(params.bandwidthHz) ? params.bandwidthHz : null;
  const pwm = timing.pwmHz, divider = timing.currentLoopDivider;
  const frequency = positive(pwm) && Number.isSafeInteger(divider) && divider > 0 ? pwm / divider : null;
  const sampleHz = positive(frequency) && positive(1 / frequency) ? frequency : null;
  const periodSeconds = sampleHz === null ? null : 1 / sampleHz;
  const motor = actuator?.motor || {}, missing = [];
  if (!positive(bandwidthHz)) missing.push('电流环带宽');
  if (!positive(pwm)) missing.push('PWM 频率');
  if (!Number.isSafeInteger(divider) || divider <= 0) missing.push('电流环分频');
  if (positive(pwm) && Number.isSafeInteger(divider) && divider > 0 && sampleHz === null) missing.push('可用的电流环采样周期');
  if (!actuator) missing.push('当前执行器');
  const motorFields = [
    ['resistanceOhm', '电机相电阻 R'], ['inductanceDH', 'd 轴电感 Ld'], ['inductanceQH', 'q 轴电感 Lq'],
  ];
  for (const [key, label] of motorFields) if (!positive(motor[key])) missing.push(label);
  let gains = null;
  if (positive(bandwidthHz) && motorFields.every(([key]) => positive(motor[key]))) {
    // The existing driver uses Kp = wc * L and Ki = wc * R; the console takes Hz.
    const omega = 2 * Math.PI * bandwidthHz;
    const candidate = { kpD: omega * motor.inductanceDH, kpQ: omega * motor.inductanceQH, kiD: omega * motor.resistanceOhm, kiQ: omega * motor.resistanceOhm };
    if (Object.values(candidate).every(positive)) gains = candidate;
    else missing.push('可表示的内部增益');
  }
  return { bandwidthHz, sampleHz, periodSeconds, actuator, missing, gains };
}

export function validateCurrentLoop(project) {
  const issues = [];
  const add = (id, level, title, message, paramKey, moduleId = 'foc-current') => issues.push({ id: `current-loop-${id}`, level, title, message, moduleId, ...(paramKey ? { paramKey } : {}) });
  if (!active(project.instances?.['foc-current'])) return issues;
  const design = getCurrentLoopDesign(project), raw = project.instances['foc-current'].parameters?.bandwidthHz;
  if (raw !== null && raw !== undefined && (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0)) {
    add('bandwidth-range', 'error', '电流环带宽无效', '带宽必须是大于零的有限频率，单位为 Hz。', 'bandwidthHz');
  }
  if (positive(design.bandwidthHz) && design.sampleHz !== null && design.bandwidthHz >= design.sampleHz / 2) {
    add('bandwidth-sampling', 'error', '带宽达到或超过采样限制', `当前电流环采样频率为 ${design.sampleHz} Hz，带宽必须小于其一半。满足此条件仍不能证明闭环稳定。`, 'bandwidthHz');
  }
  if (design.sampleHz === null) add('sampling-incomplete', 'pending', '电流环采样周期待确定', '在采样与 PWM 中填写有效的 PWM 频率和电流环分频，以确定采样周期。', 'pwmHz', 'hw-board');
  const motorMissing = design.missing.filter(label => ['当前执行器', '电机相电阻 R', 'd 轴电感 Ld', 'q 轴电感 Lq'].includes(label));
  if (motorMissing.length) add('motor-parameters', 'pending', '电流环电机参数待补齐', `请先选择执行器，并补齐其电机参数：${motorMissing.join('、')}。内部增益保持未知，不使用货架中的其他执行器或旧 PI 值代替。`);
  if (design.missing.includes('可表示的内部增益')) add('gain-range', 'error', '内部增益超出数值范围', '带宽与电机参数的乘积无法形成有效的有限增益，请检查单位和数量级。', 'bandwidthHz');
  add('runtime-unverified', 'pending', '电流环离散实现尚未联调', '当前只计算连续 PI 设计值。离散化、采样与计算延迟、限幅和抗积分饱和仍需在固件与实际电机上验证。');
  return issues;
}
