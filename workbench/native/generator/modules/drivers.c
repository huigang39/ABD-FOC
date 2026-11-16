#include "drivers.h"
#include <math.h>
#include <stddef.h>
#include <string.h>

static unsigned checksum_size(DriverChecksum kind)
{
    return kind == DRIVER_CHECK_MODBUS ? 2u : kind == DRIVER_CHECK_NONE ? 0u : 1u;
}
static bool command_valid(const DriverCommand *c)
{
    unsigned check = checksum_size(c->checksum);
    if (c->purpose > DRIVER_PURPOSE_OTHER || c->mode > DRIVER_ACTIVE_UPLOAD || c->value_type > DRIVER_VALUE_FLOAT32 || c->checksum > DRIVER_CHECK_MODBUS ||
        !c->frame_length || c->frame_length > DRIVER_FRAME_BYTES || c->request_length > DRIVER_TX_BYTES ||
        c->header_length > c->frame_length || c->footer_length + check > c->frame_length ||
        (c->mode == DRIVER_REQUEST_RESPONSE && !c->request_length) ||
        (c->data_bits != 8 && c->data_bits != 16 && c->data_bits != 24 && c->data_bits != 32) ||
        (c->value_type == DRIVER_VALUE_FLOAT32 && c->data_bits != 32) || !isfinite(c->scale) || !isfinite(c->offset) ||
        c->period_us >= 0x80000000u || c->startup_delay_us >= 0x80000000u) return false;
    unsigned end = c->frame_length - c->footer_length - check;
    return c->data_offset >= c->header_length && c->data_offset + c->data_bits / 8u <= end &&
        (!check || c->checksum_start < end) &&
        (c->status_offset == -1 || (c->status_offset >= c->header_length && c->status_offset < (int)end)) &&
        (!c->status_mask || c->status_offset >= 0) && (c->status_expected & c->status_mask) == c->status_expected;
}
static bool config_valid(const DriverConfig *c)
{
    unsigned data = 0;
    if (c->command_count > DRIVER_COMMANDS_MAX || !c->timeout_us || c->timeout_us >= 0x80000000u) return false;
    for (unsigned n = 0; n < c->command_count; ++n) {
        if (!command_valid(&c->commands[n])) return false;
        if (c->commands[n].purpose == DRIVER_PURPOSE_DATA && ++data > 1u) return false;
    }
    return true;
}
static uint16_t checksum(const uint8_t *data, unsigned length, DriverChecksum kind)
{
    uint16_t value = kind == DRIVER_CHECK_MODBUS ? 0xffffu : 0u;
    for (unsigned n = 0; n < length; ++n) {
        if (kind == DRIVER_CHECK_SUM8) value = (uint8_t)(value + data[n]);
        else if (kind == DRIVER_CHECK_XOR8) value ^= data[n];
        else if (kind == DRIVER_CHECK_MODBUS) {
            value ^= data[n];
            for (unsigned bit = 0; bit < 8; ++bit) value = (value >> 1u) ^ ((value & 1u) ? 0xa001u : 0u);
        }
    }
    return value;
}
static uint32_t decode(const DriverCommand *c, const uint8_t *frame, float *value, uint32_t *raw, uint32_t *status)
{
    unsigned bytes = c->data_bits / 8u;
    *raw = 0;
    for (unsigned n = 0; n < bytes; ++n) {
        unsigned shift = 8u * (c->big_endian ? bytes - n - 1u : n);
        *raw |= (uint32_t)frame[c->data_offset + n] << shift;
    }
    if (c->value_type == DRIVER_VALUE_FLOAT32) memcpy(value, raw, sizeof(*value));
    else if (c->value_type == DRIVER_VALUE_SIGNED) {
        int64_t number = *raw;
        if (*raw & (1u << (c->data_bits - 1u))) number -= (int64_t)1 << c->data_bits;
        *value = (float)number;
    } else *value = (float)*raw;
    *status = c->status_offset >= 0 ? frame[c->status_offset] : 0u;
    *value = *value * c->scale + c->offset;
    if (!isfinite(*value)) return DRIVER_ERROR_VALUE;
    return (*status & c->status_mask) != c->status_expected ? DRIVER_ERROR_STATUS : 0u;
}
static bool frame_valid(const DriverCommand *c, const uint8_t *frame)
{
    if (memcmp(frame, c->header, c->header_length) ||
        memcmp(frame + c->frame_length - c->footer_length, c->footer, c->footer_length)) return false;
    unsigned size = checksum_size(c->checksum);
    if (!size) return true;
    unsigned at = c->frame_length - c->footer_length - size;
    uint16_t wire = frame[at];
    if (size == 2) wire |= (uint16_t)frame[at + 1u] << 8u;
    return checksum(frame + c->checksum_start, at - c->checksum_start, c->checksum) == wire;
}
static void reset_channel(unsigned ch, uint32_t now, DriversOutput *o, DriversState *s)
{
    s->rx_size[ch] = 0; s->last_tx_us[ch] = 0; s->start_us[ch] = now;
    s->tx_pending[ch] = false; s->waiting_response[ch] = false; s->received[ch] = false;
    s->rejected_frames[ch] = 0; s->dropped_bytes[ch] = 0;
    s->active_command[ch] = -1; s->last_status_us[ch] = 0;
    for (unsigned n = 0; n < DRIVER_COMMANDS_MAX; ++n) s->command_started[ch * DRIVER_COMMANDS_MAX + n] = false;
    o->value[ch] = 0; o->raw[ch] = 0; o->sample_time_us[ch] = 0;
    o->sequence[ch] = 0; o->valid[ch] = false; o->error[ch] = 0; o->device_status[ch] = 0;
}
void drivers_reset(DriversOutput *o, DriversState *s, uint32_t now)
{
    if (!o || !s) return;
    memset(o, 0, sizeof(*o)); memset(s, 0, sizeof(*s));
    for (unsigned ch = 0; ch < DRIVER_CHANNELS; ++ch) reset_channel(ch, now, o, s);
}
/* 主数据命令下标；无则 -1。 */
static int data_index(const DriverConfig *c)
{
    for (unsigned n = 0; n < c->command_count; ++n) if (c->commands[n].purpose == DRIVER_PURPOSE_DATA) return (int)n;
    return -1;
}
int drivers_step(const DriverConfig cfg[DRIVER_CHANNELS], const DriversInput *i, DriversOutput *o, DriversState *s)
{
    if (!cfg || !i || !o || !s) return -1;
    o->tx_request = false; o->tx_length = 0;
    if (i->channel >= DRIVER_CHANNELS) return -1;
    unsigned ch = i->channel;
    const DriverConfig *c = &cfg[ch];
    if (i->reset) reset_channel(ch, i->now_us, o, s);
    if (!c->enabled) { o->valid[ch] = false; return 0; }
    if (!config_valid(c) || i->rx_length > DRIVER_FRAME_BYTES || s->rx_size[ch] > DRIVER_FRAME_BYTES) {
        o->valid[ch] = false; o->error[ch] = DRIVER_ERROR_CONFIG; return -1;
    }
    int active = s->active_command[ch];
    if (active >= (int)c->command_count) active = -1; /* 防御越界或零初始化的在途标记 */
    int data = data_index(c);
    bool *started = s->command_started + ch * DRIVER_COMMANDS_MAX;
    if (i->tx_complete && s->tx_pending[ch]) {
        s->tx_pending[ch] = false;
        if (i->transport_status == 0) {
            s->last_tx_us[ch] = i->now_us;
            if (active >= 0) {
                started[active] = true; /* 成功提交即算启动：供超时判定与一次性命令 */
                if (c->commands[active].mode == DRIVER_REQUEST_RESPONSE) s->waiting_response[ch] = true; /* 应答期间沿用该命令解析 */
                else { s->active_command[ch] = -1; active = -1; } /* 主动上传提交后回到空闲流式接收 */
            }
        } else {
            s->active_command[ch] = -1; active = -1;
            o->valid[ch] = false; o->error[ch] = DRIVER_ERROR_TRANSPORT;
        }
    }
    /* 接收字节按在途命令匹配；空闲时仅主动上传的主数据持续流式解析，否则计入丢弃。 */
    const DriverCommand *rx = active >= 0 ? &c->commands[active] :
        (data >= 0 && c->commands[data].mode == DRIVER_ACTIVE_UPLOAD ? &c->commands[data] : 0);
    uint8_t *buffer = s->rx_buffer + ch * DRIVER_FRAME_BYTES;
    for (unsigned n = 0; n < i->rx_length; ++n) {
        if (!rx) { ++s->dropped_bytes[ch]; continue; }
        if (s->rx_size[ch] == DRIVER_FRAME_BYTES) { s->rx_size[ch] = 0; o->valid[ch] = false; o->error[ch] = DRIVER_ERROR_FRAME; }
        buffer[s->rx_size[ch]++] = i->rx_data[n];
        while (s->rx_size[ch]) {
            unsigned prefix = s->rx_size[ch] < rx->header_length ? s->rx_size[ch] : rx->header_length;
            unsigned discard = 0;
            if (memcmp(buffer, rx->header, prefix)) { discard = 1; ++s->dropped_bytes[ch]; }
            else if (s->rx_size[ch] < rx->frame_length) break;
            else if (!frame_valid(rx, buffer)) {
                discard = 1; ++s->rejected_frames[ch]; ++s->dropped_bytes[ch];
                if (rx->purpose == DRIVER_PURPOSE_DATA) { o->valid[ch] = false; o->error[ch] = DRIVER_ERROR_FRAME; }
                else o->error[ch] |= DRIVER_ERROR_FRAME;
            } else {
                discard = rx->frame_length;
                if (rx->purpose == DRIVER_PURPOSE_DATA) {
                    float value; uint32_t raw, status;
                    uint32_t error = decode(rx, buffer, &value, &raw, &status);
                    o->device_status[ch] = status; o->error[ch] = error;
                    if (error) { ++s->rejected_frames[ch]; o->valid[ch] = false; }
                    else {
                        o->value[ch] = value; o->raw[ch] = raw; o->sample_time_us[ch] = i->now_us;
                        ++o->sequence[ch]; o->valid[ch] = true; s->received[ch] = true;
                        s->waiting_response[ch] = false;
                        if (active >= 0) { s->active_command[ch] = -1; active = -1; }
                    }
                } else if (rx->purpose == DRIVER_PURPOSE_STATUS) {
                    uint32_t status = rx->status_offset >= 0 ? buffer[rx->status_offset] : 0u;
                    o->device_status[ch] = status;
                    if ((status & rx->status_mask) != rx->status_expected) { o->error[ch] |= DRIVER_ERROR_STATUS; ++s->rejected_frames[ch]; }
                    else o->error[ch] &= ~(uint32_t)DRIVER_ERROR_STATUS;
                    s->waiting_response[ch] = false; s->last_status_us[ch] = i->now_us;
                    if (active >= 0) { s->active_command[ch] = -1; active = -1; }
                } else { /* 其他指令只完成传输记账 */
                    s->waiting_response[ch] = false;
                    if (active >= 0) { s->active_command[ch] = -1; active = -1; }
                }
            }
            s->rx_size[ch] -= discard;
            memmove(buffer, buffer + discard, s->rx_size[ch]);
        }
    }
    if (s->received[ch] && (uint32_t)(i->now_us - o->sample_time_us[ch]) >= c->timeout_us) {
        o->valid[ch] = false; o->error[ch] |= DRIVER_ERROR_TIMEOUT;
    }
    if (data >= 0 && started[data] && !s->received[ch] &&
        (uint32_t)(i->now_us - s->last_tx_us[ch]) >= c->timeout_us) o->error[ch] |= DRIVER_ERROR_TIMEOUT;
    if (s->waiting_response[ch] && (uint32_t)(i->now_us - s->last_tx_us[ch]) >= c->timeout_us) {
        s->waiting_response[ch] = false; s->active_command[ch] = -1;
    }
    /* 每次调用至多提交一条发送：主数据优先，其次首个到期的状态命令，最后补发未发送的其他指令。 */
    if (!s->tx_pending[ch] && !s->waiting_response[ch]) {
        unsigned next = c->command_count;
        if (data >= 0) {
            const DriverCommand *d = &c->commands[data];
            /* 请求应答按调度器请求重发；主动上传只在未启动时发送一次。 */
            if (i->request && (d->mode == DRIVER_REQUEST_RESPONSE || !started[data]) &&
                (uint32_t)(i->now_us - s->start_us[ch]) >= d->startup_delay_us) next = (unsigned)data;
        }
        if (next == c->command_count)
            for (unsigned n = 0; n < c->command_count; ++n) {
                if (c->commands[n].purpose != DRIVER_PURPOSE_STATUS || !c->commands[n].period_us) continue;
                if ((uint32_t)(i->now_us - s->last_status_us[ch]) >= c->commands[n].period_us) { next = n; break; }
            }
        if (next == c->command_count)
            for (unsigned n = 0; n < c->command_count; ++n) {
                if (c->commands[n].purpose != DRIVER_PURPOSE_OTHER || started[n]) continue;
                if ((uint32_t)(i->now_us - s->start_us[ch]) >= c->commands[n].startup_delay_us) { next = n; break; }
            }
        if (next < c->command_count) {
            const DriverCommand *cmd = &c->commands[next];
            if (!cmd->request_length) started[next] = true; /* 空发送指令的命令只标记启动，不占用总线 */
            else {
                memcpy(o->tx_data, cmd->request, cmd->request_length);
                o->tx_length = cmd->request_length; o->tx_channel = (uint8_t)ch;
                o->tx_request = true; s->tx_pending[ch] = true; s->active_command[ch] = (int8_t)next;
            }
        }
    }
    return 0;
}
