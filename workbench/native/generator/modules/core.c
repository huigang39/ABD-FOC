#include "core.h"
void core_step(const CoreInput *i, CoreOutput *o, CoreState *s)
{
    o->elapsed_us = s->initialized ? i->now_us - s->last_us : 0u;
    s->last_us = i->now_us; s->initialized = true;
    o->reset_reason = i->reset_reason;
    o->fault = i->clock_fault ? 1u : 0u;
    o->ready = i->boot_ready && !i->clock_fault;
}
