#include "core.h"
#include "peripherals.h"
#include "protection.h"
#include "control.h"
#include "feedback.h"
#include "current.h"
#include "modulation.h"
#include "friction.h"
#include "scheduler.h"
#include "motion.h"
#include "commands.h"
#include "records.h"
#include "diagnostics.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
int main(void){
    CoreInput ci={.now_us=0xfffffff0u,.boot_ready=true};CoreOutput co={0};CoreState cs={0};
    core_step(&ci,&co,&cs);assert(co.ready);ci.now_us=4;core_step(&ci,&co,&cs);assert(co.elapsed_us==20);ci.clock_fault=true;core_step(&ci,&co,&cs);assert(!co.ready);
    ProtectionInput pi={.trip_flags=4};ProtectionOutput po={0};ProtectionState ps={0};
    protection_step(&pi,&po,&ps);assert(po.trip_latched&&!po.gate_permitted);pi.trip_flags=0;pi.reset_request=true;protection_step(&pi,&po,&ps);assert(po.trip_latched);pi.output_disabled=true;protection_step(&pi,&po,&ps);assert(po.gate_permitted);
    ControlInput li={.enable_request=true,.hardware_ready=true,.calibration_valid=true,.feedback_valid=true};ControlOutput lo={0};ControlState ls={0};
    control_step(&li,&lo,&ls);assert(lo.enabled);li.feedback_valid=false;control_step(&li,&lo,&ls);assert(!lo.enabled&&lo.fault_flags);li.feedback_valid=true;control_step(&li,&lo,&ls);assert(!lo.enabled);
    PeripheralsInput bi={.phase_current={1,-0.5f,-0.5f},.bus_voltage=48,.sample_valid=true,.duty_request={0.4f,0.5f,0.6f},.gate_request=true};PeripheralsOutput bo={0};PeripheralsState bs={0};
    peripherals_step(&bi,&bo,&bs);assert(bo.gate_enable&&bo.sequence==1);bi.duty_request[0]=NAN;peripherals_step(&bi,&bo,&bs);assert(!bo.gate_enable&&bo.duty[0]==0.5f);bi.phase_current[0]=INFINITY;peripherals_step(&bi,&bo,&bs);assert(!bo.valid);
    CurrentInput ii={.reference_dq={0,10},.voltage_limit=2,.dt=0.00005f,.feedback_valid=true,.enable=true};CurrentOutput io={0};CurrentState is={0};
    for(unsigned n=0;n<10000;++n){current_step(&ii,&io,&is);assert(hypotf(io.voltage_dq[0],io.voltage_dq[1])<=2.00001f&&isfinite(is.integral_dq[1]));}
    ii.current_dq[0]=100;current_step(&ii,&io,&is);assert(io.fault_flags&2);assert(io.voltage_dq[1]==0);ii.enable=false;current_step(&ii,&io,&is);assert(!io.fault_flags);ii.enable=true;ii.current_dq[0]=0;ii.now_us=10000;current_step(&ii,&io,&is);assert(io.fault_flags&4);
    ModulationInput mi={.phase_current={1,-0.5f,-0.5f},.voltage_dq={2,0},.bus_voltage=48,.enable=true};ModulationOutput mo={0};ModulationState ms={0};
    modulation_step(&mi,&mo,&ms);assert(mo.valid&&fabsf(mo.current_dq[0]-1)<1e-6f&&fabsf(mo.current_dq[1])<1e-6f);assert(fabsf((mo.duty[0]-mo.duty[1])*48-3)<1e-5f);
    /* One sample, then transform -> current loop -> modulation -> PWM in this cycle. */
    bi.phase_current[0]=1;bi.duty_request[0]=0.5f;bi.trip=false;
    uint32_t sequence_before=bo.sequence;
    peripherals_sample(&bi,&bo,&bs);assert(bo.sequence==sequence_before+1);
    mi.voltage_dq[0]=NAN;modulation_transform(&mi,&mo,&ms);
    assert(mo.valid&&fabsf(mo.current_dq[0]-1)<1e-6f);
    ii.enable=false;current_step(&ii,&io,&is);ii.enable=true;
    ii.now_us=ii.reference_time_us=10000;ii.current_dq[0]=mo.current_dq[0];ii.current_dq[1]=mo.current_dq[1];
    current_step(&ii,&io,&is);assert(!io.fault_flags);
    memcpy(mi.voltage_dq,io.voltage_dq,sizeof(mi.voltage_dq));modulation_update(&mi,&mo,&ms);
    memcpy(bi.duty_request,mo.duty,sizeof(bi.duty_request));peripherals_apply(&bi,&bo,&bs);
    assert(bo.gate_enable&&bo.sequence==sequence_before+1&&bo.duty[0]==mo.duty[0]);
    bi.trip=true;peripherals_apply(&bi,&bo,&bs);assert(!bo.gate_enable);
    mi.bus_voltage=0;modulation_step(&mi,&mo,&ms);assert(!mo.valid&&mo.duty[0]==0.5f);
    FeedbackInput fi={.motor_angle=6.27f,.motor_valid=true,.sample_time_us=100};FeedbackOutput fo={0};FeedbackState fs={0};
    feedback_step(&fi,&fo,&fs);assert(fo.valid);fi.motor_angle=0.01f;fi.sample_time_us=1100;feedback_step(&fi,&fo,&fs);assert(fo.valid&&fo.motor_velocity>0&&fo.motor_velocity<30);
    FrictionInput fci={.joint_velocity=1,.valid=true,.enable=true};FrictionOutput fco={0};FrictionState fcs={0};
    friction_step(&fci,&fco,&fcs);float positive=fco.torque;fci.joint_velocity=-1;friction_step(&fci,&fco,&fcs);assert(positive>0&&fabsf(fco.torque+positive)<1e-6f);fci.enable=false;friction_step(&fci,&fco,&fcs);assert(fco.torque==0);
    SchedulerInput si={.now_us=0};SchedulerOutput so={0};SchedulerState ss={0};
    scheduler_step(&si,&so,&ss);assert(so.release_mask==((1u<<scheduler_config.task_count)-1u));si.now_us=100;scheduler_step(&si,&so,&ss);assert(!so.release_mask);si.now_us=600;scheduler_step(&si,&so,&ss);assert(so.release_mask==1&&ss.missed_deadlines[0]==2);
    MotionInput mpi={.requested_iq=10,.dynamic_limit=2,.enabled=true,.command_valid=true};MotionOutput mpo={0};MotionState mps={0};motion_step(&mpi,&mpo,&mps);assert(mpo.valid&&mpo.reference_dq[1]==2);mpi.command_valid=false;motion_step(&mpi,&mpo,&mps);assert(!mpo.valid&&mpo.reference_dq[1]==0);
    CommandsInput qi={.sequence=0xffffffffu,.received=true,.frame_valid=true,.iq=2};CommandsOutput qo={0};CommandsState qs={0};
    commands_step(&qi,&qo,&qs);assert(qo.valid);qi.sequence=0;qi.iq=3;commands_step(&qi,&qo,&qs);assert(qo.valid&&qo.iq==3);qi.iq=4;commands_step(&qi,&qo,&qs);assert(qo.iq==3&&qs.rejected_count==1);qi.received=false;qi.now_us=100000;commands_step(&qi,&qo,&qs);assert(!qo.valid);
    RecordsInput ri={.sequence=7,.length=9,.commit=true};memcpy(ri.payload,"123456789",9);RecordsOutput ro={0};RecordsState rs={0};
    records_step(&ri,&ro,&rs);assert(ro.write_request&&ro.crc32==0xcbf43926u);ri.sequence=8;records_step(&ri,&ro,&rs);assert(!ro.write_request&&ro.sequence==7);ri.storage_done=true;ri.storage_ok=true;records_step(&ri,&ro,&rs);assert(ro.committed&&rs.committed_sequence==7);
    DiagnosticsInput di={.enabled=true,.command_valid=false};DiagnosticsOutput dout={0};DiagnosticsState ds={0};diagnostics_step(&di,&dout,&ds);assert(dout.stop_request&&dout.new_event);di.enabled=false;di.command_valid=true;di.reset_request=true;di.output_disabled=true;diagnostics_step(&di,&dout,&ds);assert(!dout.stop_request);
    puts("module runtime: independent state, control limits, timing, command freshness and transactions passed");
}
