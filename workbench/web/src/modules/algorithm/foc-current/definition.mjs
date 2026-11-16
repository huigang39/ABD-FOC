import { CONTRACTS } from './contracts.mjs';
import { number } from '../../shared/fields.mjs';

/** 电流环：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "foc-current",
  "layer": "foc",
  "order": 1,
  "title": "电流环",
  "summary": "带宽配置 · 电压限幅 · 抗积分饱和",
  "role": "根据带宽和电机参数配置电流闭环，执行积分管理、限幅、模式切换；异常策略由算法异常模块统一管理；前馈、解耦扩展按需启用。",
  "inputs": "d/q 电流、Id/Iq 给定、电机 R/Ld/Lq、母线与动态限值、采样和给定有效性。",
  "outputs": "d/q 电压指令、限幅状态、电流环故障锁存、无效输出标志与关断请求。",
  "boundary": "控制器保留数值有效性检查与安全返回，异常判定和关断策略归算法异常模块；角度尚未校准时仅允许受限校准路径。内部 PI 参数由带宽计算，实际离散化、延迟及限幅需要实现验证；不写 Flash，硬件独立关断始终有效。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "fast",
  "dependencies": [
    "foc-feedback",
    "foc-modulation",
    "hw-safety"
  ],
  contracts: CONTRACTS,
  params: [
    number('bandwidthHz', '电流环带宽', 'Hz', 'runtime', '根据带宽与当前执行器的 R、Ld、Lq 计算内部 PI 参数。连续域近似：$\\omega_c=2\\pi f_c$，$K_{p,d}=L_d\\omega_c$，$K_{p,q}=L_q\\omega_c$，$K_i=R\\omega_c$。实际可用带宽仍需结合采样周期、延迟和限幅验证。'),
    { key: 'decoupling', label: '前馈 / 解耦扩展', type: 'boolean', phase: 'runtime', description: '可选扩展，需要相应电机参数；开启不表示已经实现。', required: false, defaultValue: false },
    number('kpD', 'd 轴 Kp', 'V/A', 'runtime', '保留旧项目原值，仅供兼容导入；当前内部参数由带宽和电机参数计算。', { hidden: true, required: false, min: 0 }),
    number('kiD', 'd 轴 Ki', 'V/(A·s)', 'runtime', '保留旧项目原值，仅供兼容导入；不反推带宽。', { hidden: true, required: false, min: 0 }),
    number('kpQ', 'q 轴 Kp', 'V/A', 'runtime', '保留旧项目原值，仅供兼容导入；当前内部参数由带宽和电机参数计算。', { hidden: true, required: false, min: 0 }),
    number('kiQ', 'q 轴 Ki', 'V/(A·s)', 'runtime', '保留旧项目原值，仅供兼容导入；不反推带宽。', { hidden: true, required: false, min: 0 }),
  ]
};
