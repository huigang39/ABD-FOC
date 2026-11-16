import { createNeo75hProject } from '../../web/src/profiles/neo75h.mjs';
/** Complete values for host/compiler verification, never an approved board preset. */
export function newModuleProject(){
  const p=createNeo75hProject();
  const set=(id,values)=>Object.assign(p.instances[id].parameters,values);
  set('app-state',{stateMachine:'local',cia402Modes:[],cia402DefaultMode:'none'});
  set('app-motion',{supportedModes:['current'],activeMode:'current',commandSource:'local'});
  set('app-comms',{timeoutMs:100});
  p.instances['app-calibration'].enabled=p.instances['app-calibration'].runtimeEnabled=false;
  set('app-calibration',{procedures:[],enabledProcedures:[]});
  set('foc-lifecycle',{referenceTimeoutMs:10});
  set('foc-compensation',{frictionModel:'coulomb_viscous',frictionSource:'stored',viscousNmPerRadS:0.1,coulombNm:0.2,transitionRadS:0.1,maxCompensationNm:1});
  set('hw-drivers',{motorEncoderTimeoutUs:500,outputEncoderTimeoutUs:500,torqueSensorTimeoutUs:5000,torqueSensorRangeNm:50,gateDriverCapability:'absent'});
  // Host-only independent port: preserve both encoder runtime scenarios without
  // changing the imported NEO board's historical shared USART2 wiring.
  const encoderPort=structuredClone(p.instances['hw-board'].parameters.resources.find(resource=>resource.id==='USART2'));
  Object.assign(encoderPort,{id:'host-output-uart4',name:'Host-only output encoder',instance:'UART4',pins:{RX:'PD0',TX:'PB9',DE:'PB14'}});
  p.instances['hw-board'].parameters.resources.push(encoderPort);
  p.instances['hw-drivers'].parameters.outputEncoderResource=encoderPort.id;
  return p;
}
