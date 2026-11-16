#include <assert.h>
#include <math.h>
#include <stdio.h>
#include "zeroing.h"
#include "motion.h"
#include "math_utils.h"

static void calibration_case(int direction,float actual_poles,bool stalled)
{
    ZeroingOutput o={0}; ZeroingState s={0};
    const float offset=0.73f;
    float electrical=0,previous=0;
    for(unsigned n=0;n<14000;n++) {
        if(!stalled) electrical+=wrap_angle_signed(o.forced_angle-previous);
        previous=o.forced_angle;
        ZeroingInput i={.motor_angle=wrap_angle(direction*(electrical+offset)/actual_poles),.dt=0.001f,.sample_valid=true,.start=n==0,.permitted=true};
        zeroing_step(&i,&o,&s);
        assert(isfinite(o.reference_id)&&o.reference_id>=0&&o.reference_id<=5);
        if(o.error||o.complete)break;
    }
    if(stalled||actual_poles!=10) { assert(!o.complete&&o.error==3&&!o.busy&&o.reference_id==0); }
    else { assert(o.complete&&!o.busy&&o.error==0&&o.direction==direction); assert(fabsf(wrap_angle_signed(o.offset-offset))<0.002f); }
}
static void calibration_faults(void)
{
    ZeroingOutput o={0}; ZeroingState s={0};
    ZeroingInput i={.motor_angle=0,.dt=0.001f,.sample_valid=true,.start=true,.permitted=true};
    zeroing_step(&i,&o,&s); assert(o.busy);
    i.start=false; i.sample_valid=false; zeroing_step(&i,&o,&s); assert(!o.busy&&o.reference_id==0&&o.error==2);
    i.start=true;i.sample_valid=true;zeroing_step(&i,&o,&s);assert(o.busy);
    i.cancel=true;zeroing_step(&i,&o,&s);assert(!o.busy&&o.reference_id==0&&o.error==1);
    i.cancel=false;zeroing_step(&i,&o,&s);assert(!o.busy); /* No held-command restart. */
    i.start=false;zeroing_step(&i,&o,&s);i.start=true;i.permitted=false;zeroing_step(&i,&o,&s);assert(!o.busy);
    i.start=false;i.permitted=true;zeroing_step(&i,&o,&s);i.start=true;i.dt=NAN;zeroing_step(&i,&o,&s);assert(o.error==2&&!o.busy);
    i.start=false;i.dt=0.001f;zeroing_step(&i,&o,&s);
    o.complete=true;o.offset=1.0f;o.direction=-1;
    i.start=true;zeroing_step(&i,&o,&s);i.cancel=true;zeroing_step(&i,&o,&s);
    assert(!o.busy&&o.reference_id==0&&o.complete&&o.offset==1.0f&&o.direction==-1);
}
static void speed_loop(void)
{
    MotionOutput o={0};MotionState s={0};
    MotionInput i={.requested_velocity=0.1f,.dt=0.001f,.speed_mode=true,.feedback_valid=true,.enabled=true,.command_valid=true,.dynamic_limit=2};
    float velocity=0;
    for(unsigned n=0;n<30000;n++) {
        if(n==15000)i.requested_velocity=-0.1f;
        i.motor_velocity=velocity*51;
        float previous=s.velocity_reference;
        motion_step(&i,&o,&s);
        assert(o.valid&&fabsf(o.reference_dq[1])<=2&&o.reference_dq[0]==0);
        assert(fabsf(s.velocity_reference-previous)<=0.000201f);
        velocity+=(o.reference_dq[1]*0.4f-velocity*0.1f)*i.dt;
        if(n==14999)assert(fabsf(velocity-0.1f)<0.01f);
    }
    assert(fabsf(velocity+0.1f)<0.01f);
    i.requested_velocity=100;
    for(unsigned n=0;n<5000;n++){i.motor_velocity=0;motion_step(&i,&o,&s);assert(fabsf(o.reference_dq[1])<=2);}
    assert(s.velocity_reference<=motion_config.speed_limit+0.0001f);
    i.feedback_valid=false;motion_step(&i,&o,&s);assert(!o.valid&&o.reference_dq[1]==0&&s.integral==0);
    i.feedback_valid=true;i.requested_velocity=NAN;motion_step(&i,&o,&s);assert(!o.valid&&o.reference_dq[1]==0);
    i.requested_velocity=0.1f;i.enabled=false;motion_step(&i,&o,&s);assert(!o.valid&&o.reference_dq[1]==0);
}
int main(void)
{
    calibration_case(1,10,false);calibration_case(-1,10,false);
    calibration_case(1,10,true);calibration_case(1,8,false);
    calibration_faults();speed_loop();puts("minimal speed and calibration passed");
}
