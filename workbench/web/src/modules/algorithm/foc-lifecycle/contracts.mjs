/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "ControlInput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-lifecycle-input-enable_request",
        "name": "enable_request",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "应用请求使能"
      },
      {
        "id": "foc-lifecycle-input-reset_request",
        "name": "reset_request",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "显式清除故障请求"
      },
      {
        "id": "foc-lifecycle-input-hardware_ready",
        "name": "hardware_ready",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "平台和外设已就绪"
      },
      {
        "id": "foc-lifecycle-input-calibration_valid",
        "name": "calibration_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "所需校准记录完整"
      },
      {
        "id": "foc-lifecycle-input-feedback_valid",
        "name": "feedback_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "本周期反馈有效"
      },
      {
        "id": "foc-lifecycle-input-fault_flags",
        "name": "fault_flags",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "下层和电流环故障"
      }
    ]
  },
  "output": {
    "name": "ControlOutput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-lifecycle-output-enabled",
        "name": "enabled",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "本周期允许控制输出"
      },
      {
        "id": "foc-lifecycle-output-state",
        "name": "state",
        "type": "u8",
        "count": 1,
        "unit": "",
        "meaning": "0 待机，1 运行，2 故障"
      },
      {
        "id": "foc-lifecycle-output-fault_flags",
        "name": "fault_flags",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "锁存故障"
      }
    ]
  },
  "state": {
    "name": "ControlState",
    "rate": "event",
    "fields": [
      {
        "id": "foc-lifecycle-state-latched_faults",
        "name": "latched_faults",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "停机前故障记录"
      },
      {
        "id": "foc-lifecycle-state-previous_enable",
        "name": "previous_enable",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "上周期输出许可"
      }
    ]
  }
};
