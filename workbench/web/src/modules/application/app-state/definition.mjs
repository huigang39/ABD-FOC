import { CONTRACTS } from './contracts.mjs';
import { choices, unset, select } from '../../shared/fields.mjs';
import { CIA402_MODES } from './cia402.mjs';
export default {
 id:'app-state',layer:'app',order:2,title:'状态机',summary:'驱动状态 · CiA 402 · 运行许可',role:'管理待机、运行与故障状态，根据使能、就绪和异常条件更新运行许可。',inputs:'使能请求、就绪状态、异常与复位请求。',outputs:'运行许可、故障锁存与状态反馈。',boundary:'复位不自动使能；CiA 402 与通信状态机分别管理。',required:true,runtimeSwitchable:false,executionDomain:'application',dependencies:['app-runtime','app-safety'],contracts:CONTRACTS,params:[
    select('stateMachine', '驱动状态机', choices([unset, ['local', '本地状态机'], ['cia402', 'CiA 402']]), 'compile', 'CiA 402 管理驱动使能、快停与故障；与 EtherCAT 通信状态分别处理。', { required: false }),
    { key: 'cia402Modes', label: 'CiA 402 模式', type: 'multiselect', options: CIA402_MODES, phase: 'runtime', description: '设置已实现模式的运行许可，不能启用固件未实现的模式。正数编号为标准模式；标记「自定义」的为当前驱动扩展模式，使用独立的负数编号。', required: false, defaultValue: [] },
    select('cia402DefaultMode', '默认操作模式', choices([['none', '等待主站指定'], ...CIA402_MODES.map(mode => [mode.value, mode.label])]), 'init', '仅定义模式选择；上电仍保持输出关闭，主站需完成状态机使能。', { defaultValue: 'none', required: false }),
 ]
};
