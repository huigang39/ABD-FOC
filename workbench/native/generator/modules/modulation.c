#include "modulation.h"
#include "math_utils.h"
void modulation_transform(const ModulationInput *i, ModulationOutput *o, ModulationState *s)
{
    (void)s;
    o->valid = false; o->current_dq[0] = 0; o->current_dq[1] = 0;
    if (!isfinite(i->electrical_angle) || !isfinite(i->bus_voltage) || i->bus_voltage <= 0) return;
    for (unsigned n = 0; n < 3; ++n) if (!isfinite(i->phase_current[n])) return;
    float cosine = cosf(i->electrical_angle), sine = sinf(i->electrical_angle);
    float alpha = (2.0f * i->phase_current[0] - i->phase_current[1] - i->phase_current[2]) / 3.0f;
    float beta = (i->phase_current[1] - i->phase_current[2]) * 0.57735026919f;
    o->current_dq[0] = alpha * cosine + beta * sine;
    o->current_dq[1] = -alpha * sine + beta * cosine;
    o->valid = isfinite(o->current_dq[0]) && isfinite(o->current_dq[1]);
}
void modulation_update(const ModulationInput *i, ModulationOutput *o, ModulationState *s)
{
    for (unsigned n = 0; n < 3; ++n) o->duty[n] = 0.5f;
    if (!isfinite(i->electrical_angle) || !isfinite(i->bus_voltage) || i->bus_voltage <= 0) { o->valid = false; return; }
    for (unsigned n = 0; n < 2; ++n) if (!isfinite(i->voltage_dq[n])) { o->valid = false; return; }
    if (!o->valid || !i->enable) return;
    float cosine = cosf(i->electrical_angle), sine = sinf(i->electrical_angle);
    float alpha = i->voltage_dq[0] * cosine - i->voltage_dq[1] * sine;
    float beta = i->voltage_dq[0] * sine + i->voltage_dq[1] * cosine;
    float phase[3] = {alpha, -0.5f * alpha + 0.86602540378f * beta, -0.5f * alpha - 0.86602540378f * beta};
    float common = modulation_config.svpwm ? -0.5f * (fmaxf(phase[0], fmaxf(phase[1], phase[2])) + fminf(phase[0], fminf(phase[1], phase[2]))) : 0.0f;
    for (unsigned n = 0; n < 3; ++n) {
        float duty = 0.5f + (phase[n] + common) / i->bus_voltage;
        if (!isfinite(duty)) { o->valid = false; break; }
        o->duty[n] = clamp_f32(duty, modulation_config.duty_min, modulation_config.duty_max);
        if (o->duty[n] != duty) ++s->saturation_count;
    }
    if (!o->valid) for (unsigned n = 0; n < 3; ++n) o->duty[n] = 0.5f;
}

void modulation_step(const ModulationInput *i, ModulationOutput *o, ModulationState *s)
{
    modulation_transform(i, o, s);
    modulation_update(i, o, s);
}
