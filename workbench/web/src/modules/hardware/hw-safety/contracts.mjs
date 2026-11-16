/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "ProtectionInput",
    "rate": "event",
    "fields": [
      {
        "id": "hw-safety-input-trip_flags",
        "name": "trip_flags",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "比较器、制动输入或 nFAULT 触发位"
      },
      {
        "id": "hw-safety-input-reset_request",
        "name": "reset_request",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "显式请求解除锁存"
      },
      {
        "id": "hw-safety-input-output_disabled",
        "name": "output_disabled",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "输出已经关断"
      }
    ]
  },
  "output": {
    "name": "ProtectionOutput",
    "rate": "event",
    "fields": [
      {
        "id": "hw-safety-output-trip_latched",
        "name": "trip_latched",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "快速故障锁存"
      },
      {
        "id": "hw-safety-output-gate_permitted",
        "name": "gate_permitted",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "快速保护允许输出"
      },
      {
        "id": "hw-safety-output-fault_flags",
        "name": "fault_flags",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "锁存的硬件故障位"
      }
    ]
  },
  "state": {
    "name": "ProtectionState",
    "rate": "event",
    "fields": [
      {
        "id": "hw-safety-state-latched_flags",
        "name": "latched_flags",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "累计锁存位"
      },
      {
        "id": "hw-safety-state-trip_count",
        "name": "trip_count",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "新故障事件计数"
      }
    ]
  }
};
