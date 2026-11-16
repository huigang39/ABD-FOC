#include "feedback.h"
#include "math_utils.h"
void feedback_step(const FeedbackInput *i, FeedbackOutput *o, FeedbackState *s)
{
    o->valid = false;
    if (!i->motor_valid || !isfinite(i->motor_angle) || !isfinite(i->electrical_offset) ||
        (feedback_config.use_output_encoder && (!i->output_valid || !isfinite(i->output_angle)))) return;
    if (!s->initialized) { s->last_angle = i->motor_angle; s->unwrapped_angle = i->motor_angle; s->last_time_us = i->sample_time_us; s->initialized = true; o->motor_velocity = 0; }
    else {
        uint32_t delta_us = i->sample_time_us - s->last_time_us;
        if (!delta_us || delta_us >= 0x80000000u) return;
        float delta = wrap_angle_signed(i->motor_angle - s->last_angle);
        s->unwrapped_angle += delta;
        o->motor_velocity = delta * 1000000.0f / (float)delta_us;
        s->last_angle = i->motor_angle; s->last_time_us = i->sample_time_us;
    }
    o->electrical_angle = wrap_angle(i->motor_angle * feedback_config.pole_pairs - i->electrical_offset);
    o->joint_position = feedback_config.use_output_encoder ? i->output_angle : s->unwrapped_angle / feedback_config.ratio;
    o->valid = isfinite(o->electrical_angle) && isfinite(o->joint_position) && isfinite(o->motor_velocity);
}
