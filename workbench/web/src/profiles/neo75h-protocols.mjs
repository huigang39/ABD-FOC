/** Wire-format data for the shelf. Generated code never branches on these labels. */
const angle={TransferMode:'request_response',RequestHex:'3B',StartHex:'',StartupDelayUs:200000,HeaderHex:'3B',FooterHex:'',FrameBytes:9,DataType:'unsigned',DataBits:24,ByteOrder:'little',ValueOffset:0,Checksum:'xor8',ChecksumStart:0,StatusOffset:7,StatusMask:0,StatusExpected:0};
const upload={TransferMode:'active_upload',RequestHex:'',StartupDelayUs:200000,DataType:'float32',DataBits:32,ByteOrder:'little',ValueScale:1,ValueOffset:0,ChecksumStart:0,FooterHex:'',StatusOffset:null,StatusMask:0,StatusExpected:0};
const torque={
  KW:{...upload,StartHex:'48 AA 85 7F 14 D4',HeaderHex:'48 AA',FrameBytes:8,DataOffset:2,Checksum:'crc16_modbus'},
  LD:{...upload,StartHex:'55 AA 01 00 03 51 09 01 5A CC 33',HeaderHex:'55 AA',FooterHex:'CC 33',FrameBytes:14,DataOffset:7,Checksum:'xor8',ChecksumStart:3},
  SMH:{...upload,StartHex:'1F 10 01 9A 00 01 02 00 03 6A CB',HeaderHex:'8A',FrameBytes:6,DataOffset:2,DataType:'signed',DataBits:24,ValueScale:0.01,Checksum:'xor8',StatusOffset:1,StatusMask:255},
};
const prefix=(p,values)=>Object.fromEntries(Object.entries(values).map(([key,value])=>[p+key,value]));
export function neo75hProtocols(variant){
  return {...prefix('motorEncoder',{...angle,DataOffset:1,ValueScale:2*Math.PI/131072}),...prefix('outputEncoder',{...angle,DataOffset:4,ValueScale:2*Math.PI/524288}),...(torque[variant]?prefix('torqueSensor',torque[variant]):{})};
}
