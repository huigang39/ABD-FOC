/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "ModulationInput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-modulation-input-phase_current",
        "name": "phase_current",
        "type": "f32",
        "count": 3,
        "unit": "A",
        "meaning": "三相电流快照"
      },
      {
        "id": "foc-modulation-input-electrical_angle",
        "name": "electrical_angle",
        "type": "f32",
        "count": 1,
        "unit": "rad",
        "meaning": "同步坐标变换使用的电角度"
      },
      {
        "id": "foc-modulation-input-voltage_dq",
        "name": "voltage_dq",
        "type": "f32",
        "count": 2,
        "unit": "V",
        "meaning": "电流环电压指令"
      },
      {
        "id": "foc-modulation-input-bus_voltage",
        "name": "bus_voltage",
        "type": "f32",
        "count": 1,
        "unit": "V",
        "meaning": "采样对应的母线电压"
      },
      {
        "id": "foc-modulation-input-enable",
        "name": "enable",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "输出许可"
      }
    ]
  },
  "output": {
    "name": "ModulationOutput",
    "rate": "event",
    "fields": [
      {
        "id": "foc-modulation-output-current_dq",
        "name": "current_dq",
        "type": "f32",
        "count": 2,
        "unit": "A",
        "meaning": "Clarke/Park 变换的电流反馈"
      },
      {
        "id": "foc-modulation-output-duty",
        "name": "duty",
        "type": "f32",
        "count": 3,
        "unit": "",
        "meaning": "三相占空比"
      },
      {
        "id": "foc-modulation-output-valid",
        "name": "valid",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "计算与母线输入有效"
      }
    ]
  },
  "state": {
    "name": "ModulationState",
    "rate": "event",
    "fields": [
      {
        "id": "foc-modulation-state-saturation_count",
        "name": "saturation_count",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "调制约束触发次数"
      }
    ]
  }
};
