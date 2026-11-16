import { CONTRACTS } from './contracts.mjs';
import { choices, unset, number, select } from '../../shared/fields.mjs';

/** 变换与调制：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "foc-modulation",
  "layer": "foc",
  "order": 2,
  "title": "调制器",
  "summary": "Clarke / Park · 调制 · 约束",
  "role": "在电流环前后完成相应坐标变换与反变换，并生成归一化占空比；处理调制约束，匹配采样拓扑及允许采样窗口。",
  "inputs": "相电流、转子角度、电压指令、母线信息。",
  "outputs": "变换结果、PWM 指令、可用输出信息。",
  "boundary": "具体变换穿插于电流环中，模块编号不代表调用次序；不访问定时器，采样触发与最终 PWM 提交由硬件层实施。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "fast",
  "dependencies": [
    "hw-board"
  ],
  contracts: CONTRACTS,
  params: [
    select('method', '调制方式', choices([unset, ['svpwm', 'SVPWM'], ['spwm', 'SPWM']]), 'compile', '调制与采样拓扑、有效采样窗口必须匹配。'),
    number('dutyMin', '最小占空比', '', 'init', '归一化范围 0–1，实际可用范围由采样窗口和硬件决定。', { min: 0, max: 1, step: 0.001 }),
    number('dutyMax', '最大占空比', '', 'init', '必须大于最小占空比；不能仅凭此参数证明采样窗口可用。', { min: 0, max: 1, step: 0.001 }),
  ]
};
