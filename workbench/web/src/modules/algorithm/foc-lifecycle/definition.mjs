import { number } from '../../shared/fields.mjs';
import { CONTRACTS } from './contracts.mjs';
/** 算法异常：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "foc-lifecycle",
  "layer": "foc",
  "order": 5,
  "title": "异常",
  "summary": "异常汇总 · 故障锁存 · 输出许可",
  "role": "汇总算法故障标志，检查反馈有效性、硬件就绪与校准状态；锁存异常并撤销输出许可，停机且当前故障解除后接受显式复位。",
  "inputs": "模块故障标志、反馈有效性、硬件与校准就绪、使能和复位请求。",
  "outputs": "输出许可、锁存故障标志和控制状态。",
  "boundary": "统一管理电流越限、给定超时、反馈失效与数值异常；各计算模块只保留安全返回与有效性状态，本模块负责异常判定、汇总与输出门控，不替代硬件关断，也不在电流环中写入日志。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "fast",
  "dependencies": [
    "foc-feedback",
    "foc-current",
    "foc-modulation",
    "hw-board"
  ],
  contracts: CONTRACTS,
  params: [
    {key:'protectionPaths',label:'算法保护路径',type:'algorithm-paths',phase:'runtime',hidden:true,required:false,defaultValue:[],description:'算法异常模块的内部保护路径集合。'},
    number('referenceTimeoutMs', '电流环给定有效期', 'ms', 'runtime', '须覆盖应用控制任务的正常更新间隔，并检查给定序号。', { min: 0, hidden:true, required:false }),
    number('maxCurrentA', '电流保护阈值', 'A', 'init', '独立于控制器限幅；仍需匹配采样量程和功率级。', { min: 0, hidden:true, required:false }),
  ]
};
