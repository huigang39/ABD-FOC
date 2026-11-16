#include "friction.h"
#include "math_utils.h"
void friction_step(const FrictionInput *i, FrictionOutput *o, FrictionState *s)
{
    o->torque = 0; o->valid = false;
    if (i->enable && i->valid && isfinite(i->joint_velocity)) {
        float torque = friction_config.viscous * i->joint_velocity + friction_config.coulomb * tanhf(i->joint_velocity / friction_config.transition);
        o->valid = isfinite(torque);
        if (o->valid) o->torque = clamp_f32(torque, -friction_config.limit, friction_config.limit);
    }
    s->last_torque = o->torque;
}
