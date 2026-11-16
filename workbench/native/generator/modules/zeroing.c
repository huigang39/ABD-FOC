#include "zeroing.h"
#include "math_utils.h"
#include <string.h>
static void fail(ZeroingOutput *o, ZeroingState *s, uint32_t error)
{
    s->phase = 0; o->phase = 0; o->busy = false; o->reference_id = 0; o->error = error;
}
void zeroing_step(const ZeroingInput *i, ZeroingOutput *o, ZeroingState *s)
{
    bool start = i->start && !s->start_previous;
    s->start_previous = i->start;
    o->reference_id = 0; o->busy = s->phase != 0;
    if (i->cancel || !i->permitted) { if (s->phase || start) fail(o,s,1); return; }
    if (start && !s->phase) {
        memset(s,0,sizeof(*s)); s->start_previous = true; s->phase = 1;
        /* Keep the last validated tuple until a new sweep succeeds. Busy excludes normal control. */
        s->last_raw = i->motor_angle; o->error = 0;
    }
    if (!s->phase) return;
    if (!i->sample_valid || !isfinite(i->motor_angle) || !isfinite(i->dt) || i->dt <= 0 || i->dt > 0.01f) { fail(o,s,2); return; }
    s->elapsed += i->dt; s->total += i->dt;
    if (s->total > 15) { fail(o,s,5); return; }
    float delta = wrap_angle_signed(i->motor_angle - s->last_raw);
    s->last_raw = i->motor_angle;
    s->travel += delta;
    if (fabsf(delta) > 0.1f) { fail(o,s,3); return; }
    o->reference_id = zeroing_config.current * fminf(s->total / 0.5f,1);
    switch (s->phase) {
    case 1:
        if (s->elapsed >= 2) { s->phase = 2; s->elapsed = 0; s->travel = 0; }
        break;
    case 2:
        s->angle = fminf(2*MATH_TWO_PI, s->angle + MATH_TWO_PI*i->dt);
        if (s->elapsed >= 2.2f) {
            float gain = fabsf(s->travel) * zeroing_config.pole_pairs / (2*MATH_TWO_PI);
            if (gain < 0.8f || gain > 1.2f) { fail(o,s,3); return; }
            s->candidate_direction = s->travel > 0 ? 1 : -1;
            s->forward_travel = s->travel; s->phase = 3; s->elapsed = 0;
        }
        break;
    case 3:
        s->angle = fmaxf(0, s->angle - MATH_TWO_PI*i->dt);
        if (s->elapsed >= 2.2f) {
            float reverse = s->travel - s->forward_travel;
            float gain = -reverse * (float)s->candidate_direction * zeroing_config.pole_pairs / (2*MATH_TWO_PI);
            if (gain < 0.8f || gain > 1.2f || fabsf(s->travel)*zeroing_config.pole_pairs > 0.3f) { fail(o,s,3); return; }
            s->phase = 4; s->elapsed = 0;
        }
        break;
    case 4:
        if (s->elapsed >= 2) { s->phase = 5; s->elapsed = 0; }
        break;
    case 5: {
        float angle = (float)s->candidate_direction * i->motor_angle * zeroing_config.pole_pairs;
        s->sum_sin += sinf(angle); s->sum_cos += cosf(angle); ++s->count;
        if (s->elapsed >= 0.5f) {
            if (s->count < 32 || hypotf(s->sum_sin,s->sum_cos)/(float)s->count < 0.995f) { fail(o,s,4); return; }
            o->offset = wrap_angle(atan2f(s->sum_sin,s->sum_cos));
            o->direction = s->candidate_direction; o->complete = true;
            s->phase = 0; o->reference_id = 0;
        }
        break;
    }
    default: fail(o,s,5); return;
    }
    o->forced_angle = wrap_angle(s->angle); o->phase = s->phase; o->busy = s->phase != 0;
}
