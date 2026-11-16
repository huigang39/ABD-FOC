import { getAssemblySummary } from '../../../features/equipment/model.mjs';

/** Display the selected motor's value without creating a second configuration. */
export function renderExtras({ project, escape }) {
  const { actuator } = getAssemblySummary(project);
  const polePairs = actuator?.motor.polePairs;
  const value = Number.isSafeInteger(polePairs) && polePairs > 0 ? polePairs : '待配置';
  return `<div class="module-feature-link"><strong>电机参数来源</strong><p>${actuator ? `${escape(actuator.name)} · 极对数 ${escape(value)}` : '先在工程中选择执行器。'}</p><p>电角度换算读取当前执行器的极对数，电机参数统一在货架中维护。</p><a class="button small navigation-action" href="${actuator ? `#/equipment/actuators/${encodeURIComponent(actuator.id)}` : '#/project/actuator'}">${actuator ? '编辑执行器参数' : '选择执行器'} →</a></div>`;
}
