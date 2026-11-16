import { CONTRACTS } from './contracts.mjs';
import { choices, select } from '../../shared/fields.mjs';

/** 保护与诊断：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "app-safety",
  "layer": "app",
  "order": 7,
  "title": "异常",
  "summary": "全程有效 · 故障锁存 · 恢复",
  "role": "监控温度、行程、通信超时等运行条件；汇总算法与硬件故障，决定降额、停机、锁存与恢复。按策略捕获诊断上下文。",
  "inputs": "运行反馈、硬件故障、算法故障、任务健康状态。",
  "outputs": "限值收紧、停机请求、诊断记录、恢复许可。",
  "boundary": "在所有运行阶段持续有效；必要保护不开放普通关闭开关。快速故障由下层即时处理，故障落盘在允许窗口执行。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "application",
  "dependencies": [
    "foc-current",
    "hw-safety"
  ],
  contracts: CONTRACTS,
  params: [
    select('faultAction', '运行故障动作', choices([['disable', '停止输出并锁存'], ['derate_then_disable', '允许降额，严重故障关断']]), 'init', '硬件和电流环紧急故障始终具有独立关断权。', { defaultValue: 'disable' }),
  ]
};
