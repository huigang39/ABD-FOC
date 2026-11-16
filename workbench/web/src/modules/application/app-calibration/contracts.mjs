/** Direction and electrical offset calibration; no nonlinear table or output zero. */
const fields = (role, rows) => rows.map(([name,type,unit,meaning]) => ({id:`app-calibration-${role}-${name}`,name,type,count:1,unit,meaning}));
export const CONTRACTS = {
  input:{name:'ZeroingInput',rate:'control',fields:fields('input',[
    ['motor_angle','f32','rad','原始电机机械角度'],['dt','f32','s','调用周期'],
    ['sample_valid','bool','','新鲜编码器反馈'],['start','bool','','停机状态的启动边沿'],
    ['cancel','bool','','取消并撤销激励'],['permitted','bool','','采样和保护允许校准']
  ])},
  output:{name:'ZeroingOutput',rate:'control',fields:fields('output',[
    ['forced_angle','f32','rad','校准的强制电角度'],['reference_id','f32','A','受限 d 轴激励'],
    ['direction','i32','','编码器机械方向 +1/-1'],['offset','f32','rad','方向修正后的电角度偏置'],
    ['complete','bool','','结果有效'],['busy','bool','','校准占用给定'],['error','u32','','1 取消/禁止，2 反馈/时基，3 行程/方向，4 偏置离散，5 超时'],
    ['phase','u32','','0 空闲，1 对齐，2 正扫，3 反扫，4 稳定，5 偏置采集']
  ])},
  state:{name:'ZeroingState',rate:'control',fields:fields('state',[
    ['phase','u32','','校准阶段'],['elapsed','f32','s','阶段时间'],['total','f32','s','总时间'],
    ['angle','f32','rad','强制电角度'],['last_raw','f32','rad','上次机械角度'],['travel','f32','rad','展开的机械行程'],
    ['forward_travel','f32','rad','正扫终点'],['sum_sin','f32','','偏置圆均值正弦'],['sum_cos','f32','','偏置圆均值余弦'],
    ['count','u32','','偏置样本数'],['candidate_direction','i32','','候选方向'],['start_previous','bool','','启动边沿']
  ])}
};
