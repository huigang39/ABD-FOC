/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "CurrentInput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-current-input-current_dq",
        "name": "current_dq",
        "type": "f32",
        "count": 2,
        "unit": "A",
        "meaning": "同步坐标系反馈电流"
      },
      {
        "id": "foc-current-input-reference_dq",
        "name": "reference_dq",
        "type": "f32",
        "count": 2,
        "unit": "A",
        "meaning": "d/q 轴电流给定"
      },
      {
        "id": "foc-current-input-voltage_limit",
        "name": "voltage_limit",
        "type": "f32",
        "count": 1,
        "unit": "V",
        "meaning": "调制允许的电压矢量幅值"
      },
      {
        "id": "foc-current-input-dt",
        "name": "dt",
        "type": "f32",
        "count": 1,
        "unit": "s",
        "meaning": "电流环实际控制间隔"
      },
      {
        "id": "foc-current-input-now_us",
        "name": "now_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "当前时刻"
      },
      {
        "id": "foc-current-input-reference_time_us",
        "name": "reference_time_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "给定生成时刻"
      },
      {
        "id": "foc-current-input-feedback_valid",
        "name": "feedback_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "当前电流反馈有效"
      },
      {
        "id": "foc-current-input-enable",
        "name": "enable",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "算法生命周期允许输出"
      }
    ]
  },
  "output": {
    "name": "CurrentOutput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-current-output-voltage_dq",
        "name": "voltage_dq",
        "type": "f32",
        "count": 2,
        "unit": "V",
        "meaning": "限幅后的 d/q 轴电压指令"
      },
      {
        "id": "foc-current-output-fault_flags",
        "name": "fault_flags",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "1 非法输入，2 过流，4 给定超时"
      },
      {
        "id": "foc-current-output-saturated",
        "name": "saturated",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "电压指令发生限幅"
      }
    ]
  },
  "state": {
    "name": "CurrentState",
    "rate": "event",
    "fields": [
      {
        "id": "foc-current-state-integral_dq",
        "name": "integral_dq",
        "type": "f32",
        "count": 2,
        "unit": "V",
        "meaning": "电流 PI 的两轴积分状态"
      },
      {
        "id": "foc-current-state-latched_faults",
        "name": "latched_faults",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "电流环故障锁存；禁止输出后清除"
      }
    ]
  }
};
