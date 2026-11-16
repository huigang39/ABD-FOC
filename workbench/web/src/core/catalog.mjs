import { checkAlgorithmChildren, CHILD_TYPES } from '../modules/algorithm/children.mjs';
import { checkAlgorithmPaths } from '../modules/algorithm/foc-lifecycle/paths.mjs';
import { checkCoreConfigShape } from '../modules/hardware/hw-platform/cores.mjs';
import { checkResourceShape } from '../modules/hardware/hw-board/resources.mjs';
import { checkTripShape } from '../modules/hardware/hw-safety/paths.mjs';
import { checkDriverCommandShape } from '../modules/hardware/hw-drivers/protocol.mjs';
import { checkCustomDriverShape } from '../modules/hardware/hw-drivers/custom-drivers.mjs';
import { select, choices, unset } from '../modules/shared/fields.mjs';
export { MODULES, MODULE_IDS } from '../modules/registry.mjs';
/** Shared module metadata for project configuration and reusable driver profiles. */
export const LAYERS = Object.freeze([
  { id: 'app', name: '应用层', subtitle: '任务、控制与系统策略', color: '#365dc1', order: 1 },
  { id: 'foc', name: '算法层', subtitle: '反馈、观测与电流环控制周期', color: '#127f73', order: 2 },
  { id: 'hardware', name: '硬件层', subtitle: 'MCU、PCBA 与实时外设', color: '#966024', order: 3 },
]);

export const TARGET_FIELDS = Object.freeze([
  select('vendor', 'MCU 厂商', choices([unset, ['st', 'ST'], ['hpmicro', '先楫 HPMicro'], ['other', '其他']]), 'compile', '选型信息不会自动证明外设能力或实时性能。'),
  { key: 'mcu', label: 'MCU 型号', type: 'text', phase: 'compile', description: '选择已维护的 MCU 型号；生成支持范围由构建检查确认。', required: true, defaultValue: '' },
  { key: 'board', label: '版本', type: 'text', phase: 'init', description: '填写驱动器版本字符串，例如 V1.0 或 Rev.A。', required: true, defaultValue: '' },
]);

const parameterError = message => { throw new Error(message); };
export function checkParameter(value, parameter, location) {
  if (value === null) return;
  switch (parameter.type) {
    case 'algorithm-children': { const moduleId=location?.split('.').at(-2); checkAlgorithmChildren(value,Object.hasOwn(CHILD_TYPES,moduleId)?moduleId:undefined); break; }
    case 'algorithm-paths': checkAlgorithmPaths(value); break;
    case 'core-config': checkCoreConfigShape(value); break;
    case 'resource-list': checkResourceShape(value); break;
    case 'trip-list': checkTripShape(value); break;
    case 'command-list': checkDriverCommandShape(value); break;
    case 'custom-driver-list': checkCustomDriverShape(value); break;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) parameterError(`${location} 必须是有限数字或 null。`); break;
    case 'integer': if (!Number.isSafeInteger(value)) parameterError(`${location} 必须是安全整数或 null。`); break;
    case 'boolean': if (typeof value !== 'boolean') parameterError(`${location} 必须是布尔值或 null。`); break;
    case 'signal-reference':
    case 'text': if (typeof value !== 'string') parameterError(`${location} 必须是文本或 null。`); break;
    case 'select': if (!parameter.options.some(option => option.value === value)) parameterError(`${location} 不是允许的选项。`); break;
    case 'multiselect':
      if (!Array.isArray(value) || value.some(item => !parameter.options.some(option => option.value === item)) || new Set(value).size !== value.length) parameterError(`${location} 必须是不重复的合法选项数组。`);
      break;
    default: parameterError(`不支持的参数类型：${parameter.type}`);
  }
}
