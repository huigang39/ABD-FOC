import { CONTRACTS } from './contracts.mjs';
import { choices, unset, number, select } from '../../shared/fields.mjs';

/** 参数管理：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "app-params",
  "layer": "app",
  "order": 6,
  "title": "备份",
  "summary": "参数字典 · 标零 · 数据恢复",
  "role": "管理参数类型、单位、范围和修改条件，以及出轴标零、力矩标零；为校准、参数、日志提供独立的数据格式、提交与恢复策略。",
  "inputs": "参数请求、校准结果、诊断记录。",
  "outputs": "分层配置事务、参数快照、保存与恢复状态。",
  "boundary": "每层拥有自己的校验规则；运行时生效与 Flash 保存分别确认，恢复默认参数保留校准区。",
  "required": true,
  "runtimeSwitchable": false,
  "executionDomain": "background",
  "dependencies": [
    "hw-platform"
  ],
  contracts: CONTRACTS,
  params: [
    { key:'zeroing', label:'标零项目', type:'multiselect', phase:'runtime', options:choices([['output_zero','出轴标零'],['torque_zero','力矩标零']]), defaultValue:[], required:false, description:'标零结果归参数区，不属于编码器校准；配置功能不代表向设备发起标零。' },
    number('zeroSamples','标零样本数','','init','静止时采集有效样本，标零结果保存到参数区。',{min:1,max:65536,step:1,defaultValue:128,required:false}),

    number('motionCalibrationKiB', '校准', 'KiB', 'init', '编码器校准（含电角度零位）、摩擦辨识等校准结果；容量包含记录头与提交标记。', { min: 0 }),
    number('parametersKiB', '参数', 'KiB', 'init', '配置参数及出轴、力矩标零；与编码器校准数据分开保存。', { min: 0 }),
    number('runtimeRecordsKiB', '日志', 'KiB', 'init', '快照与日志分别管理；不能承诺突然失电时完成最后一次保存。', { min: 0 }),
    select('commitStrategy', '关键数据提交方式', choices([unset, ['dual_copy', '双副本提交'], ['journal', '追加记录提交']]), 'compile', '追加记录以校验和提交标记识别完整写入；单扇区写满后的擦除需单独执行。'),
  ]
};
