#include "stm32h745xx.h"
/* CM4 image replaces any old application at its default boot address. */
void ExitRun0Mode(void) { RCC->AHB2ENR |= RCC_AHB2ENR_SRAM3EN; (void)RCC->AHB2ENR; }
void SystemInit(void) { SCB->VTOR=0x08100000u; }
int main(void) { __disable_irq(); for(;;) __WFI(); }
