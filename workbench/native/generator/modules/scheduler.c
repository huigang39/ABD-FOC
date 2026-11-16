#include "scheduler.h"
void scheduler_step(const SchedulerInput *i, SchedulerOutput *o, SchedulerState *s)
{
    o->release_mask = 0;
    if (!s->initialized) {
        for (unsigned n = 0; n < scheduler_config.task_count; ++n) s->next_release_us[n] = i->now_us;
        s->initialized = true;
    }
    for (unsigned n = 0; n < scheduler_config.task_count; ++n) {
        uint32_t period = scheduler_config.period_us[n];
        uint32_t late = i->now_us - s->next_release_us[n];
        if (!period || late >= 0x80000000u) continue;
        uint32_t missed = late / period;
        s->missed_deadlines[n] += missed;
        s->next_release_us[n] += (missed + 1u) * period;
        o->release_mask |= 1u << n;
    }
}
