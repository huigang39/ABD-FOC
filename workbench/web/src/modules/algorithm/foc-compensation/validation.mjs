import { calibrationEnabled } from '../../application/app-calibration/validation.mjs';

const COMPENSATION = 'foc-compensation';
const enabled = instance => instance?.enabled === true && instance.runtimeEnabled === true;
const missing = value => value === null || value === undefined || value === '' || value === 'unselected';

/** Configuration checks only; no coefficients, calibration evidence or control outputs are synthesized. */
export function validateCompensation(project) {
  const issues = [];
  const add = (id, level, title, message, paramKey, moduleId = COMPENSATION) => issues.push({ id: `compensation-${id}`, level, title, message, moduleId, ...(paramKey ? { paramKey } : {}) });
  const instance = project.instances?.[COMPENSATION], calibration = project.instances?.['app-calibration'];
  const frictionAllowed = Array.isArray(calibration?.parameters?.procedures) && calibration.parameters.procedures.includes('friction');
  if (!enabled(instance)) {
    if (calibration?.enabled && frictionAllowed) add('identification-only', 'info', '摩擦辨识可独立配置', '补偿关闭时仍可保留摩擦辨识方案，辨识与补偿的运行开关分别管理。', 'procedures', 'app-calibration');
    return issues;
  }
  const params = instance.parameters || {};
  const choices = [
    ['frictionModel', '摩擦模型', ['coulomb_viscous']],
    ['frictionSource', '补偿参数来源', ['stored', 'identify']],
  ];
  for (const [key, label, allowed] of choices) {
    if (missing(params[key])) add(`missing-${key}`, 'pending', `${label}待选择`, `请选择${label}。`, key);
    else if (!allowed.includes(params[key])) add(`invalid-${key}`, 'error', `${label}无效`, `当前${label}不在支持范围内。`, key);
  }
  const quantities = [
    ['viscousNmPerRadS', '电机侧黏性摩擦系数', false],
    ['coulombNm', '电机侧库仑摩擦力矩', false],
    ['transitionRadS', '过零平滑速度', true],
    ['maxCompensationNm', '电机侧补偿力矩上限', true],
  ];
  for (const [key, label, strictlyPositive] of quantities) {
    const value = params[key];
    if (missing(value)) add(`missing-${key}`, 'pending', `${label}待填写`, params.frictionSource === 'identify' && ['viscousNmPerRadS', 'coulombNm'].includes(key) ? '摩擦辨识完成后记录电机侧参数；当前保持未知。' : `请填写${label}，不要以默认值代替实际配置。`, key);
    else if (typeof value !== 'number' || !Number.isFinite(value) || (strictlyPositive ? value <= 0 : value < 0)) add(`range-${key}`, 'error', `${label}超出范围`, `${label}必须是${strictlyPositive ? '大于零' : '非负'}的有限数。`, key);
  }
  if (params.frictionSource === 'identify') {
    if (!calibrationEnabled(project, 'friction')) add('identification-required', 'error', '本次摩擦辨识需要校准管理', '编译包含并运行启用校准管理，同时将摩擦辨识加入编译项目和运行允许项目。', 'enabledProcedures', 'app-calibration');
    else add('identification-unverified', 'pending', '摩擦辨识结果尚未取得', '需要实际执行摩擦辨识、检查结果并保存数据；选择本次辨识不会直接产生补偿系数。', 'frictionSource');
  } else if (params.frictionSource === 'stored') {
    add('stored-data-unverified', 'pending', '已有摩擦数据有效性待核对', '需核对辨识数据、执行器配置和电机侧量纲。手填系数不代表已经校准，真实数据读取与校验尚未接入。', 'frictionSource');
  }
  add('runtime-unverified', 'pending', '补偿注入与限幅尚未联调', '补偿力矩以电机侧 N·m 定义。力矩到电流的换算、实际控制注入点、过零平滑及合成给定的总限幅仍需实现并验证。');
  return issues;
}
