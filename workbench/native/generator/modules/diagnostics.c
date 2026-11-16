#include "diagnostics.h"
void diagnostics_step(const DiagnosticsInput *i, DiagnosticsOutput *o, DiagnosticsState *s)
{
    uint32_t faults = i->hardware_faults | i->algorithm_faults | (i->enabled && !i->command_valid ? 0x80000000u : 0u);
    o->new_event = (faults & ~s->latched_faults) != 0;
    s->latched_faults |= faults;
    if (i->reset_request && i->output_disabled && !i->enabled && !faults) s->latched_faults = 0;
    o->fault_flags = s->latched_faults; o->stop_request = s->latched_faults != 0;
}
