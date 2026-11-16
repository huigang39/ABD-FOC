#include "observer.h"
#include "math_utils.h"
void observer_step(const ObserverInput *i, ObserverOutput *o, ObserverState *s)
{
    o->valid = false;
    if (!i->enable || !i->valid || !isfinite(i->measured_angle) || !isfinite(i->dt) || i->dt <= 0 || i->dt * observer_config.bandwidth > 0.1f) { s->initialized = false; return; }
    if (!s->initialized) { s->angle = wrap_angle(i->measured_angle); s->velocity = 0; s->initialized = true; }
    float error = wrap_angle_signed(i->measured_angle - s->angle);
    float omega = MATH_TWO_PI * observer_config.bandwidth;
    s->velocity += omega * omega * error * i->dt;
    s->angle = wrap_angle(s->angle + (s->velocity + 2.0f * omega * error) * i->dt);
    o->angle = s->angle; o->velocity = s->velocity;
    o->valid = isfinite(s->angle) && isfinite(s->velocity);
    if (!o->valid) s->initialized = false;
}
