/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "FeedbackInput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-feedback-input-motor_angle",
        "name": "motor_angle",
        "type": "f32",
        "count": 1,
        "unit": "rad",
        "meaning": "电机侧单圈机械角"
      },
      {
        "id": "foc-feedback-input-output_angle",
        "name": "output_angle",
        "type": "f32",
        "count": 1,
        "unit": "rad",
        "meaning": "输出轴侧机械角"
      },
      {
        "id": "foc-feedback-input-sample_time_us",
        "name": "sample_time_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "角度采样时刻"
      },
      {
        "id": "foc-feedback-input-motor_valid",
        "name": "motor_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "电机侧角度有效"
      },
      {
        "id": "foc-feedback-input-output_valid",
        "name": "output_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "输出轴角度有效"
      },
      {
        "id": "foc-feedback-input-electrical_offset",
        "name": "electrical_offset",
        "type": "f32",
        "count": 1,
        "unit": "rad",
        "meaning": "编码器校准记录中的电角度零位"
      }
    ]
  },
  "output": {
    "name": "FeedbackOutput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-feedback-output-electrical_angle",
        "name": "electrical_angle",
        "type": "f32",
        "count": 1,
        "unit": "rad",
        "meaning": "归一化电角度"
      },
      {
        "id": "foc-feedback-output-motor_velocity",
        "name": "motor_velocity",
        "type": "f32",
        "count": 1,
        "unit": "rad/s",
        "meaning": "电机机械角速度"
      },
      {
        "id": "foc-feedback-output-joint_position",
        "name": "joint_position",
        "type": "f32",
        "count": 1,
        "unit": "rad",
        "meaning": "连续输出位置"
      },
      {
        "id": "foc-feedback-output-valid",
        "name": "valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "反馈可用"
      }
    ]
  },
  "state": {
    "name": "FeedbackState",
    "rate": "event",
    "fields": [
      {
        "id": "foc-feedback-state-last_angle",
        "name": "last_angle",
        "type": "f32",
        "count": 1,
        "unit": "rad",
        "meaning": "上一次电机机械角"
      },
      {
        "id": "foc-feedback-state-unwrapped_angle",
        "name": "unwrapped_angle",
        "type": "f32",
        "count": 1,
        "unit": "rad",
        "meaning": "电机展开角"
      },
      {
        "id": "foc-feedback-state-last_time_us",
        "name": "last_time_us",
        "type": "u32",
        "count": 1,
        "unit": "us",
        "meaning": "上次有效采样时刻"
      },
      {
        "id": "foc-feedback-state-initialized",
        "name": "initialized",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "是否取得初始角度"
      }
    ]
  }
};
