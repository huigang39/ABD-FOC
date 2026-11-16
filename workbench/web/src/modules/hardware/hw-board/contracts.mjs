/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "PeripheralsInput",
    "rate": "event",
    "fields": [
      {
        "id": "hw-board-input-phase_current",
        "name": "phase_current",
        "type": "f32",
        "count": 3,
        "unit": "A",
        "meaning": "ADC 外设适配完成零偏和增益换算的三相电流"
      },
      {
        "id": "hw-board-input-bus_voltage",
        "name": "bus_voltage",
        "type": "f32",
        "count": 1,
        "unit": "V",
        "meaning": "ADC 外设适配后的母线电压"
      },
      {
        "id": "hw-board-input-sample_time_us",
        "name": "sample_time_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "硬件触发采样时间"
      },
      {
        "id": "hw-board-input-sample_valid",
        "name": "sample_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "ADC/DMA 已提交完整采样"
      },
      {
        "id": "hw-board-input-duty_request",
        "name": "duty_request",
        "type": "f32",
        "count": 3,
        "unit": "",
        "meaning": "本周期请求的三相占空比"
      },
      {
        "id": "hw-board-input-gate_request",
        "name": "gate_request",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "上层允许输出"
      },
      {
        "id": "hw-board-input-trip",
        "name": "trip",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "硬件快速保护输入"
      }
    ]
  },
  "output": {
    "name": "PeripheralsOutput",
    "rate": "event",
    "fields": [
      {
        "id": "hw-board-output-phase_current",
        "name": "phase_current",
        "type": "f32",
        "count": 3,
        "unit": "A",
        "meaning": "有效采样快照"
      },
      {
        "id": "hw-board-output-bus_voltage",
        "name": "bus_voltage",
        "type": "f32",
        "count": 1,
        "unit": "V",
        "meaning": "采样快照的母线电压"
      },
      {
        "id": "hw-board-output-sample_time_us",
        "name": "sample_time_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "采样时刻"
      },
      {
        "id": "hw-board-output-sequence",
        "name": "sequence",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "有效采样序号"
      },
      {
        "id": "hw-board-output-valid",
        "name": "valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "快照有效"
      },
      {
        "id": "hw-board-output-duty",
        "name": "duty",
        "type": "f32",
        "count": 3,
        "unit": "",
        "meaning": "经边界检查后交给定时器的占空比"
      },
      {
        "id": "hw-board-output-gate_enable",
        "name": "gate_enable",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "门极输出许可；实际生效由外设适配反馈"
      }
    ]
  },
  "state": {
    "name": "PeripheralsState",
    "rate": "event",
    "fields": [
      {
        "id": "hw-board-state-sample_sequence",
        "name": "sample_sequence",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "采样发布计数"
      },
      {
        "id": "hw-board-state-rejected_samples",
        "name": "rejected_samples",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "不完整或非法采样计数"
      }
    ]
  }
};
