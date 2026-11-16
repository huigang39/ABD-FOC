/** Wire-format data for the shelf. Generated code never branches on these labels. */
import { createDriverCommand } from '../modules/hardware/hw-drivers/protocol.mjs';
const dataCommand=(id,values)=>Object.assign(createDriverCommand('data',id),values);
const angle=(id,dataOffset,valueScale)=>dataCommand(id,{mode:'request_response',requestHex:'3B',startupDelayUs:200000,headerHex:'3B',footerHex:'',frameBytes:9,dataOffset,dataType:'unsigned',dataBits:24,byteOrder:'little',valueScale,valueOffset:0,checksum:'xor8',checksumStart:0,statusOffset:7,statusMask:0,statusExpected:0});
const upload=(id,values)=>dataCommand(id,{mode:'active_upload',startupDelayUs:200000,dataType:'float32',dataBits:32,byteOrder:'little',valueScale:1,valueOffset:0,checksumStart:0,footerHex:'',statusOffset:null,statusMask:0,statusExpected:0,...values});
const torque={
  KW:upload('torque-data',{requestHex:'48 AA 85 7F 14 D4',headerHex:'48 AA',frameBytes:8,dataOffset:2,checksum:'crc16_modbus'}),
  LD:upload('torque-data',{requestHex:'55 AA 01 00 03 51 09 01 5A CC 33',headerHex:'55 AA',footerHex:'CC 33',frameBytes:14,dataOffset:7,checksum:'xor8',checksumStart:3}),
  SMH:upload('torque-data',{requestHex:'1F 10 01 9A 00 01 02 00 03 6A CB',headerHex:'8A',frameBytes:6,dataOffset:2,dataType:'signed',dataBits:24,valueScale:0.01,checksum:'xor8',statusOffset:1,statusMask:255}),
};
const prefix=(p,commands)=>({[p+'Commands']:commands});
export function neo75hProtocols(variant){
  return {...prefix('motorEncoder',[angle('motor-data',1,2*Math.PI/131072)]),...prefix('outputEncoder',[angle('output-data',4,2*Math.PI/524288)]),...(torque[variant]?prefix('torqueSensor',[torque[variant]]):{})};
}
