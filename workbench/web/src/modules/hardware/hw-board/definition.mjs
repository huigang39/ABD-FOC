import { CONTRACTS } from './contracts.mjs';
import { choices, unset, number, integer, select } from '../../shared/fields.mjs';

/** 板级驱动：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "hw-board",
  "layer": "hardware",
  "order": 2,
  "title": "外设",
  "summary": "PCBA · 引脚 · ADC / PWM · 通信接口",
  "role": "按 PCBA 分配外设实例与输入输出引脚，配置板级测量链和 SPI、UART 等接口；统一管理 PWM、ADC、DMA 的触发、采样与输出提交时序。",
  "inputs": "板级电气配置、外设事件、调制指令与采样窗口约束。",
  "outputs": "同步采样帧、实际周期、功率级状态与输出生效序号。",
  "boundary": "依照 MCU 能力实施引脚复用与时序，上电和复位默认关闭输出。采样拓扑需与调制兼容；中断通过装配入口调用算法，外设代码不包含算法实现。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "hardware",
  "dependencies": [
    "hw-platform"
  ],
  contracts: CONTRACTS,
  params: [
    {key:'resources',label:'PCBA 外设资源',type:'resource-list',description:'按 MCU 与封装分配外设实例、信号引脚与参数。',phase:'init',required:false,defaultValue:[],hidden:true},
    select('currentTopology', '电流采样拓扑', choices([unset, ['three_shunt', '三电阻'], ['two_shunt', '双电阻'], ['single_shunt', '单电阻'], ['inline', '相线采样']]), 'init', '单电阻等方案需要额外的调制与重构时序验证。'),
    number('busVoltageV', '设计母线电压', 'V', 'init', '设计输入，不能代替运行时母线采样和过欠压检查。', { min: 0 }),
    number('currentGain', '电流测量链增益', 'V/A', 'init', '由分流电阻和模拟增益确定，偏置另行校准。', { min: 0 }),
    number('pwmHz', 'PWM 频率', 'Hz', 'init', '时序的唯一来源；电流环频率按分频派生。', { min: 0, group:'timing' }),
    integer('currentLoopDivider', '电流环分频', 'init', '每 N 个 PWM 周期执行一次电流环；观测器跟随电流环。', { group:'timing' }),
    integer('adcBits', 'ADC 分辨率', 'init', '按 MCU 支持的转换分辨率选择；更高分辨率会影响转换时间。', { unit:'bit', group:'timing' }),
    number('adcClockHz', 'ADC 时钟', 'Hz', 'init', '时钟选择不能单独证明采样和转换可在窗口内完成。', { min:0, group:'timing' }),
    number('deadtimeNs', 'PWM 死区', 'ns', 'init', '实际范围和分辨率由驱动方式及定时器确认。', { min:0, group:'timing' }),
  ]
};
