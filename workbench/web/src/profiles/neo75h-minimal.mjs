import { createNeo75hProject } from './neo75h.mjs';
/** NEO reference PCBA: independent active-low PE1 gate, not the SPI DRV8353 variant. */
export function createNeo75hMinimalProject() {
  const p=createNeo75hProject('KW');
  p.name='NEO_75_H_GW_KW_MINIMAL_SPEED';
  const set=(id,values)=>{Object.assign(p.instances[id].parameters,values);for(const key of Object.keys(values))p.provenance[`${id}.${key}`]='user';};
  for(const id of ['app-comms','foc-observer','foc-compensation'])p.instances[id].enabled=p.instances[id].runtimeEnabled=false;
  set('app-state',{stateMachine:'local',cia402Modes:[],cia402DefaultMode:'none'});
  set('app-motion',{supportedModes:['speed','calibration'],activeMode:'speed',commandSource:'local',outerHz:1000,currentLimitA:5,
    speedKp:5,speedKi:10,speedFilterHz:20,profileVelocityRadS:Math.PI/6,profileAccelerationRadS2:0.2,profileDecelerationRadS2:0.2});
  set('app-calibration',{procedures:['electrical_zero'],enabledProcedures:['electrical_zero'],maxCurrentA:5});
  set('foc-lifecycle',{maxCurrentA:8,referenceTimeoutMs:5});
  set('foc-modulation',{dutyMin:0.05,dutyMax:0.95});
  set('hw-drivers',{motorEncoderDirection:'calibration',motorEncoderTimeoutUs:250,motorEncoderRateHz:20000,
    outputEncoderCapability:'absent',torqueCapability:'absent',gateDriverCapability:'absent'});
  for(const id of Object.keys(p.execution.assignments))p.execution.assignments[id]='cm7';
  p.instances['hw-platform'].parameters.coreConfigs.cm7.dataCache='disabled';
  p.instances['hw-board'].parameters.resources=p.instances['hw-board'].parameters.resources.filter(r=>!['USART3','DRV8353_NFAULT'].includes(r.id));
  p.instances['hw-board'].parameters.resources.push({id:'GATE_DISABLE',name:'NEO 独立预驱禁止（高有效）',kind:'gpio',instance:'GPIO',pins:{IO:'PE1'},settings:{direction:'output',pull:'none',initialLevel:'high'}});
  p.build.optimization='O2'; p.build.lto=false;
  p.design.protocol.transport='unselected';
  return p;
}
