#include "motion.h"
#include "math_utils.h"
void motion_step(const MotionInput *i, MotionOutput *o, MotionState *s)
{
    o->valid = i->enabled && i->command_valid && isfinite(i->requested_iq) && isfinite(i->dynamic_limit) && i->dynamic_limit >= 0;
    o->reference_dq[0] = 0;
    o->reference_dq[1] = o->valid ? clamp_f32(i->requested_iq, -fminf(i->dynamic_limit, motion_config.current_limit), fminf(i->dynamic_limit, motion_config.current_limit)) : 0;
    s->last_iq = o->reference_dq[1];
}
