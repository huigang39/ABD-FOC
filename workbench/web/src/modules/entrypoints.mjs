/** Public C entry points. The editor and generator share these names. */
const ENTRY_COMMENTS = {
  "state_machine.step": "异常检查完成后、控制环前调用，更新驱动状态与运行许可；故障复位不自动使能。",
  "core.step": "平台启动完成后或时基事件到达时调用，读取启动、复位和时钟状态，更新平台就绪结果。",
  "peripherals.sample": "ADC 采样完成后调用，接收已换算的相电流、母线电压与采样时间，输出本周期采样快照；此入口不直接启动 ADC。",
  "peripherals.apply": "电压调制完成后调用，依据占空比请求、输出许可和故障状态形成 PWM 输出命令，由平台适配器写入定时器。",
  "drivers.step": "接收完成、采样请求或超时检查时调用，处理当前器件通道的通信状态，更新接收结果及发送请求。",
  "protection.step": "硬件故障事件或复位请求到达时调用，锁存故障并给出关断状态；实际紧急关断应由硬件路径立即完成。",
  "feedback.step": "传感器数据就绪后、电流坐标变换前调用，结合编码器校准值解算角度和速度，并更新反馈有效性。",
  "modulation.transform": "电流采样与电角度就绪后调用，将三相电流变换到旋转坐标系，输出 d、q 轴电流供电流环使用。",
  "observer.step": "与电流环同周期调用，读取采样区间对应的已生效电压与电流，依次执行状态估算、角度速度提取、选择融合；各结果携带独立时间戳与有效标志。",
  "friction.step": "速度反馈有效后、电流环前调用，根据摩擦补偿配置生成补偿量；关闭或输入无效时不施加补偿。",
  "control.step": "电流环执行前调用，汇总硬件就绪、校准、使能和故障条件，更新输出许可与控制状态。",
  "current.step": "电流采样、给定和输出许可就绪后按电流环周期调用，计算 d、q 轴电压指令，并更新限幅、保护和积分状态。",
  "modulation.update": "电流环完成后调用，将 d、q 轴电压指令转换成三相占空比请求，供 PWM 发波入口使用。",
  "scheduler.step": "应用时基更新后、任务派发前调用，根据当前时间更新任务释放标志和超期计数。",
  "diagnostics.step": "按应用保护任务周期调用，检查软件诊断条件并更新故障、降额及停机请求，不替代硬件紧急保护。",
  "motion.step": "按应用控制周期调用，结合控制给定、反馈和动态限值计算电流给定，交由电流环执行。",
  "commands.step": "通信命令到达或通信任务周期执行时调用，检查命令有效性、序号和超时，更新可供控制任务读取的命令快照。",
  "records.step": "参数提交或存储回执到达时调用，推进参数存储事务，输出存储请求并更新事务状态；Flash 操作由存储适配器执行。",
  "zeroing.step": "校准任务执行时调用，处理启动、取消及有效采样，更新校准进度和结果；结果持久化由存储流程负责。"
};
const entry = (id, moduleId, symbol, title, trigger = 'task') => ({ id, moduleId, symbol, title, trigger, description: ENTRY_COMMENTS[id] });
export const ENTRYPOINTS = Object.freeze([
  entry('core.step', 'hw-platform', 'core_step', '内核服务', '平台启动与时基'),
  entry('peripherals.sample', 'hw-board', 'peripherals_sample', 'ADC 采样'),
  entry('peripherals.apply', 'hw-board', 'peripherals_apply', 'PWM 发波'),
  entry('drivers.step', 'hw-drivers', 'drivers_step', '器件收发', '接收完成、采样请求与超时检查'),
  entry('protection.step', 'hw-safety', 'protection_step', '保护锁存', '硬件故障与复位请求'),
  entry('feedback.step', 'foc-feedback', 'feedback_step', '反馈解算'),
  entry('modulation.transform', 'foc-modulation', 'modulation_transform', '电流坐标变换'),
  entry('observer.step', 'foc-observer', 'observer_step', '状态观测'),
  entry('friction.step', 'foc-compensation', 'friction_step', '摩擦补偿'),
  entry('control.step', 'foc-lifecycle', 'control_step', '输出许可'),
  entry('current.step', 'foc-current', 'current_step', '电流环'),
  entry('modulation.update', 'foc-modulation', 'modulation_update', '电压调制'),
  entry('scheduler.step', 'app-runtime', 'scheduler_step', '任务释放', '应用时基，先于周期任务派发'),
  entry('state_machine.step', 'app-state', 'state_machine_step', '状态更新'),
  entry('diagnostics.step', 'app-safety', 'diagnostics_step', '保护与诊断'),
  entry('motion.step', 'app-motion', 'motion_step', '运动控制'),
  entry('commands.step', 'app-comms', 'commands_step', '命令处理'),
  entry('records.step', 'app-params', 'records_step', '参数存储'),
  entry('zeroing.step', 'app-calibration', 'zeroing_step', '校准管理'),
]);
export const entryById = id => ENTRYPOINTS.find(item => item.id === id);
export const moduleEntries = id => ENTRYPOINTS.filter(item => item.moduleId === id);

/** Inputs supplied by an adapter or an explicit calculation, not a direct field copy. */
export const EXTERNAL_INPUTS = {
  'hw-platform': { now_us:'平台单调时钟', boot_ready:'启动结果', reset_reason:'复位寄存器', clock_fault:'时钟监控' },
  'hw-board': { phase_current:'ADC 换算结果', bus_voltage:'ADC 换算结果', sample_time_us:'ADC 触发时间戳', sample_valid:'DMA 完整采样标志' },
  'hw-drivers': { channel:'通道派发', now_us:'平台单调时钟', rx_data:'UART / SPI 接收缓冲', rx_length:'接收长度', request:'通道更新策略', tx_complete:'发送适配器回执', transport_status:'发送适配器状态', reset:'应用复位命令' },
  'hw-safety': { trip_flags:'比较器 / nFAULT / 刹车事件', reset_request:'应用复位命令', output_disabled:'实际 PWM 关断确认' },
  'foc-feedback': { electrical_offset:'编码器校准记录' },
  'foc-lifecycle': { reset_request:'应用复位命令', hardware_ready:'内核与外设就绪聚合', calibration_valid:'必要校准记录校验', fault_flags:'硬件与电流环故障按位聚合' },
  'foc-current': { voltage_limit:'母线电压与调制余量计算', dt:'电流环实际控制间隔', now_us:'平台单调时钟', reference_time_us:'给定快照的生成时间' },
  'foc-observer': { dt:'电流环实际控制间隔', enable:'模块运行开关' },
  'foc-compensation': { joint_velocity:'电机速度 / 减速比，或出轴速度', valid:'所选速度来源有效性', enable:'模块运行开关' },
  'app-runtime': { now_us:'平台单调时钟' },
  'app-state': { enable_request:'应用使能命令', ready:'配置、平台和校准就绪聚合', reset_request:'应用复位命令' },
  'app-motion': { dynamic_limit:'配置限值与降额结果', enabled:'应用许可与算法许可取交集' },
  'app-comms': { sequence:'通信解析结果', receive_time_us:'通信接收时间戳', now_us:'平台单调时钟', iq:'通信解析结果', received:'新命令事件', frame_valid:'长度与完整性校验' },
  'app-params': { sequence:'参数事务序号', payload:'参数序列化结果，包含标零值', length:'序列化长度', commit:'参数提交事件', storage_done:'Flash 事务回执', storage_ok:'Flash 写后校验' },
  'app-calibration': { sample:'所选标零通道的测量值', sample_valid:'所选通道的有效性', start:'校准启动命令', cancel:'校准取消命令', stationary:'静止条件确认' },
  'app-safety': { output_disabled:'实际 PWM 关断确认', reset_request:'应用复位命令' },
};

export function inputAdapter(project, moduleId, fieldName) {
  if (['app-motion','app-safety'].includes(moduleId) && project.instances['app-motion'].parameters.commandSource==='local' && ['requested_iq','command_valid'].includes(fieldName)) return '本地命令适配器';
  return EXTERNAL_INPUTS[moduleId]?.[fieldName] || '';
}

export function fieldEntry(moduleId, role, name) {
  if (moduleId === 'hw-board') return `peripherals.${role === 'output' ? (['duty','gate_enable'].includes(name) ? 'apply' : 'sample') : (['duty_request','gate_request','trip'].includes(name) ? 'apply' : 'sample')}`;
  if (moduleId === 'foc-modulation') return `modulation.${role === 'output' ? (['current_dq','valid'].includes(name) ? 'transform' : 'update') : (['voltage_dq','enable'].includes(name) ? 'update' : 'transform')}`;
  return moduleEntries(moduleId)[0]?.id;
}
