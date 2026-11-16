#include "board.h"
#include "runtime.h"
#include "drivers.h"
#include "feedback.h"
#include "current.h"
#include "modulation.h"
#include "motion.h"
#include "zeroing.h"
#include "math_utils.h"
#include <string.h>

/* Debugger API: set speed/current first, enable last. Boot never enables power. */
volatile LocalCommand command={.current_limit_a=2};
volatile Telemetry telemetry;
static DriversOutput sensors;
static DriversState driver_state;
static FeedbackOutput feedback;
static FeedbackState feedback_state;
static CurrentOutput current;
static CurrentState current_state;
static ModulationOutput modulation;
static ModulationState modulation_state;
static MotionOutput motion;
static MotionState motion_state;
static ZeroingOutput calibration;
static ZeroingState calibration_state;
static float offset_sum[3],adc_offset[3];
static uint32_t offset_count,ticks,last_sequence,reference_time;
static bool enable_previous,run_requested;

void firmware_fault(uint32_t flags)
{
    telemetry.faults |= flags; run_requested=false; board_stop();
}
void firmware_tick(const uint16_t raw[4],uint32_t now)
{
    uint32_t started=board_now_us(); ++ticks;
    DriversInput receive={.channel=0,.now_us=now,.request=true};
    receive.rx_length=(uint16_t)board_encoder_receive(receive.rx_data);
    drivers_step(driver_config,&receive,&sensors,&driver_state);
    if(sensors.tx_request) {
        DriversInput ack={.channel=0,.now_us=now,.tx_complete=true};
        ack.transport_status=board_encoder_send(sensors.tx_data,sensors.tx_length)?0:-1;
        drivers_step(driver_config,&ack,&sensors,&driver_state);
    }
    telemetry.encoder_frames=sensors.sequence[0]; telemetry.encoder_errors=driver_state.rejected_frames[0];
    telemetry.bus_voltage=(float)raw[3]*0.0038269043f;
    if(offset_count<1024) {
        for(unsigned n=0;n<3;n++) offset_sum[n]+=raw[n];
        if(++offset_count==1024) for(unsigned n=0;n<3;n++) {
            adc_offset[n]=offset_sum[n]/1024;
            if(fabsf(adc_offset[n]-8192)>410) firmware_fault(FAULT_OFFSET);
        }
        board_stop(); return;
    }
    float phases[3]; bool adc_ok=true;
    for(unsigned n=0;n<3;n++) {
        phases[n]=((float)raw[n]-adc_offset[n])*(3.3f/(16384*0.025f));
        telemetry.phase_current[n]=phases[n];
        if(raw[n]<32 || raw[n]>16351 || fabsf(phases[n])>8) adc_ok=false;
    }
    if(!adc_ok) firmware_fault(FAULT_CURRENT);
    bool bus_ok=telemetry.bus_voltage>=24 && telemetry.bus_voltage<=60;
    if((run_requested||calibration.busy) && !bus_ok) firmware_fault(FAULT_BUS);
    if((run_requested||calibration.busy) && !sensors.valid[0]) firmware_fault(FAULT_ENCODER);
    if(sensors.valid[0] && sensors.sequence[0]!=last_sequence) {
        FeedbackInput input={.motor_valid=true,.motor_angle=wrap_angle(sensors.value[0]*(calibration.complete?(float)calibration.direction:1)),
            .sample_time_us=sensors.sample_time_us[0],.electrical_offset=calibration.complete?calibration.offset:0};
        feedback_step(&input,&feedback,&feedback_state); last_sequence=sensors.sequence[0];
    }
    bool feedback_ok=sensors.valid[0] && feedback.valid;
    telemetry.motor_angle=sensors.value[0]; telemetry.motor_velocity=feedback.motor_velocity;
    telemetry.joint_rpm=motion_state.filtered_velocity*60/MATH_TWO_PI;
    if(ticks%20==0) {
        bool enable=command.enable!=0;
        bool cancel=command.cancel!=0; command.cancel=0;
        if(command.reset_fault) {
            command.reset_fault=0;
            if(!enable && !calibration.busy && adc_ok && bus_ok && sensors.valid[0] && !(telemetry.faults&FAULT_OFFSET)) {
                telemetry.faults=0; calibration.error=0;
            }
        }
        bool start=command.calibrate!=0; command.calibrate=0;
        bool previous_busy=calibration.busy;
        ZeroingInput cal={.motor_angle=sensors.value[0],.dt=0.001f,.sample_valid=sensors.valid[0],
            .start=start && !enable && !run_requested,.cancel=cancel,.permitted=bus_ok && adc_ok && !telemetry.faults && !run_requested};
        zeroing_step(&cal,&calibration,&calibration_state);
        if(calibration.error && calibration.error!=1 && !telemetry.faults) firmware_fault(FAULT_CALIBRATION);
        if(previous_busy && !calibration.busy && calibration.complete && !calibration.error) { memset(&feedback_state,0,sizeof(feedback_state)); feedback_ok=false; }
        if(enable && !enable_previous && calibration.complete && !calibration.busy && feedback_ok && bus_ok && !telemetry.faults) run_requested=true;
        if(!enable || cancel) run_requested=false;
        enable_previous=enable;
        float limit=command.current_limit_a;
        MotionInput input={.requested_velocity=command.speed_rpm*MATH_TWO_PI/60,.motor_velocity=feedback.motor_velocity,
            .dt=0.001f,.speed_mode=true,.feedback_valid=feedback_ok,.dynamic_limit=limit,.enabled=run_requested,
            .command_valid=isfinite(limit) && limit>=0 && limit<=5 && isfinite(command.speed_rpm)};
        motion_step(&input,&motion,&motion_state); reference_time=now;
        if(run_requested && !motion.valid) firmware_fault(FAULT_NUMERIC);
    }
    /* Calibration owns the same current controller; normal speed output is mutually exclusive. */
    bool enabled=(calibration.busy||run_requested) && !telemetry.faults && feedback_ok && bus_ok;
    float angle=calibration.busy?calibration.forced_angle:feedback.electrical_angle;
    ModulationInput mod={.electrical_angle=angle,.bus_voltage=telemetry.bus_voltage,.enable=enabled};
    memcpy(mod.phase_current,phases,sizeof(phases)); modulation_transform(&mod,&modulation,&modulation_state);
    CurrentInput input={.enable=enabled,.feedback_valid=feedback_ok&&modulation.valid,.dt=0.00005f,
        .voltage_limit=telemetry.bus_voltage*0.45f,.now_us=now,.reference_time_us=reference_time};
    memcpy(input.current_dq,modulation.current_dq,sizeof(input.current_dq));
    if(calibration.busy) { input.reference_dq[0]=calibration.reference_id; input.reference_time_us=now; }
    else memcpy(input.reference_dq,motion.reference_dq,sizeof(input.reference_dq));
    current_step(&input,&current,&current_state);
    if(current.fault_flags) firmware_fault(FAULT_CURRENT);
    mod.enable=enabled&&!telemetry.faults; memcpy(mod.voltage_dq,current.voltage_dq,sizeof(mod.voltage_dq));
    modulation_update(&mod,&modulation,&modulation_state);
    if(mod.enable&&!modulation.valid) firmware_fault(FAULT_NUMERIC);
    board_output(modulation.duty,mod.enable&&modulation.valid&&!telemetry.faults);
    telemetry.state=telemetry.faults?4:calibration.busy?2:run_requested?3:calibration.complete?1:0;
    telemetry.calibration_valid=calibration.complete; telemetry.calibration_phase=calibration.phase;
    telemetry.calibration_error=calibration.error; telemetry.encoder_direction=calibration.direction;
    telemetry.electrical_offset=calibration.offset;
    for(unsigned n=0;n<2;n++) { telemetry.current_dq[n]=input.current_dq[n]; telemetry.reference_dq[n]=input.reference_dq[n]; }
    for(unsigned n=0;n<3;n++) telemetry.duty[n]=modulation.duty[n];
    telemetry.cycle_us=board_now_us()-started;
    if(telemetry.cycle_us>telemetry.max_cycle_us) telemetry.max_cycle_us=telemetry.cycle_us;
}
void firmware_initialize(void) { drivers_reset(&sensors,&driver_state,board_now_us()); }
#ifndef NEO_HOST_TEST
int main(void)
{
    board_init(); firmware_initialize(); board_start();
    /* Keep AXI SRAM accessible for live debugger commands and telemetry. */
    for(;;) __NOP();
}
#endif
