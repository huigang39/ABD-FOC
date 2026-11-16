/** Explicit field relationships. No name guessing, conversion or state exposure. */
const links = [
  ['samples','采样快照','hw-board','foc-modulation','call','fast',[['phase_current','phase_current'],['bus_voltage','bus_voltage']]],
  ['angle','换相角度','foc-feedback','foc-modulation','call','fast',[['electrical_angle','electrical_angle']]],
  ['current-feedback','电流反馈','foc-modulation','foc-current','call','fast',[['current_dq','current_dq'],['valid','feedback_valid']]],
  ['current-permit','电流环许可','foc-lifecycle','foc-current','call','fast',[['enabled','enable']]],
  ['reference','电流给定','app-motion','foc-current','snapshot','control',[['reference_dq','reference_dq']]],
  ['voltage','电压指令','foc-current','foc-modulation','call','fast',[['voltage_dq','voltage_dq']]],
  ['modulation-permit','调制许可','foc-lifecycle','foc-modulation','call','fast',[['enabled','enable']]],
  ['pwm','PWM 给定','foc-modulation','hw-board','call','fast',[['duty','duty_request']]],
  ['gate','门极许可','foc-lifecycle','hw-board','call','fast',[['enabled','gate_request']]],
  ['trip','硬件关断锁存','hw-safety','hw-board','snapshot','event',[['trip_latched','trip']]],
  ['feedback-valid','反馈有效性','foc-feedback','foc-lifecycle','call','fast',[['valid','feedback_valid']]],
  ['run-permit','应用运行许可','app-state','foc-lifecycle','snapshot','control',[['run_permitted','enable_request']]],
  ['algorithm-faults','算法故障','foc-current','app-safety','snapshot','fast',[['fault_flags','algorithm_faults']]],
  ['hardware-faults','硬件故障','hw-safety','app-safety','snapshot','event',[['fault_flags','hardware_faults']]],
  ['command','运动命令','app-comms','app-motion','snapshot','control',[['iq','requested_iq'],['valid','command_valid']]],
  ['command-valid','命令有效性','app-comms','app-safety','snapshot','control',[['valid','command_valid']]],
  ['running','运行状态','app-state','app-safety','snapshot','control',[['run_permitted','enabled']]],
  ['stop','故障停机','app-safety','app-state','snapshot','control',[['stop_request','fault']]],
  ['tracking-motor','电机侧机械角度','hw-drivers','foc-observer','snapshot','fast',[['value[0]','encoder_motor_angle'],['valid[0]','encoder_motor_valid'],['sample_time_us[0]','encoder_motor_time_us']]],
  ['tracking-output','出轴侧机械角度','hw-drivers','foc-observer','snapshot','fast',[['value[1]','encoder_output_angle'],['valid[1]','encoder_output_valid'],['sample_time_us[1]','encoder_output_time_us']]],
  ['observer','已换算电角度','foc-feedback','foc-observer','call','fast',[['electrical_angle','measured_angle'],['valid','valid']]],
  ['encoders','编码器反馈','hw-drivers','foc-feedback','snapshot','fast',[['value[0]','motor_angle'],['value[1]','output_angle'],['valid[0]','motor_valid'],['valid[1]','output_valid'],['sample_time_us[0]','sample_time_us']]],
];

export function createDefaultInterfaces(design) {
  return links.flatMap(([key,name,fromModule,toModule,handoff,rate,fields])=>{
    const sourceStructure=design.moduleContracts[fromModule]?.output,targetStructure=design.moduleContracts[toModule]?.input;
    const source=design.structures.find(s=>s.id===sourceStructure),target=design.structures.find(s=>s.id===targetStructure);
    const ref=(structure,name)=>{const match=/^(.*?)(\[\d+\])?$/.exec(name),field=structure?.fields.find(f=>f.name===match[1]);return field ? field.id+(match[2]||'') : '';};
    const fieldMap=fields.map(([a,b],index)=>({id:`${key}-${index}`,sourceField:ref(source,a),targetField:ref(target,b)})).filter(m=>m.sourceField&&m.targetField);
    if(!fieldMap.length)return [];
    return [{id:`link-${key}`,name,fromModule,toModule,sourceStructure,targetStructure,handoff,rate,version:'1',notes:handoff==='snapshot'?'在任务边界交接完整快照；跨核时需要共享内存同步与时间戳。':'同一电流环控制周期内，来源入口执行完成后传递给目标入口。',fieldMap}];
  });
}

export function resolveFieldReference(structure, reference) {
  const match=/^(.*?)(?:\[(\d+)\])?$/.exec(reference || '');
  const fields=structure?.fields.filter(field=>field.id===match?.[1])||[];
  if(fields.length!==1)return null;
  const field=fields[0];
  if(match[2]===undefined)return field;
  const index=Number(match[2]);
  if(field.count<=1||index>=field.count)return null;
  // Generic driver channels 0/1 are explicitly defined as radians by DriversOutput.
  const unit=structure.owner==='hw-drivers' && field.name==='value' && index<2 ? 'rad' : field.unit;
  return {...field,id:reference,name:`${field.name}[${index}]`,count:1,unit,elementOf:field.id,index};
}
