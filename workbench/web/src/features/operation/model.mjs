/** Host control configuration only. No connection state, telemetry or command effects. */
export const OPERATION_TRANSPORTS = Object.freeze(['unselected', 'canfd', 'ethercat', 'ethernet']);
export const OPERATION_MODES = Object.freeze(['disabled', 'position', 'speed', 'torque', 'impedance']);
const numericFields = ['periodMs', 'positionRad', 'speedRadS', 'torqueNm', 'kp', 'kd'];
const fields = ['transport', 'adapter', 'address', 'nodeId', 'periodMs', 'mode', 'positionRad', 'speedRadS', 'torqueNm', 'kp', 'kd'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function createOperation() {
  return {
    transport: 'unselected', adapter: '', address: '', nodeId: null, periodMs: null,
    mode: 'disabled', positionRad: null, speedRadS: null, torqueNm: null, kp: null, kd: null,
  };
}

/** Structural validation preserves editable drafts; ranges depend on the actual protocol. */
export function checkOperationShape(value) {
  if (!plain(value)) throw new Error('operation 必须是对象。');
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw new Error(`operation 含未知字段：${key}`);
  for (const key of fields) if (!Object.hasOwn(value, key)) throw new Error(`operation 缺少字段：${key}`);
  if (!OPERATION_TRANSPORTS.includes(value.transport)) throw new Error('operation.transport 不是允许的接口类型。');
  if (!OPERATION_MODES.includes(value.mode)) throw new Error('operation.mode 不是允许的给定模式。');
  for (const key of ['adapter', 'address']) if (typeof value[key] !== 'string') throw new Error(`operation.${key} 必须是文本。`);
  if (value.nodeId !== null && !Number.isSafeInteger(value.nodeId)) throw new Error('operation.nodeId 必须是安全整数或 null。');
  for (const key of numericFields) if (value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) throw new Error(`operation.${key} 必须是有限数字或 null。`);
  return true;
}
