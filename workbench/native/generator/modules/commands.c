#include "commands.h"
#include <math.h>
void commands_step(const CommandsInput *i, CommandsOutput *o, CommandsState *s)
{
    if (i->received) {
        uint32_t ahead = i->sequence - s->last_sequence;
        if (i->frame_valid && isfinite(i->iq) && (!s->received || (ahead && ahead < 0x80000000u)) &&
            (uint32_t)(i->now_us - i->receive_time_us) < commands_config.timeout_us) {
            s->last_sequence = i->sequence; s->last_receive_us = i->receive_time_us; s->received = true;
            o->iq = i->iq; o->sequence = i->sequence;
        } else ++s->rejected_count;
    }
    o->valid = s->received && (uint32_t)(i->now_us - s->last_receive_us) < commands_config.timeout_us;
}
