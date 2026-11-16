#include "peripherals.h"
#include <math.h>
#include <string.h>
void peripherals_sample(const PeripheralsInput *i, PeripheralsOutput *o, PeripheralsState *s)
{
    o->valid = i->sample_valid && isfinite(i->bus_voltage) && i->bus_voltage > 0.0f;
    for (unsigned n = 0; n < 3; ++n) {
        o->valid = o->valid && isfinite(i->phase_current[n]);
    }
    if (o->valid) {
        memcpy(o->phase_current, i->phase_current, sizeof(o->phase_current));
        o->bus_voltage = i->bus_voltage; o->sample_time_us = i->sample_time_us;
        o->sequence = ++s->sample_sequence;
    } else ++s->rejected_samples;
}
void peripherals_apply(const PeripheralsInput *i, PeripheralsOutput *o, PeripheralsState *s)
{
    (void)s;
    bool duty_valid = true;
    for (unsigned n = 0; n < 3; ++n) duty_valid = duty_valid && isfinite(i->duty_request[n]) && i->duty_request[n] >= 0.0f && i->duty_request[n] <= 1.0f;
    o->gate_enable = i->gate_request && !i->trip && o->valid && duty_valid;
    for (unsigned n = 0; n < 3; ++n) o->duty[n] = o->gate_enable ? i->duty_request[n] : 0.5f;
}

void peripherals_step(const PeripheralsInput *i, PeripheralsOutput *o, PeripheralsState *s)
{
    peripherals_sample(i, o, s);
    peripherals_apply(i, o, s);
}
