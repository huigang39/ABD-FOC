/** Runtime ABI used by the generated, device-independent driver engine. */
export const DRIVER_CHANNELS = 4;
export const DRIVER_FRAME_BYTES = 64;
export const DRIVER_TX_BYTES = 32;
export const DRIVER_COMMANDS_MAX = 4;
const fields=(role,rows)=>rows.map(([name,type,count,unit,meaning])=>({id:`hw-drivers-${role}-${name}`,name,type,count,unit,meaning}));
export const DRIVER_CONTRACTS = {
  input: {name:'DriversInput',rate:'event',fields:fields('input',[
    ['channel','u8',1,'','通道编号：0 电机侧编码器，1 出轴侧编码器，2 力矩传感器，3 预驱（门极驱动）'],
    ['now_us','u32',1,'us','单调时钟，按无符号差值处理回绕'],
    ['rx_data','u8',DRIVER_FRAME_BYTES,'byte','本次交付的接收字节；支持分段和连续多帧'],
    ['rx_length','u16',1,'byte','本次有效接收字节数，最大 64'],
    ['request','bool',1,'','调度器请求一次采样或启动上传'],
    ['tx_complete','bool',1,'','本次携带发送提交结果'],
    ['transport_status','i32',1,'','发送提交结果，0 成功，非 0 失败；失败后可重试'],
    ['reset','bool',1,'','复位当前通道的接收、发送和有效性状态'],
  ])},
  output: {name:'DriversOutput',rate:'event',fields:fields('output',[
    ['value','f32',DRIVER_CHANNELS,'','主数据命令的通道换算值；0/1 为 rad，2 为所配置的力矩接口单位；3 预留给预驱通道，无测量值'],
    ['raw','u32',DRIVER_CHANNELS,'','本次有效数值的原始位模式'],
    ['sample_time_us','u32',DRIVER_CHANNELS,'us','最近一次通过校验的主数据接收时刻'],
    ['sequence','u32',DRIVER_CHANNELS,'','每收到一帧有效主数据递增'],
    ['valid','bool',DRIVER_CHANNELS,'','已收到有效主数据帧且未超时；失效后不得继续用于闭环；3 号预驱通道无主数据，valid[3] 由故障状态判定'],
    ['error','u32',DRIVER_CHANNELS,'','位标志：1 配置，2 帧校验，4 数值，8 超时，16 传输，32 器件状态；error[3] 承载预驱故障'],
    ['device_status','u32',DRIVER_CHANNELS,'','主数据或状态命令帧提取的器件状态字节，不按厂商解释；device_status[3] 承载预驱故障状态'],
    ['tx_data','u8',DRIVER_TX_BYTES,'byte','通用引擎生成的待发送字节，提交给所绑定的外设'],
    ['tx_length','u16',1,'byte','待发送字节数'],
    ['tx_channel','u8',1,'','发送所属通道'],
    ['tx_request','bool',1,'','本次产生发送请求；外设提交后反馈 tx_complete'],
  ])},
  state: {name:'DriversState',rate:'event',fields:fields('state',[
    ['rx_buffer','u8',DRIVER_CHANNELS*DRIVER_FRAME_BYTES,'byte','四个通道各 64 字节的拼帧缓冲'],
    ['rx_size','u16',DRIVER_CHANNELS,'byte','各通道已缓存字节数'],
    ['last_tx_us','u32',DRIVER_CHANNELS,'us','最近一次成功提交发送的时刻'],
    ['start_us','u32',DRIVER_CHANNELS,'us','通道复位时刻，用于启动等待'],
    ['tx_pending','bool',DRIVER_CHANNELS,'','等待外设反馈发送提交结果'],
    ['waiting_response','bool',DRIVER_CHANNELS,'','请求已发送，等待应答或超时'],
    ['command_started','bool',DRIVER_CHANNELS*DRIVER_COMMANDS_MAX,'','各命令是否已成功提交；主动上传与其他指令只发一次'],
    ['received','bool',DRIVER_CHANNELS,'','至少收到一帧有效主数据'],
    ['rejected_frames','u32',DRIVER_CHANNELS,'','校验、数值或器件状态不合格的帧数'],
    ['dropped_bytes','u32',DRIVER_CHANNELS,'byte','寻找帧头或重同步时丢弃的字节数；空闲无流式命令时全部计入'],
    ['active_command','i8',DRIVER_CHANNELS,'','各通道在途命令下标；-1 空闲，空闲时按主动上传主数据命令流式解析'],
    ['last_status_us','u32',DRIVER_CHANNELS,'us','最近一次状态命令应答时刻，按执行周期轮询'],
  ])},
};
