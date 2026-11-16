import { CONTRACTS } from './contracts.mjs';
import { choices, unset, select, number } from '../../shared/fields.mjs';

/** 电角度源：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "foc-feedback",
  "layer": "foc",
  "order": 2,
  "title": "电角度源",
  "summary": "反馈调理 · 电角度 · 有效性",
  "role": "处理电流反馈与电机侧角度，按选定采样拓扑进行必要重构；应用电机零位、方向与极对数，保留采样时间及新鲜度。",
  "inputs": "相电流、电机侧角度、时间戳、校准参数，以及当前执行器的电机极对数。",
  "outputs": "电流反馈、转子电角度、反馈有效性。",
  "boundary": "电机极对数统一从货架中的当前执行器读取。传感器采集与电子增益换算由硬件层负责；输出轴静态标零不直接充当电角度零位。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "fast",
  "dependencies": [
    "hw-drivers",
    "hw-board"
  ],
  contracts: CONTRACTS,
  params: [
    select('angleSource', '电角度源', choices([unset, ['encoder', '电机侧编码器'], ['observer', '观测器估算'], ['forced', '强拖角度']]), 'init', '首次校准使用独立受限路径，不要求本次待求的零位已存在。'),
    number('forcedAngleRad', '强拖角度', 'rad', 'runtime', '直接给定电角度，不乘转子极对数；固定角度不会自动旋转，连续强拖需由给定源逐周期更新角度。当前仅定义配置，固件角度交接尚未接入。', {defaultValue:0,min:0,max:2*Math.PI}),
  ]
};
