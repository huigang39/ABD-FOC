import { MOTION_GAIN_FIELDS } from './loops.mjs';
import { CONTRACTS } from './contracts.mjs';
import { choices, unset, number, select } from '../../shared/fields.mjs';

const modeChoices = choices([
  ['current', '电流 / 估算力矩'], ['speed', '速度'], ['position', '位置'],
  ['impedance', 'PD / 阻抗'], ['torque_feedback', '力矩传感器闭环'], ['calibration', '受限校准'],
]);

/** 运动控制：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "app-motion",
  "layer": "app",
  "order": 3,
  "title": "控制环",
  "summary": "力矩环 · 速度环 · 位置环 · PD 环",
  "role": "在正常控制与校准来源之间选择唯一给定源；按模式执行位置、速度、力矩或 PD 控制，管理给定斜坡、动态限值及模式切换。",
  "inputs": "有效命令、校准给定请求、电机侧与出轴侧反馈、状态许可。",
  "outputs": "正常模式的 Id/Iq 给定，或校准模式的受限激励请求；同时带动态限值与有效期。",
  "boundary": "电机转子角度、输出轴角度与电角度分别定义；力矩传感器闭环为可选，控制环按模式组合。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "control",
  "dependencies": [
    "app-runtime",
    "foc-lifecycle",
    "foc-current"
  ],
  contracts: CONTRACTS,
  params: [
    ...MOTION_GAIN_FIELDS,
    ...[
    select('positionFeedback', '位置反馈来源', choices([unset, ['motor_reduction', '电机侧角度经减速比换算'], ['output_encoder', '出轴编码器 · 全闭环']]), 'init', '出轴位置与电机换相角度分别选择。', { required: false }),
    { key: 'positionFeedbackSignal', label: '旧位置反馈连接', type: 'signal-reference', hidden: true, phase: 'init', required: false, defaultValue: 'default', description: '仅保留旧项目的自选信号连接；须显式移除后使用固定功能配置。' },
    { key: 'speedFeedbackSignal', label: '旧速度反馈连接', type: 'signal-reference', hidden: true, phase: 'init', required: false, defaultValue: 'default', description: '仅保留旧项目的自选信号连接；须显式移除后使用固定功能配置。' },
    { key: 'torqueFeedbackSignal', label: '旧力矩反馈连接', type: 'signal-reference', hidden: true, phase: 'init', required: false, defaultValue: 'default', description: '仅保留旧项目的自选信号连接；须显式移除后使用固定功能配置。' },
    { key: 'supportedModes', label: '允许的运行模式', type: 'multiselect', options: modeChoices, phase: 'runtime', description: '配置已实现模式的运行许可，不裁剪模式代码；同一时刻只激活一种。受限校准有独立进入条件。', required: true, defaultValue: [] },
    select('activeMode', '当前设计模式', choices([unset, ...modeChoices.map(o => [o.value, o.label])]), 'runtime', '用于检查依赖关系，不会向设备发送运行命令。'),
    select('commandSource', '命令来源', choices([unset, ['local', '本地控制'], ['communication', '通信命令']]), 'init', '通信来源要求启用通信模块；校准激励仍经过统一仲裁。'),
    number('outerHz', '控制环频率', 'Hz', 'init', '控制任务须慢于电流环；预算和截止时间还需板上验证。', { min: 0 }),
    number('currentLimitA', '动态电流限值', 'A', 'runtime', '应用可请求的电流幅值上限；不得超过电流环保护阈值。', { min: 0 }),
    number('speedFilterHz', '速度反馈滤波', 'Hz', 'init', '编码器差分速度的一阶低通截止频率。', { min: 0, required: false }),
    number('profileVelocityRadS', '轮廓速度上限', 'rad/s', 'runtime', '输出轴速度，供 PP / PPC 轨迹规划使用；仍受机械速度边界限制。', { required: false, min: 0 }),
    number('profileAccelerationRadS2', '轮廓加速度', 'rad/s²', 'runtime', '输出轴加速度，供位置与速度轮廓使用。', { required: false, min: 0 }),
    number('profileDecelerationRadS2', '轮廓减速度', 'rad/s²', 'runtime', '输出轴减速度，不能代替硬件急停。', { required: false, min: 0 }),
    number('profileTorqueSlopeNmS', '轮廓力矩斜率', 'N·m/s', 'runtime', 'PT 模式的输出轴力矩变化率。', { required: false, min: 0 }),
    number('profilePositionWindowRad', '位置到达窗口', 'rad', 'runtime', '输出轴位置误差窗口。', { required: false, min: 0 }),
    number('profileVelocityWindowRadS', '速度到达窗口', 'rad/s', 'runtime', '输出轴速度误差窗口。', { required: false, min: 0 }),
    number('profileTorqueWindowNm', '力矩到达窗口', 'N·m', 'runtime', '输出轴力矩误差窗口。', { required: false, min: 0 }),
    number('profileTargetTimeMs', '到达稳定时间', 'ms', 'runtime', '持续处于窗口内的时间；来自当前驱动的轮廓参数。', { required: false, min: 0 }),
    ].map(field=>({...field,hidden:true,required:false})),
  ]
};
