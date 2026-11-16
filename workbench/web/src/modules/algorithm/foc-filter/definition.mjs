import { CONTRACTS } from './contracts.mjs';

export default {
  id: 'foc-filter', layer: 'foc', order: 4, title: '滤波器',
  summary: '信号选择 · 独立滤波参数',
  role: '对选定信号配置滤波实例，保持信号的物理量、角度域和轴侧。',
  inputs: '所选输入信号、采样时间、计算周期与有效标志。',
  outputs: '与输入保持相同物理量的滤波结果。',
  boundary: '滤波实例与状态的固件适配尚未实现；配置不会隐式替换控制链路输入。',
  required: false, runtimeSwitchable: true, executionDomain: 'fast', dependencies: [],
  contracts: CONTRACTS,
  params: [{ key: 'children', label: '滤波实例', type: 'algorithm-children', hidden: true, required: false, defaultValue: [], phase: 'compile', description: '独立配置输入信号与参数的滤波实例。' }],
};
