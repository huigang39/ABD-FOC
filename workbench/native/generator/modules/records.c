#include "records.h"
#include <string.h>
static uint32_t record_crc(const uint8_t *data, unsigned length)
{
    uint32_t crc = 0xffffffffu;
    for (unsigned n = 0; n < length; ++n) {
        crc ^= data[n];
        for (unsigned bit = 0; bit < 8; ++bit) crc = (crc >> 1u) ^ ((crc & 1u) ? 0xedb88320u : 0u);
    }
    return ~crc;
}
void records_step(const RecordsInput *i, RecordsOutput *o, RecordsState *s)
{
    o->write_request = false; o->committed = false;
    if (s->busy && i->storage_done) {
        s->busy = false; o->error = i->storage_ok ? 0u : 2u;
        if (i->storage_ok) { s->committed_sequence = o->sequence; o->committed = true; }
        return;
    }
    if (!i->commit || s->busy) return;
    if (i->length > sizeof(o->payload)) { o->error = 1u; return; }
    memcpy(o->payload, i->payload, i->length);
    o->length = i->length; o->sequence = i->sequence; o->crc32 = record_crc(o->payload, o->length);
    o->error = 0; o->write_request = true; s->busy = true;
}
