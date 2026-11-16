/** Design-time signal boundary; per-filter private state has no native ABI yet. */
const field = (role, name, type, unit, meaning) => ({ id: `foc-filter-${role}-${name}`, name, type, count: 1, unit, meaning });
const schema = (role, name, fields) => ({ name, rate: 'fast', fields: fields.map(args => field(role, ...args)) });
export const CONTRACTS = {
  input: schema('input', 'FilterInput', [
    ['dt', 'f32', 's', '滤波计算周期'],
    ['enable', 'bool', '', '滤波模块运行开关'],
    ['sample_time_us', 'u32', 'μs', '输入信号采样时间戳'],
    ['valid', 'bool', '', '输入信号有效'],
  ]),
  output: schema('output', 'FilterOutput', [
    ['motor_velocity', 'f32', 'rad/s', '滤波后的电机侧机械角速度'],
    ['output_velocity', 'f32', 'rad/s', '滤波后的出轴侧机械角速度'],
    ['bus_voltage', 'f32', 'V', '滤波后的母线电压'],
    ['torque', 'f32', 'N·m', '滤波后的力矩传感器力矩'],
    ['phase_current_u', 'f32', 'A', '滤波后的 U 相电流'],
    ['phase_current_v', 'f32', 'A', '滤波后的 V 相电流'],
    ['phase_current_w', 'f32', 'A', '滤波后的 W 相电流'],
  ]),
  state: schema('state', 'FilterState', []),
};
