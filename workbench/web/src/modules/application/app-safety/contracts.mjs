/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "DiagnosticsInput",
    "rate": "event",
    "fields": [
      {
        "id": "app-safety-input-hardware_faults",
        "name": "hardware_faults",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "硬件快速故障"
      },
      {
        "id": "app-safety-input-algorithm_faults",
        "name": "algorithm_faults",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "算法保护故障"
      },
      {
        "id": "app-safety-input-command_valid",
        "name": "command_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "通信命令有效"
      },
      {
        "id": "app-safety-input-enabled",
        "name": "enabled",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "当前运行状态"
      },
      {
        "id": "app-safety-input-output_disabled",
        "name": "output_disabled",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "功率输出已确认关闭"
      },
      {
        "id": "app-safety-input-reset_request",
        "name": "reset_request",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "显式请求恢复"
      }
    ]
  },
  "output": {
    "name": "DiagnosticsOutput",
    "rate": "event",
    "fields": [
      {
        "id": "app-safety-output-stop_request",
        "name": "stop_request",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "请求停止输出"
      },
      {
        "id": "app-safety-output-fault_flags",
        "name": "fault_flags",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "聚合并锁存的故障"
      },
      {
        "id": "app-safety-output-new_event",
        "name": "new_event",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "本次出现新的故障位"
      }
    ]
  },
  "state": {
    "name": "DiagnosticsState",
    "rate": "event",
    "fields": [
      {
        "id": "app-safety-state-latched_faults",
        "name": "latched_faults",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "累计锁存故障"
      }
    ]
  }
};
