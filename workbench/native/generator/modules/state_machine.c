#include "state_machine.h"
void state_machine_step(const StateMachineInput *i, StateMachineOutput *o, StateMachineState *s)
{
    s->fault_latched = s->fault_latched || i->fault;
    if (i->reset_request && !i->fault && !i->enable_request) s->fault_latched = false;
    o->fault_latched = s->fault_latched;
    o->run_permitted = i->enable_request && i->ready && !s->fault_latched;
}
