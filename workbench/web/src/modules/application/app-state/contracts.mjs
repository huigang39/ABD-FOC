export const CONTRACTS = {
  "input": {
    "name": "StateMachineInput",
    "rate": "event",
    "fields": [
      {
        "id": "app-state-input-enable_request",
        "name": "enable_request",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "运行请求"
      },
      {
        "id": "app-state-input-ready",
        "name": "ready",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "配置、校准和平台都已就绪"
      },
      {
        "id": "app-state-input-fault",
        "name": "fault",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "任意活动故障"
      },
      {
        "id": "app-state-input-reset_request",
        "name": "reset_request",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "显式故障复位"
      }
    ]
  },
  "output": {
    "name": "StateMachineOutput",
    "rate": "event",
    "fields": [
      {
        "id": "app-state-output-run_permitted",
        "name": "run_permitted",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "应用运行许可"
      },
      {
        "id": "app-state-output-fault_latched",
        "name": "fault_latched",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "应用故障锁存"
      }
    ]
  },
  "state": {
    "name": "StateMachineState",
    "rate": "event",
    "fields": [
      {
        "id": "app-state-state-fault_latched",
        "name": "fault_latched",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "应用锁存故障"
      }
    ]
  }
};
