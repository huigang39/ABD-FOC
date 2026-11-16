#include "zeroing.h"
#include <math.h>
void zeroing_step(const ZeroingInput *i, ZeroingOutput *o, ZeroingState *s)
{
    o->complete = false;
    if (i->start && !s->start_previous && !s->active) { s->sum = 0; s->count = 0; s->active = true; o->error = 0; }
    s->start_previous = i->start;
    if (i->cancel) s->active = false;
    if (s->active && !i->stationary) { s->active = false; o->error = 1u; }
    if (s->active && i->sample_valid) {
        if (!isfinite(i->sample) || !isfinite(s->sum + i->sample)) { s->active = false; o->error = 2u; }
        else {
            s->sum += i->sample; ++s->count;
            if (s->count >= zeroing_config.sample_count) { o->offset = s->sum / (float)s->count; o->complete = true; s->active = false; }
        }
    }
    o->busy = s->active;
}
