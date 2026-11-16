import { SENSOR_PARAMS } from './sensors.mjs';
import { DRIVER_CONTRACTS } from './contracts.mjs';

/** 传感器驱动：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "hw-drivers",
  "layer": "hardware",
  "order": 3,
  "title": "驱动",
  "summary": "编码器 · 力矩传感器 · 通信与解析",
  "role": "绑定电机侧编码器、出轴侧编码器与力矩传感器，定义通信方式、收发帧格式、数值解析与有效性检查。",
  "inputs": "传感器原始数据、接口配置。",
  "outputs": "传感器读数、时间戳、新鲜度与有效位。",
  "boundary": "电角度解释属于算法层，出轴与力矩标零属于参数管理；异步传感器不得假设与 ADC 同时采样。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "hardware",
  "dependencies": [
    "hw-platform",
    "hw-board"
  ],
  contracts: DRIVER_CONTRACTS,
  params: [...SENSOR_PARAMS, { key: 'customDrivers', label: '其他驱动', type: 'custom-driver-list', phase: 'init', description: '用户添加的器件信息与外设绑定。', required: false, hidden: true, defaultValue: [] }]
};
