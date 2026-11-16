import { CORE_EXCEPTION_FIELDS } from './core-exceptions.mjs';
import { CONTRACTS } from './contracts.mjs';
import { capability } from '../../shared/fields.mjs';

/** 硬件异常：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "hw-safety",
  "layer": "hardware",
  "order": 4,
  "title": "异常",
  "summary": "内核异常 · 故障输入 · 输出关断",
  "role": "处理各内核异常并记录上下文；配置平台支持的比较器、门极故障和 PWM 关断路径；锁存硬件故障，实施最终输出门控。",
  "inputs": "硬件故障、应用运行许可、调制有效标志。",
  "outputs": "实际输出使能状态、硬件故障与关断结果。",
  "boundary": "处理内核异常、比较器、PWM 刹车与外部故障中断。内核异常处理器与快照恢复需由平台适配实现。中断关断依赖 CPU 响应，不等于独立硬件刹车。常规电压、温度等轮询与恢复策略属于应用层。故障后锁存关断，应用授权后才能恢复。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "hardware",
  "dependencies": [
    "hw-platform",
    "hw-board"
  ],
  contracts: CONTRACTS,
  params: [
    ...CORE_EXCEPTION_FIELDS,
    {...capability('hardwareTripCapability', '独立硬件关断路径'),hidden:true,required:false},
    {key:'tripPaths',label:'硬件保护路径',type:'trip-list',description:'故障输入到 PWM 关断的硬件或中断路径。',phase:'init',required:false,defaultValue:[],hidden:true},
    { key: 'resetOutputDisabled', hidden: true, label: '复位时默认关闭输出', type: 'boolean', phase: 'init', description: '架构必需约束，不允许配置为自动输出。', required: true, defaultValue: true },
  ]
};
