/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "ZeroingInput",
    "rate": "event",
    "fields": [
      {
        "id": "app-calibration-input-sample",
        "name": "sample",
        "type": "f32",
        "count": 1,
        "unit": "",
        "meaning": "标零测量值"
      },
      {
        "id": "app-calibration-input-sample_valid",
        "name": "sample_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "本次采样有效"
      },
      {
        "id": "app-calibration-input-start",
        "name": "start",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "启动标零请求"
      },
      {
        "id": "app-calibration-input-cancel",
        "name": "cancel",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "取消当前标零"
      },
      {
        "id": "app-calibration-input-stationary",
        "name": "stationary",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "上层已确认静止"
      }
    ]
  },
  "output": {
    "name": "ZeroingOutput",
    "rate": "event",
    "fields": [
      {
        "id": "app-calibration-output-offset",
        "name": "offset",
        "type": "f32",
        "count": 1,
        "unit": "",
        "meaning": "有效候选标零值；写入参数区"
      },
      {
        "id": "app-calibration-output-complete",
        "name": "complete",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "本次得到候选结果"
      },
      {
        "id": "app-calibration-output-busy",
        "name": "busy",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "正在采集"
      },
      {
        "id": "app-calibration-output-error",
        "name": "error",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "1 标零时发生运动，2 测量非法"
      }
    ]
  },
  "state": {
    "name": "ZeroingState",
    "rate": "event",
    "fields": [
      {
        "id": "app-calibration-state-sum",
        "name": "sum",
        "type": "f32",
        "count": 1,
        "unit": "",
        "meaning": "有效样本累计"
      },
      {
        "id": "app-calibration-state-count",
        "name": "count",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "有效样本数量"
      },
      {
        "id": "app-calibration-state-active",
        "name": "active",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "正在采集"
      },
      {
        "id": "app-calibration-state-start_previous",
        "name": "start_previous",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "启动请求边沿检测"
      }
    ]
  }
};
