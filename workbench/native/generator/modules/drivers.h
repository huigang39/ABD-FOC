#ifndef DRIVERS_H
#define DRIVERS_H
#include <stdbool.h>
#include <stdint.h>
#define DRIVER_CHANNELS 3u
#define DRIVER_FRAME_BYTES 64u
#define DRIVER_TX_BYTES 32u
#define DRIVER_ERROR_CONFIG 1u
#define DRIVER_ERROR_FRAME 2u
#define DRIVER_ERROR_VALUE 4u
#define DRIVER_ERROR_TIMEOUT 8u
#define DRIVER_ERROR_TRANSPORT 16u
#define DRIVER_ERROR_STATUS 32u
/* These three layouts are emitted directly from the module's data definitions. */
@CONTRACTS@
typedef enum { DRIVER_REQUEST_RESPONSE, DRIVER_ACTIVE_UPLOAD } DriverMode;
typedef enum { DRIVER_VALUE_UNSIGNED, DRIVER_VALUE_SIGNED, DRIVER_VALUE_FLOAT32 } DriverValueType;
typedef enum { DRIVER_CHECK_NONE, DRIVER_CHECK_XOR8, DRIVER_CHECK_SUM8, DRIVER_CHECK_MODBUS } DriverChecksum;
typedef struct {
    bool enabled;
    DriverMode mode;
    uint8_t request[DRIVER_TX_BYTES], request_length;
    uint8_t header[DRIVER_FRAME_BYTES], header_length;
    uint8_t footer[DRIVER_FRAME_BYTES], footer_length;
    uint8_t frame_length, data_offset, data_bits;
    DriverValueType value_type;
    bool big_endian;
    float scale, offset;
    DriverChecksum checksum;
    uint8_t checksum_start;
    int16_t status_offset;
    uint8_t status_mask, status_expected;
    uint32_t timeout_us, startup_delay_us;
} DriverConfig;
extern const DriverConfig driver_config[DRIVER_CHANNELS];
/* One caller owns each state. Feed ISR data through the peripheral's queue. */
void drivers_reset(DriversOutput *output, DriversState *state, uint32_t now_us);
int drivers_step(const DriverConfig config[DRIVER_CHANNELS], const DriversInput *input, DriversOutput *output, DriversState *state);
#endif
