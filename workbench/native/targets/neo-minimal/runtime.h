#ifndef NEO_MINIMAL_RUNTIME_H
#define NEO_MINIMAL_RUNTIME_H
#include <stdint.h>
typedef struct { uint32_t enable,calibrate,cancel,reset_fault; float speed_rpm,current_limit_a; } LocalCommand;
typedef struct {
    uint32_t state,faults,calibration_phase,calibration_error,calibration_valid;
    int32_t encoder_direction;
    float electrical_offset,motor_angle,motor_velocity,joint_rpm,bus_voltage;
    float phase_current[3],current_dq[2],reference_dq[2],duty[3];
    uint32_t encoder_frames,encoder_errors,cycle_us,max_cycle_us;
} Telemetry;
extern volatile LocalCommand command;
extern volatile Telemetry telemetry;
void firmware_initialize(void);
#endif
