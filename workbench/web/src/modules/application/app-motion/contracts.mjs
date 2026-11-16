/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "MotionInput",
    "rate": "event",
    "fields": [
      {
        "id": "app-motion-input-requested_iq",
        "name": "requested_iq",
        "type": "f32",
        "count": 1,
        "unit": "A",
        "meaning": "通过应用命令仲裁后的 q 轴给定"
      },
      {
        "id": "app-motion-input-dynamic_limit",
        "name": "dynamic_limit",
        "type": "f32",
        "count": 1,
        "unit": "A",
        "meaning": "上层动态电流边界"
      },
      {
        "id": "app-motion-input-enabled",
        "name": "enabled",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "应用与生命周期允许运行"
      },
      {
        "id": "app-motion-input-command_valid",
        "name": "command_valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "命令序号与有效期均通过检查"
      }
    ]
  },
  "output": {
    "name": "MotionOutput",
    "rate": "event",
    "fields": [
      {
        "id": "app-motion-output-reference_dq",
        "name": "reference_dq",
        "type": "f32",
        "count": 2,
        "unit": "A",
        "meaning": "受限的 d/q 轴给定"
      },
      {
        "id": "app-motion-output-valid",
        "name": "valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "本次给定有效"
      }
    ]
  },
  "state": {
    "name": "MotionState",
    "rate": "event",
    "fields": [
      {
        "id": "app-motion-state-last_iq",
        "name": "last_iq",
        "type": "f32",
        "count": 1,
        "unit": "A",
        "meaning": "上次有效 q 轴给定"
      }
    ]
  }
};
