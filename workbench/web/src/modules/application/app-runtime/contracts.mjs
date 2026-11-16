export const CONTRACTS = {
  "input": {
    "name": "SchedulerInput",
    "rate": "event",
    "fields": [
      {
        "id": "app-runtime-input-now_us",
        "name": "now_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "任务调度时间"
      }
    ]
  },
  "output": {
    "name": "SchedulerOutput",
    "rate": "event",
    "fields": [
      {
        "id": "app-runtime-output-release_mask",
        "name": "release_mask",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "本次释放的任务位图，按优先级依次处理"
      }
    ]
  },
  "state": {
    "name": "SchedulerState",
    "rate": "event",
    "fields": [
      {
        "id": "app-runtime-state-next_release_us",
        "name": "next_release_us",
        "type": "u32",
        "count": 16,
        "unit": "us",
        "meaning": "各任务下一次释放时间"
      },
      {
        "id": "app-runtime-state-missed_deadlines",
        "name": "missed_deadlines",
        "type": "u32",
        "count": 16,
        "unit": "",
        "meaning": "各任务错过周期的累计次数"
      },
      {
        "id": "app-runtime-state-initialized",
        "name": "initialized",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "任务时间表已经初始化"
      }
    ]
  }
};
