import { CONTRACTS } from './contracts.mjs';
import { choices, unset, select } from '../../shared/fields.mjs';

/** 调度器：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "app-runtime",
  "layer": "app",
  "order": 1,
  "title": "调度器",
  "summary": "任务周期",
  "role": "按周期释放任务并记录超期次数。",
  "inputs": "任务表、时基、自检与配置校验结果。",
  "outputs": "任务释放标志与超期计数。",
  "boundary": "故障诊断可先于控制环派发；同核的通信、校准和存储任务应低于控制环优先级。电流环由硬件同步事件触发，复位后不自动恢复驱动输出。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "application",
  "dependencies": [
    "app-params",
    "hw-platform"
  ],
  contracts: CONTRACTS,
  params: [
    select('scheduler', '调度方式', choices([unset, ['cooperative', '协作式调度'], ['preemptive', '抢占式调度']]), 'compile', '调度实现由固件维护。', {defaultValue:'cooperative', hidden:true}),
    select('schedulingAlgorithm', '调度算法', choices([['fixed_priority','固定优先级'],['rate_monotonic','周期优先']]), 'compile', '固定优先级沿用任务设置；周期优先按周期从短到长排序，同周期依次优先安排故障诊断、控制环，再安排其他任务。电流环中断独立执行。', {defaultValue:'fixed_priority', hidden:true}),
    select('hardwareProfile', '配置来源', choices([['custom', '自定义'], ['NEO_75_H_GW_KW', 'NEO_75_H_GW_KW'], ['NEO_75_H_GW_LD', 'NEO_75_H_GW_LD'], ['NEO_75_H_GW_SMH', 'NEO_75_H_GW_SMH'], ['NEO_75_H_GW_XH', 'NEO_75_H_GW_XH'] ]), 'init', '内部保留选型来源以兼容已有工程，由选型流程维护，不作为调度器参数展示。', { defaultValue: 'custom', required: false, hidden: true }),

  ]
};
