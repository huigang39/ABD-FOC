#include "protection.h"
void protection_step(const ProtectionInput *i, ProtectionOutput *o, ProtectionState *s)
{
    if (i->trip_flags & ~s->latched_flags) ++s->trip_count;
    s->latched_flags |= i->trip_flags;
    if (i->reset_request && i->output_disabled && !i->trip_flags) s->latched_flags = 0;
    o->fault_flags = s->latched_flags; o->trip_latched = s->latched_flags != 0;
    o->gate_permitted = !o->trip_latched;
}
