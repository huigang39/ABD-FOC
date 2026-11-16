/* Electrical + mechanical host plant exercises the actual target assembly. */
#include "board.h"
#include "runtime.h"
#include "math_utils.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint32_t now;
static bool gate,reply_pending,drop_encoder;
static float duty[3],theta=0.1f,omega,alpha,beta;
static int sign=1;
uint32_t board_now_us(void) {return now;}
void board_stop(void) {gate=false;}
void board_output(const float values[3],bool enabled) {gate=enabled;memcpy(duty,values,sizeof(duty));}
bool board_encoder_send(const uint8_t *data,unsigned length) {assert(length==1&&data[0]==0x3b);reply_pending=true;return true;}
unsigned board_encoder_receive(uint8_t *data)
{
    if(!reply_pending||drop_encoder)return 0;
    reply_pending=false;
    uint32_t count=(uint32_t)(wrap_angle(sign*(theta+0.73f/10))*131072/MATH_TWO_PI);
    uint8_t frame[9]={0x3b,(uint8_t)count,(uint8_t)(count>>8),(uint8_t)(count>>16),0,0,0,0,0};
    for(unsigned n=0;n<8;n++)frame[8]^=frame[n];
    memcpy(data,frame,9);return 9;
}
static void tick(void)
{
    const float dt=0.00005f,voltage=50;
    float electrical=theta*10;
    float va=gate?voltage*(2*duty[0]-duty[1]-duty[2])/3:0;
    float vb=gate?voltage*(duty[1]-duty[2])*0.57735026919f:0;
    alpha+=(va-0.15f*alpha+omega*10*0.007977f*sinf(electrical))*dt/0.00018225f;
    beta+=(vb-0.15f*beta-omega*10*0.007977f*cosf(electrical))*dt/0.00018225f;
    float iq=-alpha*sinf(electrical)+beta*cosf(electrical);
    omega+=(1.5f*10*0.007977f*iq-0.01f*omega)*dt/0.001f;
    theta+=omega*dt;
    float phase[3]={alpha,-alpha*0.5f+beta*0.8660254f,-alpha*0.5f-beta*0.8660254f};
    uint16_t raw[4];for(unsigned n=0;n<3;n++)raw[n]=(uint16_t)clamp_f32(8192+phase[n]*(16384*0.025f/3.3f),0,16383);
    raw[3]=(uint16_t)(voltage/0.0038269043f);now+=50;firmware_tick(raw,now);
}
int main(int argc,char **argv)
{
    sign=argc>1&&argv[1][0]=='-'?-1:1;
    firmware_initialize();
    for(unsigned n=0;n<6000;n++){tick();assert(!gate);} /* no automatic power */
    command.enable=1;for(unsigned n=0;n<40;n++){tick();assert(!gate);} /* calibration required */
    command.enable=0;command.calibrate=1;
    for(unsigned n=0;n<220000 && !telemetry.calibration_valid;n++) {
        tick();
        if(telemetry.faults){fprintf(stderr,"cal fault %u phase %u error %u at %u\n",telemetry.faults,telemetry.calibration_phase,telemetry.calibration_error,now);return 1;}
    }
    assert(telemetry.calibration_valid&&telemetry.encoder_direction==sign&&!gate);
    assert(fabsf(wrap_angle_signed(telemetry.electrical_offset-0.73f))<0.08f);
    command.speed_rpm=1;command.enable=1;
    for(unsigned n=0;n<200000;n++){tick();assert(!telemetry.faults);}
    assert(gate&&telemetry.state==3&&fabsf(telemetry.joint_rpm-1)<0.1f);
    command.speed_rpm=-1;
    for(unsigned n=0;n<200000;n++){tick();assert(!telemetry.faults);}
    assert(gate&&fabsf(telemetry.joint_rpm+1)<0.1f);
    drop_encoder=true;
    for(unsigned n=0;n<10;n++)tick();
    assert(!gate&&(telemetry.faults&FAULT_ENCODER));
    drop_encoder=false;
    for(unsigned n=0;n<100;n++){tick();assert(!gate);} /* fault never auto-restarts */
    command.enable=0;command.reset_fault=1;for(unsigned n=0;n<40;n++)tick();assert(!telemetry.faults&&!gate);
    command.enable=1;for(unsigned n=0;n<40;n++)tick();assert(gate);
    command.enable=0;for(unsigned n=0;n<20;n++)tick();assert(!gate);
    puts("target assembly plant, interlocks and encoder dropout passed");
}
