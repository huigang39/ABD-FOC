#include "drivers.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
static DriversInput input;
static DriversOutput output;
static DriversState state;
static DriverConfig config[DRIVER_CHANNELS];
static void step(void){assert(drivers_step(config,&input,&output,&state)==0);}
static void feed(unsigned ch,const uint8_t *data,unsigned length,uint32_t now){
    input=(DriversInput){.channel=ch,.now_us=now,.rx_length=length};
    memcpy(input.rx_data,data,length);step();
}
static void setup(void){
    memset(config,0,sizeof(config));
    config[0]=(DriverConfig){.enabled=true,.command_count=1,.timeout_us=100,.commands={{.purpose=DRIVER_PURPOSE_DATA,.mode=DRIVER_REQUEST_RESPONSE,.request={0x10},.request_length=1,.header={0xaa,0x55},.header_length=2,.frame_length=5,.data_offset=2,.data_bits=16,.value_type=DRIVER_VALUE_SIGNED,.big_endian=true,.scale=1,.checksum=DRIVER_CHECK_XOR8,.status_offset=-1,.startup_delay_us=10}}};
    drivers_reset(&output,&state,0);input=(DriversInput){0};
}
int main(void){
    setup();
    /* Idle channel without an active upload command counts stray bytes as dropped. */
    const uint8_t junk[]={1,2};feed(0,junk,2,1);assert(state.dropped_bytes[0]==2&&!output.error[0]&&!output.valid[0]);
    input.request=true;input.now_us=9;step();assert(!output.tx_request);
    input.now_us=10;step();assert(output.tx_request&&output.tx_length==1&&output.tx_data[0]==0x10);
    step();assert(!output.tx_request); /* no second submission while pending */
    input.request=false;input.tx_complete=true;input.transport_status=-1;step();assert(output.error[0]&DRIVER_ERROR_TRANSPORT);
    input.tx_complete=false;input.request=true;step();assert(output.tx_request); /* failed submission can retry */
    input.request=false;input.tx_complete=true;input.transport_status=0;step();
    input.tx_complete=false;input.request=true;input.now_us=11;step();assert(!output.tx_request); /* await response */
    const uint8_t frame[]={0xaa,0x55,0xff,0xfe,0xfe};
    feed(0,frame,2,12);assert(!output.valid[0]);
    feed(0,frame+2,3,13);assert(output.valid[0]&&output.value[0]==-2&&output.sequence[0]==1);
    input=(DriversInput){.request=true,.now_us=14};step();assert(output.tx_request);
    /* Recover from noise and bad CRC, then consume two consecutive frames. */
    const uint8_t noise[]={0,0xaa,0x55,0xff,0xfe,0};feed(0,noise,sizeof(noise),15);assert(!output.valid[0]);
    uint8_t pair[10];memcpy(pair,frame,5);memcpy(pair+5,frame,5);feed(0,pair,10,16);
    assert(output.valid[0]&&output.sequence[0]==3&&state.rejected_frames[0]>0&&state.dropped_bytes[0]>0);
    input=(DriversInput){.now_us=116};step();assert(!output.valid[0]&&(output.error[0]&DRIVER_ERROR_TIMEOUT));

    /* Active upload is initialized once. A timeout must not send a new command. */
    setup();config[1]=config[0];config[1].commands[0].mode=DRIVER_ACTIVE_UPLOAD;config[1].commands[0].startup_delay_us=0;
    input=(DriversInput){.channel=1,.request=true,.now_us=1};step();assert(output.tx_request);
    input.tx_complete=true;step();assert(!output.tx_request&&state.command_started[DRIVER_COMMANDS_MAX]);
    input.tx_complete=false;
    for(unsigned n=2;n<1000;++n){input.now_us=n;step();assert(!output.tx_request);}
    assert(output.error[1]&DRIVER_ERROR_TIMEOUT);
    feed(1,frame,sizeof(frame),1000);assert(output.valid[1]);
    input=(DriversInput){.channel=1,.request=true,.now_us=1100};step();assert(!output.tx_request&&!output.valid[1]);
    input.reset=true;step();assert(output.tx_request); /* explicit reinitialization */
    config[1].commands[0].request_length=0;input.reset=true;step();assert(!output.tx_request&&state.command_started[DRIVER_COMMANDS_MAX]);

    /* Timestamp wrap, no startup or freshness error around uint32 rollover. */
    setup();drivers_reset(&output,&state,0xfffffff0u);
    input=(DriversInput){.request=true,.now_us=2};step();assert(output.tx_request);
    feed(0,frame,sizeof(frame),0xfffffffcu);input=(DriversInput){.now_us=2};step();assert(output.valid[0]);

    /* CRC-16/MODBUS standard check vector, with byte order independent of data. */
    setup();config[0].commands[0].mode=DRIVER_ACTIVE_UPLOAD;config[0].commands[0].header_length=0;config[0].commands[0].frame_length=11;config[0].commands[0].data_offset=0;config[0].commands[0].data_bits=8;
    config[0].commands[0].value_type=DRIVER_VALUE_UNSIGNED;config[0].commands[0].checksum=DRIVER_CHECK_MODBUS;
    const uint8_t modbus[]={'1','2','3','4','5','6','7','8','9',0x37,0x4b};
    feed(0,modbus,sizeof(modbus),1);assert(output.valid[0]&&output.value[0]==49);
    config[0].commands[0].checksum_start=11;input=(DriversInput){0};assert(drivers_step(config,&input,&output,&state)==-1);
    assert(output.error[0]==DRIVER_ERROR_CONFIG);

    /* Signed 24-bit extraction, fixed footer, and a separately checked status. */
    setup();config[0]=(DriverConfig){.enabled=true,.command_count=1,.timeout_us=100,.commands={{.purpose=DRIVER_PURPOSE_DATA,.mode=DRIVER_ACTIVE_UPLOAD,.header={0xaa},.header_length=1,.footer={0xcc,0x33},.footer_length=2,.frame_length=8,.data_offset=2,.data_bits=24,.value_type=DRIVER_VALUE_SIGNED,.scale=0.01f,.checksum=DRIVER_CHECK_SUM8,.checksum_start=1,.status_offset=1,.status_mask=3,.status_expected=0}}};
    uint8_t signed_frame[]={0xaa,0,0xff,0xff,0xff,0xfd,0xcc,0x33};
    feed(0,signed_frame,8,1);assert(output.valid[0]&&fabsf(output.value[0]+0.01f)<1e-6f);
    signed_frame[1]=1;signed_frame[5]=0xfe;feed(0,signed_frame,8,2);assert(!output.valid[0]&&output.error[0]==DRIVER_ERROR_STATUS&&output.device_status[0]==1);

    /* Floating point endian conversion rejects NaN and infinity without poisoning values. */
    setup();config[0]=(DriverConfig){.enabled=true,.command_count=1,.timeout_us=100,.commands={{.purpose=DRIVER_PURPOSE_DATA,.mode=DRIVER_ACTIVE_UPLOAD,.frame_length=4,.data_bits=32,.value_type=DRIVER_VALUE_FLOAT32,.big_endian=true,.scale=2,.offset=1,.status_offset=-1}}};
    const uint8_t one[]={0x3f,0x80,0,0},nan_value[]={0x7f,0xc0,0,0},infinity[]={0x7f,0x80,0,0};
    feed(0,one,4,1);assert(output.valid[0]&&output.value[0]==3);
    feed(0,nan_value,4,2);assert(!output.valid[0]&&output.error[0]==DRIVER_ERROR_VALUE&&output.value[0]==3);
    feed(0,infinity,4,3);assert(!output.valid[0]&&output.error[0]==DRIVER_ERROR_VALUE);
    input=(DriversInput){.rx_length=65};assert(drivers_step(config,&input,&output,&state)==-1);
    input=(DriversInput){.channel=DRIVER_CHANNELS};assert(drivers_step(config,&input,&output,&state)==-1);

    /* Config defense: command count cap and at most one data command per channel. */
    setup();config[0].command_count=DRIVER_COMMANDS_MAX+1u;input=(DriversInput){0};
    assert(drivers_step(config,&input,&output,&state)==-1);assert(output.error[0]==DRIVER_ERROR_CONFIG);
    config[0].command_count=2;config[0].commands[1]=config[0].commands[0];
    assert(drivers_step(config,&input,&output,&state)==-1); /* two data commands on one channel */
    config[0].commands[1].purpose=DRIVER_PURPOSE_STATUS;
    assert(drivers_step(config,&input,&output,&state)==0);

    /* Status commands poll on their period, interleave with data requests and never re-enter. */
    setup();config[0].command_count=2;
    config[0].commands[1]=(DriverCommand){.purpose=DRIVER_PURPOSE_STATUS,.mode=DRIVER_REQUEST_RESPONSE,.request={0x20},.request_length=1,.header={0xbb},.header_length=1,.frame_length=4,.data_offset=1,.data_bits=8,.value_type=DRIVER_VALUE_UNSIGNED,.scale=1,.checksum=DRIVER_CHECK_NONE,.status_offset=1,.status_mask=0x80,.status_expected=0,.period_us=50};
    const uint8_t status_frame[]={0xbb,0x00,0x11,0x22},status_bad[]={0xbb,0x80,0x11,0x22};
    input=(DriversInput){.request=true,.now_us=10};step();assert(output.tx_request&&output.tx_data[0]==0x10); /* data request first */
    input=(DriversInput){.tx_complete=true,.transport_status=0,.now_us=11};step();
    feed(0,frame,5,12);assert(output.valid[0]&&output.value[0]==-2&&output.sequence[0]==1);
    input=(DriversInput){.now_us=13};step();assert(!output.tx_request); /* no request and no due status */
    input.now_us=50;step();assert(output.tx_request&&output.tx_data[0]==0x20); /* status polls on its period */
    input=(DriversInput){.tx_complete=true,.transport_status=0,.now_us=51};step();
    input=(DriversInput){.request=true,.now_us=52};step();assert(!output.tx_request); /* no re-entry while the status answer is pending */
    feed(0,frame,5,53);assert(output.value[0]==-2&&output.sequence[0]==1&&state.dropped_bytes[0]>0); /* data-shaped frame must not write values */
    feed(0,status_frame,4,54);assert(output.device_status[0]==0&&output.valid[0]&&output.value[0]==-2&&state.last_status_us[0]==54);
    input=(DriversInput){.request=true,.now_us=104};step();assert(output.tx_request&&output.tx_data[0]==0x10); /* both due: data wins */
    input=(DriversInput){.tx_complete=true,.transport_status=0,.now_us=105};step();
    feed(0,frame,5,106);assert(output.sequence[0]==2&&output.valid[0]);
    assert(output.tx_request&&output.tx_data[0]==0x20); /* the freed channel immediately polls the due status */
    input=(DriversInput){.tx_complete=true,.transport_status=0,.now_us=107};step();
    feed(0,status_bad,4,112);
    assert(output.device_status[0]==0x80&&(output.error[0]&DRIVER_ERROR_STATUS)&&output.valid[0]&&output.sequence[0]==2&&state.rejected_frames[0]>0); /* mask mismatch flags status but keeps validity */
    input=(DriversInput){.now_us=162};step();assert(output.tx_request&&output.tx_data[0]==0x20); /* polls again after a full period */
    input=(DriversInput){.tx_complete=true,.transport_status=0,.now_us=163};step();
    feed(0,status_frame,4,164);assert(!(output.error[0]&DRIVER_ERROR_STATUS)&&output.device_status[0]==0); /* a good status answer clears the flag */

    /* Other commands are sent once after their own startup delay; only transport is accounted. */
    setup();config[0].command_count=2;
    config[0].commands[1]=(DriverCommand){.purpose=DRIVER_PURPOSE_OTHER,.mode=DRIVER_REQUEST_RESPONSE,.request={0x30},.request_length=1,.header={0xcc},.header_length=1,.frame_length=3,.data_offset=1,.data_bits=8,.value_type=DRIVER_VALUE_UNSIGNED,.scale=1,.checksum=DRIVER_CHECK_NONE,.status_offset=-1,.startup_delay_us=5};
    const uint8_t other_reply[]={0xcc,0,0};
    input=(DriversInput){.now_us=10};step();assert(output.tx_request&&output.tx_data[0]==0x30); /* data has no request; other passes its own delay */
    input=(DriversInput){.tx_complete=true,.transport_status=0,.now_us=11};step();
    feed(0,other_reply,3,12);assert(!output.valid[0]&&output.sequence[0]==0&&output.device_status[0]==0);
    for(unsigned n=13;n<40;++n){input=(DriversInput){.now_us=n};step();assert(!output.tx_request);} /* one-shot: never sent again */
    input=(DriversInput){.request=true,.now_us=40};step();assert(output.tx_request&&output.tx_data[0]==0x10); /* data requests still work */

    /* 第 4 通道为预驱：无主数据命令，仅状态轮询；故障字节写 device_status[3]，value[3] 永不写入。 */
    setup();
    config[3]=(DriverConfig){.enabled=true,.command_count=1,.timeout_us=100,.commands={{.purpose=DRIVER_PURPOSE_STATUS,.mode=DRIVER_REQUEST_RESPONSE,.request={0x02},.request_length=1,.header={0xbb},.header_length=1,.frame_length=4,.data_offset=1,.data_bits=8,.value_type=DRIVER_VALUE_UNSIGNED,.scale=1,.checksum=DRIVER_CHECK_NONE,.status_offset=1,.status_mask=0x80,.status_expected=0,.period_us=50}}};
    input=(DriversInput){.channel=3,.now_us=10};step();assert(!output.tx_request); /* 轮询周期未到 */
    input.now_us=50;step();assert(output.tx_request&&output.tx_channel==3&&output.tx_data[0]==0x02); /* 状态轮询按周期发出 */
    input=(DriversInput){.channel=3,.tx_complete=true,.transport_status=0,.now_us=51};step();
    const uint8_t gate_fault[]={0xbb,0x81,0,0},gate_ok[]={0xbb,0x01,0,0};
    feed(3,gate_fault,4,52);
    assert(output.device_status[3]==0x81&&(output.error[3]&DRIVER_ERROR_STATUS)&&!output.valid[3]);
    assert(output.value[3]==0&&output.raw[3]==0&&output.sequence[3]==0&&output.sample_time_us[3]==0); /* 无主数据：测量输出永不写入 */
    feed(3,gate_ok,4,53);
    assert(output.device_status[3]==0x81&&(output.error[3]&DRIVER_ERROR_STATUS)&&!output.valid[3]&&output.value[3]==0); /* 请求应答空闲期的非请求帧不得解除故障；下次轮询才更新。 */
    input=(DriversInput){.channel=3,.now_us=103};step();assert(output.tx_request&&output.tx_data[0]==0x02); /* 到期再次轮询 */
    input=(DriversInput){.channel=3,.tx_complete=true,.transport_status=0,.now_us=104};step();
    feed(3,gate_ok,4,105);assert(output.device_status[3]==0x01&&!(output.error[3]&DRIVER_ERROR_STATUS));
    puts("driver runtime: request/response, startup upload, streaming, CRC, endian, signed values, status, gate channel, command scheduling, timeout and bounds passed");
}
