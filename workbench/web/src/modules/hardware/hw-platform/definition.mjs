import { CONTRACTS } from './contracts.mjs';
import { choices, unset, select, number } from '../../shared/fields.mjs';

/** MCU 适配：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "hw-platform",
  "layer": "hardware",
  "order": 1,
  "title": "内核",
  "summary": "时钟 · 中断 · RAM / FLASH · 核间协作",
  "role": "适配 MCU 启动与公共时钟，分别设置各核中断、时基、浮点与缓存；管理 RAM、FLASH、模块分工、核间协作、看门狗和复位原因等系统资源。",
  "inputs": "芯片与各核配置、资源需求、存储与系统服务请求。",
  "outputs": "平台能力、存储完成事件、时基与系统状态。",
  "boundary": "隔离 MCU 差异，上层不包含寄存器或 HAL 类型。存储驱动只操作介质，校准、参数、日志的保存策略与看门狗健康判定由应用负责。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "hardware",
  "dependencies": [],
  contracts: CONTRACTS,
  params: [
    select('architecture', '架构', choices([unset, ['arm', 'Arm'], ['riscv', 'RISC-V'], ['other', '其他']]), 'compile', '由 MCU 型号自动识别并随构建使用；界面不单独展示。', { hidden: true }),
    select('clockSource', '主时钟来源', choices([unset, ['external','外部晶振'], ['internal','内部振荡器'], ['bypass','外部有源时钟']]), 'init', '由平台适配计算 PLL 与总线分频。', { group:'clock' }),
    number('oscillatorHz','输入时钟','Hz','init','所选时钟源的实际频率。',{min:1,group:'clock'}),
    number('busClockHz','总线时钟','Hz','init','主总线目标频率。',{min:1,group:'clock'}),
    number('timerClockHz','控制定时器时钟','Hz','init','供 PCBA 的 PWM 和触发时序使用。',{min:1,group:'clock'}),
    {key:'coreConfigs',label:'各核配置',type:'core-config',phase:'init',description:'每个内核独立的时钟、中断、时基、浮点和缓存配置。',required:false,hidden:true,defaultValue:{}},
    number('flashKiB', '可规划的 Flash 总容量', 'KiB', 'init', '填写可用于固件与数据的容量；配置具体扇区后由扇区表管理。', { min: 0, group:'memory' }),
    number('eraseKiB', '规划擦除粒度', 'KiB', 'init', '按统一擦除粒度规划；大小不同的扇区需在部署配置中分别设置。', { min: 0, group:'memory' }),
    number('firmwareReserveKiB', '代码与升级预留', 'KiB', 'init', '包含代码、启动与升级恢复空间；不是编译得到的实际占用。', { min: 0, group:'memory' }),
  ]
};
