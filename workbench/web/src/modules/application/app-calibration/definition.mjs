import { CONTRACTS } from './contracts.mjs';
import { choices, number } from '../../shared/fields.mjs';

const calibrationChoices = choices([['electrical_zero', '编码器校准 · 方向与电角度偏置'], ['motor_encoder_nonlinear', '编码器校准 · 电机侧非线性'], ['output_encoder_nonlinear', '编码器校准 · 出轴侧非线性'], ['hall', '编码器校准 · 霍尔'], ['friction', '摩擦辨识']]);

/** 校准管理：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "app-calibration",
  "layer": "app",
  "order": 5,
  "title": "校准",
  "summary": "编码器校准 · 摩擦辨识",
  "role": "编排编码器校准（电角度零位、非线性修正、霍尔校准）、摩擦辨识。摩擦辨识产出补偿参数。编码器校准与摩擦辨识写入校准区。限制运动范围，处理取消、故障退出和结果验证。",
  "inputs": "校准请求、传感器反馈、已有校准数据。",
  "outputs": "校准给定请求、候选结果、摩擦参数与有效校准版本。",
  "boundary": "与正常控制互斥；复用统一给定入口并受保护约束。失败保留上一份有效结果，不直接越过门控写 PWM。方向与电角度偏置已有受限扫描实现；持久化由目标平台负责。",
  "required": false,
  "runtimeSwitchable": true,
  "executionDomain": "application",
  "dependencies": [
    "app-runtime",
    "app-motion",
    "app-params"
  ],
  contracts: CONTRACTS,
  params: [
    { key: 'procedures', label: '校准项目', type: 'multiselect', options: calibrationChoices, phase: 'compile', description: '选择需要的校准功能。配置不会立即执行校准。', required: true, defaultValue: [] },
    { key: 'enabledProcedures', label: '运行允许的校准项目', type: 'multiselect', options: calibrationChoices, phase: 'runtime', description: '仅允许已编译的项目，关闭后保留配置。允许运行不等于立即执行；校准请求仍需检查停机条件、模式互斥和运动范围。', required: false, defaultValue: [] },
    number('maxCurrentA', '校准激励电流上限', 'A', 'init', '运动校准的单独限值；也受正常电流边界约束。', { min: 0, required: false }),
  ]
};
