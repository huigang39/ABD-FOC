/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "FrictionInput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-compensation-input-joint_velocity",
        "name": "joint_velocity",
        "type": "f32",
        "count": 1,
        "unit": "rad/s",
        "meaning": "输出轴机械角速度"
      },
      {
        "id": "foc-compensation-input-valid",
        "name": "valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "速度反馈有效"
      },
      {
        "id": "foc-compensation-input-enable",
        "name": "enable",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "运行期开关"
      }
    ]
  },
  "output": {
    "name": "FrictionOutput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-compensation-output-torque",
        "name": "torque",
        "type": "f32",
        "count": 1,
        "unit": "N.m",
        "meaning": "限幅后的摩擦补偿力矩"
      },
      {
        "id": "foc-compensation-output-valid",
        "name": "valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "补偿输出有效"
      }
    ]
  },
  "state": {
    "name": "FrictionState",
    "rate": "event",
    "fields": [
      {
        "id": "foc-compensation-state-last_torque",
        "name": "last_torque",
        "type": "f32",
        "count": 1,
        "unit": "N.m",
        "meaning": "最近一次补偿力矩"
      }
    ]
  }
};
