#include "current.h"
#include "control.h"
#include "math_utils.h"
void current_step(const CurrentInput *i, CurrentOutput *o, CurrentState *s)
{
    o->voltage_dq[0] = 0; o->voltage_dq[1] = 0; o->saturated = false;
    if (!i->enable) { s->integral_dq[0] = 0; s->integral_dq[1] = 0; s->latched_faults = 0; o->fault_flags = 0; return; }
    s->latched_faults |= control_current_faults(i->current_dq, i->reference_dq,
        i->feedback_valid, i->dt, i->voltage_limit, current_config.max_current,
        i->now_us, i->reference_time_us, current_config.reference_timeout_us);
    o->fault_flags = s->latched_faults;
    if (o->fault_flags) { s->integral_dq[0] = 0; s->integral_dq[1] = 0; return; }
    float ref[2] = {i->reference_dq[0], i->reference_dq[1]};
    float magnitude = hypotf(ref[0], ref[1]);
    if (magnitude > current_config.max_current) for (unsigned n = 0; n < 2; ++n) ref[n] *= current_config.max_current / magnitude;
    float voltage[2], next_integral[2];
    for (unsigned n = 0; n < 2; ++n) {
        float error = ref[n] - i->current_dq[n];
        next_integral[n] = clamp_f32(s->integral_dq[n] + current_config.ki * error * i->dt, -i->voltage_limit, i->voltage_limit);
        voltage[n] = current_config.kp[n] * error + next_integral[n];
    }
    magnitude = hypotf(voltage[0], voltage[1]);
    if (control_numeric_fault(magnitude)) { s->latched_faults |= control_numeric_fault(magnitude); o->fault_flags = s->latched_faults; return; }
    o->saturated = magnitude > i->voltage_limit;
    for (unsigned n = 0; n < 2; ++n) {
        o->voltage_dq[n] = o->saturated ? voltage[n] * i->voltage_limit / magnitude : voltage[n];
        /* Back-calculation prevents winding up against the vector limit. */
        s->integral_dq[n] = clamp_f32(next_integral[n] + o->voltage_dq[n] - voltage[n], -i->voltage_limit, i->voltage_limit);
    }
}
