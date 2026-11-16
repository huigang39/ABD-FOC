#include "control.h"
#include <math.h>
void control_step(const ControlInput *i, ControlOutput *o, ControlState *s)
{
    s->latched_faults |= i->fault_flags;
    if (i->enable_request && s->previous_enable && !i->feedback_valid) s->latched_faults |= 0x80000000u;
    if (i->reset_request && !i->enable_request && !i->fault_flags) s->latched_faults = 0;
    o->enabled = i->enable_request && i->hardware_ready && i->calibration_valid && i->feedback_valid && !s->latched_faults;
    o->state = s->latched_faults ? 2u : o->enabled ? 1u : 0u;
    o->fault_flags = s->latched_faults; s->previous_enable = o->enabled;
}


/* Shared algorithm exception predicates, called before producing control output. */
uint32_t control_current_faults(const float measured[2], const float reference[2],
    bool feedback_valid, float dt, float voltage_limit, float current_limit,
    uint32_t now_us, uint32_t reference_time_us, uint32_t timeout_us)
{
    uint32_t faults = 0;
    if (!feedback_valid || !isfinite(dt) || dt <= 0 ||
        !isfinite(voltage_limit) || voltage_limit <= 0 ||
        !isfinite(current_limit) || current_limit <= 0) faults |= 1u;
    for (unsigned n = 0; n < 2; ++n) {
        if (!isfinite(measured[n]) || !isfinite(reference[n])) faults |= 1u;
        else if (fabsf(measured[n]) > current_limit) faults |= 2u;
    }
    if (!timeout_us || (uint32_t)(now_us - reference_time_us) >= timeout_us) faults |= 4u;
    return faults;
}
uint32_t control_numeric_fault(float value)
{
    return isfinite(value) ? 0u : 1u;
}
