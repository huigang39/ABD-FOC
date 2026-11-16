import { OBSERVER_OUTPUTS, observerOutputOptions } from '../signals.mjs';
import { CONTRACTS } from './contracts.mjs';
import { choices, unset, select } from '../../shared/fields.mjs';

/** 状态观测：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "foc-observer",
  "layer": "foc",
  "order": 3,
  "title": "观测器",
  "summary": "状态估算 · 相位提取 · 结果选择",
  "role": "按链路估计电气或机械状态。滑模估计反电动势，磁链观测估计转子磁链；各链路独立选择 PLL 或反正切提取角度与速度。结果可单独发布或融合，启用观测不自动接管控制。",
  "inputs": "采样、历史状态、与采样时刻对应的已生效 PWM 和母线信息。",
  "outputs": "估算状态、置信状态与异常标志。",
  "boundary": "启用后与电流环同频；执行先后和使用本周期或上周期数据由算法依赖确定，不能用尚未生效的输出冒充实际输出。",
  "required": false,
  "runtimeSwitchable": true,
  "executionDomain": "fast",
  "dependencies": [
    "foc-feedback",
    "hw-board"
  ],
  contracts: CONTRACTS,
  params: [
    {key:'children',label:'子模块',type:'algorithm-children',hidden:true,required:false,defaultValue:[],phase:'compile',description:'观测器内部的观测链路集合。'},
    ...OBSERVER_OUTPUTS.map(([key,label])=>select(key,label,observerOutputOptions(key),'runtime','选择发布的观测结果；角度域与轴侧必须匹配，且对应链路已编译并启用运行。',{defaultValue:'none',required:false})),
    select('startupStrategy', '估算角度启动策略', choices([unset, ['open_loop', '受限开环启动'], ['encoder_assist', '编码器辅助'], ['external_position', '外部初始位置']]), 'init', '使用估算角度时，需要明确低速、启动及失锁退出方案。', { required: false }),
  ]
};
