/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "CommandsInput",
    "rate": "event",
    "fields": [
      {
        "id": "app-comms-input-sequence",
        "name": "sequence",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "总线适配器解码后的命令序号"
      },
      {
        "id": "app-comms-input-receive_time_us",
        "name": "receive_time_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "命令接收时刻"
      },
      {
        "id": "app-comms-input-now_us",
        "name": "now_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "当前时刻"
      },
      {
        "id": "app-comms-input-iq",
        "name": "iq",
        "type": "f32",
        "count": 1,
        "unit": "A",
        "meaning": "总线适配器解码的电流给定"
      },
      {
        "id": "app-comms-input-received",
        "name": "received",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "本次有新命令"
      },
      {
        "id": "app-comms-input-frame_valid",
        "name": "frame_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "总线完整性和长度校验通过"
      }
    ]
  },
  "output": {
    "name": "CommandsOutput",
    "rate": "event",
    "fields": [
      {
        "id": "app-comms-output-iq",
        "name": "iq",
        "type": "f32",
        "count": 1,
        "unit": "A",
        "meaning": "最近有效命令"
      },
      {
        "id": "app-comms-output-valid",
        "name": "valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "命令通过检查且未超时"
      },
      {
        "id": "app-comms-output-sequence",
        "name": "sequence",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "最近接受的命令序号"
      }
    ]
  },
  "state": {
    "name": "CommandsState",
    "rate": "event",
    "fields": [
      {
        "id": "app-comms-state-last_sequence",
        "name": "last_sequence",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "用于丢弃重复和乱序命令"
      },
      {
        "id": "app-comms-state-last_receive_us",
        "name": "last_receive_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "最近一次接受命令的时间"
      },
      {
        "id": "app-comms-state-received",
        "name": "received",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "至少接受过一次命令"
      },
      {
        "id": "app-comms-state-rejected_count",
        "name": "rejected_count",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "拒绝的命令计数"
      }
    ]
  }
};
