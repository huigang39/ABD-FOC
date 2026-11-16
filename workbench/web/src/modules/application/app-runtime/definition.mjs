import { CONTRACTS } from './contracts.mjs';
import { choices, unset, select } from '../../shared/fields.mjs';

/** 调度器：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "app-runtime",
  "layer": "app",
  "order": 1,
  "title": "调度器",
  "summary": "任务周期 · 派发顺序 · 执行预算",
  "role": "释放周期任务，配置派发顺序并监控执行预算。",
  "inputs": "任务表、时基、自检与配置校验结果。",
  "outputs": "任务释放标志与超期计数。",
  "boundary": "控制任务在应用调度器内最高优先级；FOC 电流环由硬件同步事件触发。复位后不自动恢复驱动输出。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "application",
  "dependencies": [
    "app-params",
    "hw-platform"
  ],
  contracts: CONTRACTS,
  params: [
    select('scheduler', '调度方式', choices([unset, ['cooperative', '协作式调度'], ['preemptive', '抢占式调度']]), 'compile', '只选择调度设计；中断优先级和执行预算仍需验证。'),
    select('schedulingAlgorithm', '调度算法', choices([['fixed_priority','固定优先级'],['rate_monotonic','周期优先']]), 'compile', '固定优先级使用任务设置；周期优先按周期从短到长自动排序，同周期优先安排控制任务。电流环中断独立执行。', {defaultValue:'fixed_priority'}),
    select('hardwareProfile', '配置来源', choices([['custom', '自定义'], ['NEO_75_H_GW_KW', 'NEO_75_H_GW_KW'], ['NEO_75_H_GW_LD', 'NEO_75_H_GW_LD'], ['NEO_75_H_GW_SMH', 'NEO_75_H_GW_SMH'], ['NEO_75_H_GW_XH', 'NEO_75_H_GW_XH'] ]), 'init', '记录选型来源；应用来源配置后仍可调整参数，构建时检查后端支持范围。', { defaultValue: 'custom', required: false }),

  ]
};
