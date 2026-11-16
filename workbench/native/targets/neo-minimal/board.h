#ifndef BOARD_H
#define BOARD_H
#ifdef NEO_HOST_TEST
#include <stdint.h>
#define __WFI() ((void)0)
#else
#include "stm32h7xx_hal.h"
#endif
#include <stdbool.h>
#define PWM_PERIOD 10000u
#define PWM_OUTPUTS (HRTIM_OUTPUT_TA1|HRTIM_OUTPUT_TA2|HRTIM_OUTPUT_TB1|HRTIM_OUTPUT_TB2|HRTIM_OUTPUT_TC1|HRTIM_OUTPUT_TC2)
void board_init(void);
void board_start(void);
void board_output(const float duty[3], bool enabled);
void board_stop(void);
void firmware_tick(const uint16_t raw[4], uint32_t now_us);
void firmware_fault(uint32_t flags);
uint32_t board_now_us(void);
unsigned board_encoder_receive(uint8_t *data);
bool board_encoder_send(const uint8_t *data, unsigned length);
void board_watchdog_feed(void);
enum {FAULT_ADC=1u,FAULT_ENCODER=2u,FAULT_CURRENT=4u,FAULT_BUS=8u,FAULT_CALIBRATION=16u,
      FAULT_TIMING=32u,FAULT_OFFSET=64u,FAULT_NUMERIC=128u,FAULT_BOOT=256u};
#endif
