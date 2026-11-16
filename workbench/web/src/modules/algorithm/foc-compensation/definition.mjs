import { CONTRACTS } from './contracts.mjs';
import { choices, unset, number, select } from '../../shared/fields.mjs';

/** 摩擦补偿：参数、职责、依赖与默认数据契约的唯一入口。 */
export default {
  "id": "foc-compensation",
  "layer": "foc",
  "order": 5,
  "title": "补偿器",
  "summary": "角度修正 · 电流修正 · 摩擦补偿",
  "role": "按补偿对象启用角度、电流或摩擦子模块；明确反馈修正与给定叠加位置，并保留有效性与限幅状态。",
  "inputs": "电机侧机械角速度、摩擦辨识参数、补偿开关与力矩限值。",
  "outputs": "电机侧补偿力矩、限幅状态与数据有效性。",
  "boundary": "摩擦辨识由应用校准管理完成，补偿模块只使用参数。电机侧力矩到电流的换算、控制注入点与真实电流环实现仍需定义；不把手填系数视为已校准结果。",
  "required": false,
  "runtimeSwitchable": true,
  "executionDomain": "fast",
  "dependencies": [
    "foc-feedback",
    "foc-current"
  ],
  contracts: CONTRACTS,
  params: [
    {key:'children',label:'子模块',type:'algorithm-children',hidden:true,required:false,defaultValue:[],phase:'compile',description:'补偿器内部的补偿子模块集合。'},
    select('frictionModel', '摩擦模型', choices([unset, ['coulomb_viscous', '库仑 + 黏性摩擦']]), 'compile', '先使用库仑与黏性摩擦模型；系数和速度均以电机侧机械量定义。'),
    select('frictionSource', '补偿参数来源', choices([unset, ['stored', '已有辨识数据'], ['identify', '本次执行摩擦辨识']]), 'init', '选择已有数据不要求编译校准模块；本次辨识需启用校准管理中的摩擦辨识。'),
    number('viscousNmPerRadS', '电机侧黏性摩擦系数', 'N·m/(rad/s)', 'runtime', '对应电机机械角速度的黏性摩擦系数；不直接填写出轴侧数值。', { min: 0 }),
    number('coulombNm', '电机侧库仑摩擦力矩', 'N·m', 'runtime', '正反转共用的摩擦幅值，填写非负数；零速附近按平滑带处理。', { min: 0 }),
    number('transitionRadS', '过零平滑速度', 'rad/s', 'runtime', '电机侧机械角速度的过零平滑带，必须大于零。', { min: 0 }),
    number('maxCompensationNm', '电机侧补偿力矩上限', 'N·m', 'runtime', '限制补偿输出幅值，必须大于零；与主控制给定合成后仍需执行总限幅。', { min: 0 }),
  ]
};
