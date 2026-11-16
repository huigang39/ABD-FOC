#include "motion.h"
#include "math_utils.h"
#include <string.h>
void motion_step(const MotionInput *i, MotionOutput *o, MotionState *s)
{
    o->reference_dq[0] = o->reference_dq[1] = 0;
    o->valid = i->enabled && i->command_valid && isfinite(i->dynamic_limit) && i->dynamic_limit >= 0;
    float limit = fminf(i->dynamic_limit, motion_config.current_limit);
    if (i->speed_mode) {
        o->valid = o->valid && motion_config.speed_supported && i->feedback_valid &&
            isfinite(i->requested_velocity) && isfinite(i->motor_velocity) &&
            isfinite(i->dt) && i->dt > 0 && i->dt <= 0.01f;
        if (o->valid) {
            float measured = i->motor_velocity / motion_config.ratio;
            if (!s->speed_active) { s->filtered_velocity = measured; s->velocity_reference = measured; s->integral = 0; }
            float a = MATH_TWO_PI * motion_config.speed_filter_hz * i->dt;
            s->filtered_velocity += (measured - s->filtered_velocity) * a / (1 + a);
            float target = clamp_f32(i->requested_velocity, -motion_config.speed_limit, motion_config.speed_limit);
            float step = motion_config.acceleration * i->dt;
            s->velocity_reference += clamp_f32(target - s->velocity_reference, -step, step);
            float error = s->velocity_reference - s->filtered_velocity;
            float integral = clamp_f32(s->integral + motion_config.speed_ki * error * i->dt, -limit, limit);
            float request = motion_config.speed_kp * error + integral;
            o->valid = isfinite(request);
            if (o->valid) {
                o->reference_dq[1] = clamp_f32(request, -limit, limit);
                if (request == o->reference_dq[1] || (request > limit && error < 0) || (request < -limit && error > 0)) s->integral = integral;
                s->speed_active = true;
            }
        }
    } else {
        s->speed_active = false; s->integral = 0;
        o->valid = o->valid && isfinite(i->requested_iq);
        if (o->valid) o->reference_dq[1] = clamp_f32(i->requested_iq, -limit, limit);
    }
    if (!o->valid) { memset(s, 0, sizeof(*s)); o->reference_dq[1] = 0; }
    s->last_iq = o->reference_dq[1];
}
