/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "CoreInput",
    "rate": "event",
    "fields": [
      {
        "id": "hw-platform-input-now_us",
        "name": "now_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "平台单调时钟，按无符号差处理回绕"
      },
      {
        "id": "hw-platform-input-boot_ready",
        "name": "boot_ready",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "平台初始化结果"
      },
      {
        "id": "hw-platform-input-reset_reason",
        "name": "reset_reason",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "硬件复位原因位"
      },
      {
        "id": "hw-platform-input-clock_fault",
        "name": "clock_fault",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "时钟监控故障"
      }
    ]
  },
  "output": {
    "name": "CoreOutput",
    "rate": "event",
    "fields": [
      {
        "id": "hw-platform-output-ready",
        "name": "ready",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "平台是否可用于控制"
      },
      {
        "id": "hw-platform-output-elapsed_us",
        "name": "elapsed_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "本次与上次调用的间隔"
      },
      {
        "id": "hw-platform-output-reset_reason",
        "name": "reset_reason",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "启动复位原因"
      },
      {
        "id": "hw-platform-output-fault",
        "name": "fault",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "平台故障标志"
      }
    ]
  },
  "state": {
    "name": "CoreState",
    "rate": "event",
    "fields": [
      {
        "id": "hw-platform-state-last_us",
        "name": "last_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "上次调用时刻"
      },
      {
        "id": "hw-platform-state-initialized",
        "name": "initialized",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "时基是否已初始化"
      }
    ]
  }
};
