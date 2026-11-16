/**
 * Editable interface proposals, not generated C ABI layouts or encoded bus frames.
 * Byte estimates sum packed application fields only: no alignment, CAN ID, DLC,
 * framing, CRC bytes, segmentation, retransmission or timing implementation.
 * Classical CAN: up to 8 data bytes; CAN FD: up to 64 data bytes (Bosch):
 * https://www.bosch-semiconductors.com/products/ip-modules/can-protocols/can-fd/
 * UART framing / CRC must be defined by the application protocol (Analog Devices):
 * https://www.analog.com/en/resources/analog-dialogue/articles/uart-a-hardware-communication-protocol.html
 */
import { checkScheduleShape } from '../features/configuration/schedule.mjs';
import { ensureModuleContracts, checkModuleContractsShape } from './module-contracts.mjs';
import { MODULE_IDS as CATALOG_MODULE_IDS } from './catalog.mjs';
import { getActiveActuator, getActiveDriver } from '../features/equipment/model.mjs';
const MODULE_IDS = new Set(CATALOG_MODULE_IDS);
const CHECK_IDS = ['build', 'timing', 'trip', 'calibration', 'closed_loop'];
const BYTES = Object.freeze({ u8: 1, u16: 2, u32: 4, i16: 2, i32: 4, f32: 4, bool: 1 });
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const fail = message => { throw new Error(message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function object(value, keys, location) {
  if (!plain(value)) fail(`${location} 必须是对象。`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${location} 含未知字段：${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${location} 缺少字段：${key}`);
}
function string(value, location) { if (typeof value !== 'string') fail(`${location} 必须是文本。`); }
function integer(value, location, nullable = false) { if (!(nullable && value === null) && !Number.isSafeInteger(value)) fail(`${location} 必须是安全整数${nullable ? '或 null' : ''}。`); }
function numeric(value, location, nullable = false) { if (!(nullable && value === null) && (typeof value !== 'number' || !Number.isFinite(value))) fail(`${location} 必须是有限数字${nullable ? '或 null' : ''}。`); }
function choice(value, options, location) { if (!options.includes(value)) fail(`${location} 不是允许的选项。`); }
function boolean(value, location) { if (typeof value !== 'boolean') fail(`${location} 必须是布尔值。`); }
function array(value, location) { if (!Array.isArray(value)) fail(`${location} 必须是数组。`); }

export function createField(id = uid('field')) {
  return { id, name: '', type: 'f32', count: 1, unit: '', meaning: '' };
}
export function createStructure(id = uid('structure')) {
  return { id, name: '', owner: '', consumers: [], description: '', rate: 'event', fields: [] };
}
export function createFault(id = uid('fault')) {
  return { id, code: 0, name: '', source: '', severity: 'error', action: 'stop', latched: true, recovery: 'command', description: '' };
}
export function createMessage(id = uid('message')) {
  return { id, opcode: 0, name: '', direction: 'command', payload: '', periodMs: null, ack: false, description: '' };
}
function template(id, name, owner, consumers, rate, description, fields) {
  return { id, name, owner, consumers, rate, description, fields: fields.map(([name, type, count, unit, meaning]) => ({ id: `${id}-${name}`, name, type, count, unit, meaning })) };
}

export function createDesign() {
  return ensureModuleContracts({
    structures: [
      template('sample-frame', 'SampleFrame', 'hw-board', ['foc-feedback', 'foc-current'], 'fast', '统一时序域交付的采样快照提案；有效通道与布局需按采样拓扑调整。电机侧角度与输出轴角度分别表达。', [
        ['sequence', 'u32', 1, '', '采样序号，检测重复或丢失'], ['sample_time_us', 'u32', 1, 'us', '采样时刻；时基、回绕处理待实现'], ['phase_current', 'f32', 3, 'A', '相电流提案；拓扑可能需要先重构'], ['bus_voltage', 'f32', 1, 'V', '对应采样的母线电压'], ['motor_angle', 'f32', 1, 'rad', '电机侧机械角；无传感器时通过有效标志声明缺失'], ['output_angle', 'f32', 1, 'rad', '出轴侧角度；不能替代电机侧电角度'], ['valid_flags', 'u16', 1, '', '通道有效性；位定义待设计'],
      ]),
      template('drive-feedback', 'DriveFeedback', 'hw-board', ['foc-feedback', 'foc-observer', 'foc-current'], 'fast', '记录实际已生效的 PWM 与门极状态。记录来自定时器生效结果，不能回传尚未锁存的下一周期给定，也不等于实测端电压。', [
        ['applied_sequence', 'u32', 1, '', '已生效更新的序号'], ['applied_time_us', 'u32', 1, 'us', '本组输出生效时刻'], ['duty', 'f32', 3, '', '实际锁存的三相占空比'], ['gate_enabled', 'bool', 1, '', '实际门极许可状态'], ['bus_voltage', 'f32', 1, 'V', '输出期间对应母线电压'], ['valid', 'bool', 1, '', '输出历史是否可信'],
      ]),
      template('observer-input', 'ObserverSamples', 'foc-feedback', ['foc-observer'], 'fast', '电压/电流模型观测器的输入提案，按所选算法裁剪，并非所有观测器的必需字段。电压必须对应实际已生效输出与采样时间；可由有效 PWM、母线和门极状态估算，不能使用待发送的电压指令。', [
        ['sample_sequence', 'u32', 1, '', '对应电流样本序号'], ['sample_time_us', 'u32', 1, 'us', '对应电流采样时刻'], ['current_ab', 'f32', 2, 'A', '静止坐标系电流'], ['applied_voltage_ab', 'f32', 2, 'V', '与样本时间对齐的已生效电压估计；非未来指令'], ['applied_sequence', 'u32', 1, '', '关联输出历史记录'], ['voltage_time_us', 'u32', 1, 'us', '电压估计对应输出时间，明确采样/计算延迟'], ['dt', 'f32', 1, 's', '真实更新间隔'], ['valid', 'bool', 1, '', '输入时间与通道有效性'],
      ]),
      template('observer-state', 'ObserverEstimate', 'foc-observer', ['foc-feedback', 'app-motion'], 'fast', '统一估算状态提案；置信度与锁定判据按算法定义，失效时不能静默继续使用旧角度。', [
        ['sequence', 'u32', 1, '', '估算对应的样本序号'], ['electrical_angle', 'f32', 1, 'rad', '估算电角度，定义旋转正方向'], ['electrical_speed', 'f32', 1, 'rad/s', '估算电角速度'], ['confidence', 'f32', 1, '', '算法定义的质量指标'], ['valid', 'bool', 1, '', '是否满足当前运行模式使用条件'],
      ]),
      template('control-ref', 'ControlRef', 'app-motion', ['foc-lifecycle', 'foc-current'], 'control', '应用命令仲裁后的统一给定提案；正常控制与校准互斥，所有来源共用限值与有效期。', [
        ['sequence', 'u32', 1, '', '给定序号'], ['valid_until_us', 'u32', 1, 'us', '有效截止时刻，需约定时基与回绕'], ['id_ref', 'f32', 1, 'A', 'd 轴电流给定'], ['iq_ref', 'f32', 1, 'A', 'q 轴电流给定'], ['current_limit', 'f32', 1, 'A', '应用动态限值，不覆盖电流环独立保护'], ['mode', 'u8', 1, '', '运行/受限校准等模式枚举待定义'],
      ]),
      template('control-status', 'ControlStatus', 'foc-lifecycle', ['app-motion', 'app-safety', 'app-comms'], 'control', '算法层向应用发布的一致性快照；不要求算法读取应用内部状态。', [
        ['sequence', 'u32', 1, '', '快照序号'], ['state', 'u8', 1, '', '生命周期状态枚举待定义'], ['id_measured', 'f32', 1, 'A', 'd 轴反馈'], ['iq_measured', 'f32', 1, 'A', 'q 轴反馈'], ['motor_speed', 'f32', 1, 'rad/s', '电机侧机械角速度'], ['fault_flags', 'u32', 1, '', '当前故障摘要，详细记录独立上报'],
      ]),
      template('fault-event', 'FaultEvent', 'app-safety', ['app-params', 'app-comms'], 'event', '聚合故障记录提案；硬件关断先执行，日志和上报异步完成，不能让 Flash 写入阻塞电流环。', [
        ['code', 'u32', 1, '', '对应错误码表'], ['time_us', 'u32', 1, 'us', '故障时刻，时基待约定'], ['severity', 'u8', 1, '', '等级编码待定义'], ['latched', 'bool', 1, '', '是否保持故障锁存'],
      ]),
    ],
    faults: [
      { id: 'hardware-overcurrent', code: 4097, name: 'HARDWARE_OVERCURRENT', source: 'hw-safety', severity: 'critical', action: 'trip', latched: true, recovery: 'power_cycle', description: '独立硬件过流关断；复位条件需结合功率级评审。' },
      { id: 'feedback-invalid', code: 8193, name: 'FEEDBACK_INVALID', source: 'foc-current', severity: 'error', action: 'stop', latched: true, recovery: 'command', description: '反馈失效后停止输出，恢复条件由算法管理模块检查。' },
      { id: 'command-timeout', code: 12289, name: 'COMMAND_TIMEOUT', source: 'app-safety', severity: 'error', action: 'stop', latched: true, recovery: 'command', description: '命令超时触发停机；不能因迟到旧帧自动重新运行。' },
    ],
    protocol: {
      transport: 'unselected', version: 1, byteOrder: 'little', nodeId: null, bitrate: null, timeoutMs: null, integrity: 'unselected',
      messages: [
        { id: 'control-command', opcode: 1, name: 'SetControl', direction: 'command', payload: 'control-ref', periodMs: null, ack: true, description: '应用消息草案：进入应用仲裁，不能直接写 PWM。字段编码与总线映射尚未实现。' },
        { id: 'status-report', opcode: 2, name: 'ControlTelemetry', direction: 'telemetry', payload: 'control-status', periodMs: null, ack: false, description: '应用消息草案：上报一致性控制快照；周期待确定。' },
        { id: 'fault-report', opcode: 3, name: 'FaultReport', direction: 'telemetry', payload: 'fault-event', periodMs: null, ack: false, description: '应用消息草案：故障事件上报；null 周期表示尚未约定事件或周期发送。' },
      ],
    },
  });
}

export function checkDesignShape(design) {
  object(design, ['structures', 'faults', 'protocol', 'moduleContracts', 'layerInterfaces', 'privateStructures', 'schedule'], 'design');
  checkModuleContractsShape(design);
  checkScheduleShape(design.schedule);
  array(design.structures, 'design.structures');
  for (const [i, item] of design.structures.entries()) {
    const at = `design.structures[${i}]`;
    object(item, ['id', 'name', 'owner', 'consumers', 'description', 'rate', 'fields'], at);
    for (const key of ['id', 'name', 'owner', 'description']) string(item[key], `${at}.${key}`);
    choice(item.rate, ['fast', 'control', 'event'], `${at}.rate`);
    array(item.consumers, `${at}.consumers`); item.consumers.forEach((v, n) => string(v, `${at}.consumers[${n}]`));
    array(item.fields, `${at}.fields`);
    for (const [j, field] of item.fields.entries()) {
      const path = `${at}.fields[${j}]`;
      object(field, ['id', 'name', 'type', 'count', 'unit', 'meaning'], path);
      for (const key of ['id', 'name', 'unit', 'meaning']) string(field[key], `${path}.${key}`);
      choice(field.type, Object.keys(BYTES), `${path}.type`); integer(field.count, `${path}.count`);
    }
  }
  array(design.faults, 'design.faults');
  for (const [i, fault] of design.faults.entries()) {
    const at = `design.faults[${i}]`;
    object(fault, ['id', 'code', 'name', 'source', 'severity', 'action', 'latched', 'recovery', 'description'], at);
    for (const key of ['id', 'name', 'source', 'description']) string(fault[key], `${at}.${key}`);
    integer(fault.code, `${at}.code`); boolean(fault.latched, `${at}.latched`);
    choice(fault.severity, ['info', 'warning', 'error', 'critical'], `${at}.severity`);
    choice(fault.action, ['report', 'derate', 'stop', 'trip'], `${at}.action`);
    choice(fault.recovery, ['automatic', 'command', 'power_cycle'], `${at}.recovery`);
  }
  const p = design.protocol;
  object(p, ['transport', 'version', 'byteOrder', 'nodeId', 'bitrate', 'timeoutMs', 'integrity', 'messages'], 'design.protocol');
  choice(p.transport, ['unselected', 'can', 'canfd', 'uart', 'ethercat', 'ethernet'], 'design.protocol.transport');
  integer(p.version, 'design.protocol.version');
  choice(p.byteOrder, ['little', 'big'], 'design.protocol.byteOrder');
  integer(p.nodeId, 'design.protocol.nodeId', true); integer(p.bitrate, 'design.protocol.bitrate', true); numeric(p.timeoutMs, 'design.protocol.timeoutMs', true);
  choice(p.integrity, ['unselected', 'transport_crc', 'crc16_ccitt'], 'design.protocol.integrity');
  array(p.messages, 'design.protocol.messages');
  for (const [i, message] of p.messages.entries()) {
    const at = `design.protocol.messages[${i}]`;
    object(message, ['id', 'opcode', 'name', 'direction', 'payload', 'periodMs', 'ack', 'description'], at);
    for (const key of ['id', 'name', 'payload', 'description']) string(message[key], `${at}.${key}`);
    integer(message.opcode, `${at}.opcode`); numeric(message.periodMs, `${at}.periodMs`, true); boolean(message.ack, `${at}.ack`);
    choice(message.direction, ['command', 'telemetry', 'response'], `${at}.direction`);
  }
}

export function checkCommissioningShape(commissioning) {
  object(commissioning, ['checks'], 'commissioning');
  if (!plain(commissioning.checks)) fail('commissioning.checks 必须是对象。');
  for (const [id, record] of Object.entries(commissioning.checks)) {
    if (!CHECK_IDS.includes(id)) fail(`commissioning.checks 含未知字段：${id}`);
    const at = `commissioning.checks.${id}`;
    object(record, ['status', 'note', 'fingerprint', 'updatedAt'], at);
    choice(record.status, ['pending', 'passed', 'failed'], `${at}.status`);
    for (const key of ['note', 'fingerprint', 'updatedAt']) string(record[key], `${at}.${key}`);
  }
}

/** Packed application-field byte estimate; never a native C struct size. */
export function getStructureSize(structure) {
  if (!Array.isArray(structure?.fields)) return null;
  let size = 0;
  for (const field of structure.fields) {
    if (!field || !Object.hasOwn(BYTES, field.type) || !Number.isSafeInteger(field.count) || field.count < 1) return null;
    size += BYTES[field.type] * field.count;
    if (!Number.isSafeInteger(size)) return null;
  }
  return size;
}

export function validateDesign(project) {
  const issues = [];
  const add = (id, level, title, message, designPage, itemId) => issues.push({ id: `design-${id}`, level, title, message, designPage, ...(itemId ? { itemId } : {}) });
  try { checkDesignShape(project?.design); } catch (error) { add('shape', 'error', '接口设计结构不合法', error.message, 'structures'); return issues; }
  const { structures, faults, protocol } = project.design;
  const moduleStructureIds = new Set([...Object.values(project.design.moduleContracts).flatMap(refs => Object.values(refs)), ...project.design.privateStructures]);
  const duplicate = (items, key, page, label, prefix, ownerId) => {
    const seen = new Set();
    items.forEach((item, index) => {
      const raw = item[key], value = typeof raw === 'string' ? raw.trim() : raw;
      if (value === '') add(`${prefix}-${key}-empty-${index}`, 'pending', `${label}待填写`, '空白字段表示设计尚未完成。', page, ownerId || item.id);
      else if (seen.has(value)) add(`${prefix}-${key}-duplicate-${index}`, 'error', `${label}重复`, `重复值：${String(value)}。请分配唯一值。`, page, ownerId || item.id);
      seen.add(value);
    });
  };
  const moduleReference = (value, label, page, id, suffix) => {
    if (!value) add(`${suffix}-missing`, 'pending', `${label}待确定`, '请选择已定义的模块。', page, id);
    else if (!MODULE_IDS.has(value)) add(`${suffix}-unknown`, 'error', `${label}不存在`, `未定义模块：${value}。`, page, id);
  };
  if (!structures.length) add('structures-empty', 'pending', '接口结构尚未设计', '至少明确层间传递的数据及所有权。', 'structures');
  duplicate(structures, 'id', 'structures', '结构 ID', 'structure'); duplicate(structures, 'name', 'structures', '结构名称', 'structure');
  structures.forEach((structure, index) => {
    const prefix = `structure-${index}`;
    moduleReference(structure.owner, '结构所有者', 'structures', structure.id, `${prefix}-owner`);
    structure.consumers.forEach((consumer, n) => moduleReference(consumer, '消费模块', 'structures', structure.id, `${prefix}-consumer-${n}`));
    if (new Set(structure.consumers).size !== structure.consumers.length) add(`${prefix}-consumers-duplicate`, 'warning', '消费模块重复', '同一结构不需要重复列出相同消费模块。', 'structures', structure.id);
    if (!structure.fields.length && !moduleStructureIds.has(structure.id)) add(`${prefix}-fields-empty`, 'pending', '结构字段待设计', '空结构无法估算载荷或约定数据语义。', 'structures', structure.id);
    duplicate(structure.fields, 'id', 'structures', '字段 ID', `${prefix}-field`, structure.id); duplicate(structure.fields, 'name', 'structures', '字段名称', `${prefix}-field`, structure.id);
    structure.fields.forEach((field, n) => {
      if (field.count < 1) add(`${prefix}-field-${n}-count`, 'error', '字段数量必须为正整数', `${field.name || '未命名字段'} 的元素数量无效。`, 'structures', structure.id);
      if (!field.meaning.trim()) add(`${prefix}-field-${n}-meaning`, 'pending', '字段含义待说明', `请说明 ${field.name || '未命名字段'} 的有效性、坐标或数值含义。`, 'structures', structure.id);
    });
    if (getStructureSize(structure) === null) add(`${prefix}-size`, 'error', '载荷大小无法估算', '请检查字段数量及总量是否为安全整数。', 'structures', structure.id);
  });
  if (!faults.length) add('faults-empty', 'pending', '错误码尚未设计', '请定义关键故障的来源、动作和恢复条件。', 'faults');
  for (const key of ['id', 'code', 'name']) duplicate(faults, key, 'faults', { id: '故障 ID', code: '错误码', name: '故障名称' }[key], 'fault');
  faults.forEach((fault, index) => {
    const prefix = `fault-${index}`;
    moduleReference(fault.source, '故障来源', 'faults', fault.id, `${prefix}-source`);
    if (fault.code < 0) add(`${prefix}-code-negative`, 'error', '错误码不能为负数', '错误码数值宽度与线协议映射仍需另行约定。', 'faults', fault.id);
    if (fault.severity === 'critical' && fault.action === 'report') add(`${prefix}-critical-action`, 'error', '严重故障不能只上报', '严重故障需要明确处置动作；上报不能替代停止或关断策略。', 'faults', fault.id);
  });
  if (protocol.transport === 'unselected') add('protocol-transport', project.instances?.['app-comms']?.enabled ? 'pending' : 'info', '通信传输方式待确定', '通信模块启用后，需要选择传输方式并定义总线帧与传输适配。', 'protocol');
  else {
    const comms = project.instances?.['app-comms'];
    if (!comms?.enabled) add('protocol-module', 'error', '通信模块尚未启用', '已选择协议传输方式，需要启用应用通信模块。', 'protocol');
    const bus = comms?.parameters?.bus;
    if (!bus || bus === 'unselected') add('protocol-module-bus', 'pending', '应用总线选择待确定', '协议传输方式与应用通信配置须保持一致。', 'protocol');
    else if (bus !== protocol.transport) add('protocol-bus-mismatch', 'error', '通信传输方式不一致', `协议选择 ${protocol.transport}，应用通信选择 ${bus}。`, 'protocol');
    for (const key of ['nodeId', 'bitrate', 'timeoutMs']) if (protocol[key] === null) add(`protocol-${key}`, 'pending', '通信参数待确定', `${key} 尚未定义；不会以零代替未知值。`, 'protocol');
    if (protocol.integrity === 'unselected') add('protocol-integrity', 'pending', '完整性策略待确定', '需要明确使用传输层 CRC 或应用校验，并设计丢帧与重放处理。', 'protocol');
    if (protocol.transport === 'uart' && protocol.integrity === 'transport_crc') add('protocol-uart-integrity', 'error', 'UART 需要应用完整性方案', '当前模型的普通 UART 传输不提供整条应用消息 CRC；请选择应用 CRC 并定义分帧格式。', 'protocol');
    const timeout = comms?.parameters?.timeoutMs;
    if (typeof timeout === 'number' && protocol.timeoutMs !== null && protocol.timeoutMs !== timeout) add('protocol-timeout-mismatch', 'error', '命令超时定义不一致', '协议命令超时与应用通信模块的命令超时应一致。', 'protocol');
  }
  if (protocol.version < 1) add('protocol-version', 'error', '协议版本应为正整数', '协议版本是应用格式标识，不是总线标准版本。', 'protocol');
  if (protocol.nodeId !== null && protocol.nodeId < 0) add('protocol-node-negative', 'error', '节点编号不能为负数', '节点编号不是直接映射的 CAN 仲裁 ID；总线映射尚未实现。', 'protocol');
  for (const key of ['bitrate', 'timeoutMs']) if (protocol[key] !== null && protocol[key] <= 0) add(`protocol-${key}-positive`, 'error', '通信参数必须大于零', `${key} 的零值不能代表尚未确定。`, 'protocol');
  if (protocol.integrity === 'crc16_ccitt') add('protocol-crc-definition', 'pending', 'CRC 参数与覆盖范围待约定', 'CRC16-CCITT 名称不足以唯一决定初值、反射、异或输出、校验字节序及覆盖范围；编码器尚未实现。', 'protocol');
  if (!protocol.messages.length) add('messages-empty', 'pending', '应用消息尚未设计', '请定义命令、反馈或事件载荷。', 'protocol');
  for (const key of ['id', 'opcode', 'name']) duplicate(protocol.messages, key, 'protocol', { id: '消息 ID', opcode: '操作码', name: '消息名称' }[key], 'message');
  const structureMap = new Map(structures.map(s => [s.id, s]));
  protocol.messages.forEach((message, index) => {
    const prefix = `message-${index}`;
    if (message.opcode < 0) add(`${prefix}-opcode-negative`, 'error', '操作码不能为负数', '操作码编码宽度仍需在传输适配中约定。', 'protocol', message.id);
    if (!message.payload) add(`${prefix}-payload-missing`, 'pending', '消息载荷待确定', '请引用一个数据结构。', 'protocol', message.id);
    else if (!structureMap.has(message.payload)) add(`${prefix}-payload-unknown`, 'error', '消息引用了不存在的结构', `未定义结构：${message.payload}。`, 'protocol', message.id);
    if (message.periodMs !== null && message.periodMs <= 0) add(`${prefix}-period-positive`, 'error', '消息周期必须大于零', '未知或尚未约定的事件周期保留 null，不能填零。', 'protocol', message.id);
    const limit = protocol.transport === 'can' ? 8 : protocol.transport === 'canfd' ? 64 : null;
    const size = getStructureSize(structureMap.get(message.payload));
    if (limit !== null && size !== null && size > limit) add(`${prefix}-payload-limit`, 'error', '应用载荷超过单帧数据容量', `紧凑字段估计 ${size} 字节，${protocol.transport === 'can' ? '经典 CAN' : 'CAN FD'} 单帧最多 ${limit} 数据字节；需要拆分消息或设计分片，当前未实现。此估计不添加假定帧头或 CRC。`, 'protocol', message.id);
  });
  add('protocol-draft', 'info', '应用消息草案，尚无传输实现', '字节数仅按紧凑字段估计，不代表 C 内存布局或标准 CAN 帧。分帧、DLC、分片、CRC 编码及总线映射均未实现。', 'protocol');
  return issues;
}

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
/** Non-cryptographic change detector; manual evidence is not hardware verification. */
export function configurationFingerprint(project) {
  const shelf = project?.catalog;
  const assembly = shelf?.assemblies?.find(item => item.id === shelf.activeAssemblyId) || null;
  const catalog = shelf ? {
    activeAssemblyId: shelf.activeAssemblyId || '',
    activeActuatorId: shelf.activeActuatorId || assembly?.actuatorId || '',
    activeDriverId: shelf.activeDriverId || assembly?.driverId || '',
    assembly, actuator: getActiveActuator(project), driver: getActiveDriver(project),
  } : undefined;
  // Selected release declarations identify the current intended combination. An
  // unused history entry, its notes, or host-side operation drafts do not change firmware.
  const layerVersions = Object.fromEntries(['hardware', 'foc', 'app'].map(layer => {
    const selectedId = project?.layerVersions?.selected?.[layer] || '';
    const release = project?.layerVersions?.releases?.find(item => item.id === selectedId && item.layer === layer);
    return [layer, { selectedId, ...(release ? { version: release.version, interfaceVersion: release.interfaceVersion, requires: release.requires } : {}) }];
  }));
  const text = canonical({ schemaVersion: project?.schemaVersion, target: project?.target, instances: project?.instances, build: project?.build, design: project?.design, catalog, layerVersions, memory: project?.memory, execution: project?.execution });
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) { hash ^= BigInt(text.charCodeAt(i)); hash = BigInt.asUintN(64, hash * 0x100000001b3n); }
  return `cfg2-${hash.toString(16).padStart(16, '0')}`;
}
