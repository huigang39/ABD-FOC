import { CONTRACTS } from './contracts.mjs';
import { choices, unset, number, select } from '../../shared/fields.mjs';

/** 通信协议：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "app-comms",
  "layer": "app",
  "order": 4,
  "title": "通信",
  "summary": "协议适配 · 命令校验 · 遥测",
  "role": "解码命令并校验来源、序号和有效期；隔离具体总线，发布标准命令和遥测。升级接收与启动管理协作，停机后执行镜像事务。",
  "inputs": "总线消息、运行状态、升级数据。",
  "outputs": "标准命令、遥测消息、升级请求。",
  "boundary": "通信回调不直接操作 PWM；命令必须经过状态与仲裁检查，遥测读取反馈快照。",
  "required": false,
  "runtimeSwitchable": true,
  "executionDomain": "background",
  "dependencies": [
    "hw-board"
  ],
  contracts: CONTRACTS,
  params: [
    select('bus', '通信总线', choices([unset, ['can', 'CAN'], ['canfd', 'CAN FD'], ['uart', 'RS485'], ['ethercat', 'EtherCAT'], ['ethernet', 'Ethernet']]), 'compile', '总线仅为设计选择，不表示已存在对应驱动。'),
    number('timeoutMs', '命令超时', 'ms', 'runtime', '通信命令超过有效期后按停机策略处理。', { min: 0 }),
  ]
};
