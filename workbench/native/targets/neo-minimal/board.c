/* NEO reference PCBA. HAL/CMSIS from STM32CubeH7; no legacy control runtime. */
#include "board.h"
#include <math.h>
static ADC_HandleTypeDef adc[3];
static HRTIM_HandleTypeDef pwm;
static UART_HandleTypeDef encoder;
static IWDG_HandleTypeDef watchdog;
static volatile unsigned rx_length;
static volatile uint8_t rx_data[64];
static volatile bool rx_error;
static bool outputs_enabled;
static uint32_t last_irq_us;

void board_stop(void)
{
    HRTIM1->sCommonRegs.ODISR = PWM_OUTPUTS;
    GPIOE->BSRR = GPIO_PIN_1; /* Reference configuration: high disables independent predriver. */
    __DSB(); outputs_enabled = false;
}
static void check(HAL_StatusTypeDef status)
{
    if (status == HAL_OK) return;
    board_stop(); firmware_fault(FAULT_BOOT);
    __disable_irq(); for (;;) __WFI();
}
static void gpio(GPIO_TypeDef *port,uint32_t pins,uint32_t mode,uint32_t af)
{
    GPIO_InitTypeDef init={.Pin=pins,.Mode=mode,.Pull=GPIO_NOPULL,.Speed=GPIO_SPEED_FREQ_HIGH,.Alternate=af};
    HAL_GPIO_Init(port,&init);
}
static void clocks(void)
{
    check(HAL_PWREx_ConfigSupply(PWR_DIRECT_SMPS_SUPPLY));
    __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE1);
    uint32_t start=HAL_GetTick();
    while (!__HAL_PWR_GET_FLAG(PWR_FLAG_VOSRDY)) if (HAL_GetTick()-start>100) check(HAL_TIMEOUT);
    RCC_OscInitTypeDef osc={0};
    osc.OscillatorType=RCC_OSCILLATORTYPE_HSE|RCC_OSCILLATORTYPE_LSI;
    osc.HSEState=RCC_HSE_ON; osc.LSIState=RCC_LSI_ON;
    osc.PLL.PLLState=RCC_PLL_ON; osc.PLL.PLLSource=RCC_PLLSOURCE_HSE;
    osc.PLL.PLLM=2; osc.PLL.PLLN=64; osc.PLL.PLLP=2; osc.PLL.PLLQ=4; osc.PLL.PLLR=2;
    osc.PLL.PLLRGE=RCC_PLL1VCIRANGE_3; osc.PLL.PLLVCOSEL=RCC_PLL1VCOWIDE;
    check(HAL_RCC_OscConfig(&osc));
    RCC_ClkInitTypeDef clock={0};
    clock.ClockType=RCC_CLOCKTYPE_SYSCLK|RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2|RCC_CLOCKTYPE_D1PCLK1|RCC_CLOCKTYPE_D3PCLK1;
    clock.SYSCLKSource=RCC_SYSCLKSOURCE_PLLCLK; clock.SYSCLKDivider=RCC_SYSCLK_DIV1; clock.AHBCLKDivider=RCC_HCLK_DIV2;
    clock.APB1CLKDivider=RCC_APB1_DIV2; clock.APB2CLKDivider=RCC_APB2_DIV2; clock.APB3CLKDivider=RCC_APB3_DIV2; clock.APB4CLKDivider=RCC_APB4_DIV2;
    check(HAL_RCC_ClockConfig(&clock,FLASH_LATENCY_2));
    RCC_PeriphCLKInitTypeDef peripheral={0};
    peripheral.PeriphClockSelection=RCC_PERIPHCLK_ADC|RCC_PERIPHCLK_USART2|RCC_PERIPHCLK_HRTIM1;
    peripheral.PLL2.PLL2M=2; peripheral.PLL2.PLL2N=16; peripheral.PLL2.PLL2P=2; peripheral.PLL2.PLL2Q=2; peripheral.PLL2.PLL2R=2;
    peripheral.PLL2.PLL2RGE=RCC_PLL2VCIRANGE_3; peripheral.PLL2.PLL2VCOSEL=RCC_PLL2VCOWIDE;
    peripheral.AdcClockSelection=RCC_ADCCLKSOURCE_PLL2;
    peripheral.Usart234578ClockSelection=RCC_USART234578CLKSOURCE_D2PCLK1;
    peripheral.Hrtim1ClockSelection=RCC_HRTIM1CLK_TIMCLK;
    check(HAL_RCCEx_PeriphCLKConfig(&peripheral));
    __HAL_RCC_TIM2_CLK_ENABLE();
    TIM2->PSC=199; TIM2->ARR=0xffffffffu; TIM2->EGR=TIM_EGR_UG; TIM2->CR1=TIM_CR1_CEN;
}
uint32_t board_now_us(void) { return TIM2->CNT; }
static void pwm_init(void)
{
    __HAL_RCC_HRTIM1_CLK_ENABLE();
    pwm.Instance=HRTIM1; check(HAL_HRTIM_Init(&pwm));
    HRTIM_TimeBaseCfgTypeDef base={.Period=PWM_PERIOD,.PrescalerRatio=HRTIM_PRESCALERRATIO_DIV1,.Mode=HRTIM_MODE_CONTINUOUS};
    HRTIM_TimerCfgTypeDef timer={0};
    timer.PreloadEnable=HRTIM_PRELOAD_ENABLED; timer.RepetitionUpdate=HRTIM_UPDATEONREPETITION_ENABLED;
    check(HAL_HRTIM_TimeBaseConfig(&pwm,HRTIM_TIMERINDEX_MASTER,&base));
    check(HAL_HRTIM_WaveformTimerConfig(&pwm,HRTIM_TIMERINDEX_MASTER,&timer));
    HRTIM_CompareCfgTypeDef compare={.CompareValue=PWM_PERIOD-1};
    check(HAL_HRTIM_WaveformCompareConfig(&pwm,HRTIM_TIMERINDEX_MASTER,HRTIM_COMPAREUNIT_1,&compare));
    HRTIM_ADCTriggerCfgTypeDef trigger={.UpdateSource=HRTIM_ADCTRIGGERUPDATE_MASTER,.Trigger=HRTIM_ADCTRIGGEREVENT24_MASTER_CMP1};
    check(HAL_HRTIM_ADCTriggerConfig(&pwm,HRTIM_ADCTRIGGER_2,&trigger));
    timer.DeadTimeInsertion=HRTIM_TIMDEADTIMEINSERTION_ENABLED;
    timer.ResetTrigger=HRTIM_TIMRESETTRIGGER_MASTER_PER;
    timer.UpdateTrigger=HRTIM_TIMUPDATETRIGGER_MASTER;
    HRTIM_DeadTimeCfgTypeDef dead={.Prescaler=HRTIM_TIMDEADTIME_PRESCALERRATIO_DIV1,.RisingValue=100,.FallingValue=100};
    const uint32_t high[]={HRTIM_OUTPUT_TA1,HRTIM_OUTPUT_TB1,HRTIM_OUTPUT_TC1};
    const uint32_t low[]={HRTIM_OUTPUT_TA2,HRTIM_OUTPUT_TB2,HRTIM_OUTPUT_TC2};
    for (unsigned n=0;n<3;n++) {
        check(HAL_HRTIM_TimeBaseConfig(&pwm,n,&base)); check(HAL_HRTIM_WaveformTimerConfig(&pwm,n,&timer));
        compare.CompareValue=PWM_PERIOD/4; check(HAL_HRTIM_WaveformCompareConfig(&pwm,n,HRTIM_COMPAREUNIT_1,&compare));
        compare.CompareValue=3*PWM_PERIOD/4; check(HAL_HRTIM_WaveformCompareConfig(&pwm,n,HRTIM_COMPAREUNIT_3,&compare));
        check(HAL_HRTIM_DeadTimeConfig(&pwm,n,&dead));
        HRTIM_OutputCfgTypeDef output={.Polarity=HRTIM_OUTPUTPOLARITY_HIGH,.SetSource=HRTIM_OUTPUTSET_TIMCMP1,.ResetSource=HRTIM_OUTPUTRESET_TIMCMP3};
        check(HAL_HRTIM_WaveformOutputConfig(&pwm,n,high[n],&output));
        output.SetSource=HRTIM_OUTPUTSET_NONE; output.ResetSource=HRTIM_OUTPUTRESET_NONE;
        check(HAL_HRTIM_WaveformOutputConfig(&pwm,n,low[n],&output));
    }
    board_stop();
    gpio(GPIOA,GPIO_PIN_8|GPIO_PIN_9|GPIO_PIN_10,GPIO_MODE_AF_PP,GPIO_AF2_HRTIM1);
    gpio(GPIOC,GPIO_PIN_6|GPIO_PIN_7|GPIO_PIN_8,GPIO_MODE_AF_PP,GPIO_AF1_HRTIM1);
}
static void adc_init(void)
{
    __HAL_RCC_ADC12_CLK_ENABLE(); __HAL_RCC_ADC3_CLK_ENABLE(); __HAL_RCC_SYSCFG_CLK_ENABLE();
    HAL_SYSCFG_AnalogSwitchConfig(SYSCFG_SWITCH_PA0,SYSCFG_SWITCH_PA0_OPEN);
    HAL_SYSCFG_AnalogSwitchConfig(SYSCFG_SWITCH_PA1,SYSCFG_SWITCH_PA1_OPEN);
    HAL_SYSCFG_AnalogSwitchConfig(SYSCFG_SWITCH_PC3,SYSCFG_SWITCH_PC3_OPEN);
    gpio(GPIOF,GPIO_PIN_4,GPIO_MODE_ANALOG,0);
    ADC_TypeDef *instances[]={ADC1,ADC2,ADC3}; const uint32_t channels[]={ADC_CHANNEL_0,ADC_CHANNEL_1,ADC_CHANNEL_1};
    for(unsigned n=0;n<3;n++) {
        adc[n].Instance=instances[n];
        adc[n].Init.ClockPrescaler=ADC_CLOCK_ASYNC_DIV4; adc[n].Init.Resolution=ADC_RESOLUTION_14B;
        adc[n].Init.ScanConvMode=ADC_SCAN_ENABLE; adc[n].Init.EOCSelection=ADC_EOC_SEQ_CONV; adc[n].Init.NbrOfConversion=1;
        adc[n].Init.ExternalTrigConv=ADC_SOFTWARE_START; adc[n].Init.ConversionDataManagement=ADC_CONVERSIONDATA_DR;
        check(HAL_ADC_Init(&adc[n]));
        if(n==0) { ADC_MultiModeTypeDef mode={.Mode=ADC_MODE_INDEPENDENT}; check(HAL_ADCEx_MultiModeConfigChannel(&adc[n],&mode)); }
        check(HAL_ADCEx_Calibration_Start(&adc[n],ADC_CALIB_OFFSET_LINEARITY,ADC_SINGLE_ENDED));
        HAL_ADCEx_DisableInjectedQueue(&adc[n]);
        ADC_InjectionConfTypeDef injected={0};
        injected.InjectedChannel=channels[n]; injected.InjectedRank=ADC_INJECTED_RANK_1;
        injected.InjectedSamplingTime=ADC_SAMPLETIME_1CYCLE_5; injected.InjectedSingleDiff=ADC_SINGLE_ENDED;
        injected.InjectedNbrOfConversion=n==2?2:1;
        injected.ExternalTrigInjecConv=ADC_EXTERNALTRIGINJEC_HR1_ADCTRG2;
        injected.ExternalTrigInjecConvEdge=ADC_EXTERNALTRIGINJECCONV_EDGE_RISING;
        check(HAL_ADCEx_InjectedConfigChannel(&adc[n],&injected));
        if(n==2) { injected.InjectedChannel=ADC_CHANNEL_9; injected.InjectedRank=ADC_INJECTED_RANK_2; check(HAL_ADCEx_InjectedConfigChannel(&adc[n],&injected)); }
    }
    HAL_NVIC_SetPriority(ADC3_IRQn,2,0); HAL_NVIC_EnableIRQ(ADC3_IRQn);
}
static void encoder_init(void)
{
    __HAL_RCC_USART2_CLK_ENABLE();
    gpio(GPIOD,GPIO_PIN_4|GPIO_PIN_5|GPIO_PIN_6,GPIO_MODE_AF_PP,GPIO_AF7_USART2);
    encoder.Instance=USART2; encoder.Init.BaudRate=6250000;
    encoder.Init.WordLength=UART_WORDLENGTH_8B; encoder.Init.StopBits=UART_STOPBITS_1; encoder.Init.Parity=UART_PARITY_NONE;
    encoder.Init.Mode=UART_MODE_TX_RX; encoder.Init.OverSampling=UART_OVERSAMPLING_16; encoder.Init.ClockPrescaler=UART_PRESCALER_DIV1;
    check(HAL_RS485Ex_Init(&encoder,UART_DE_POLARITY_HIGH,0,0));
    check(HAL_UARTEx_DisableFifoMode(&encoder));
    USART2->CR1 |= USART_CR1_RXNEIE_RXFNEIE;
    HAL_NVIC_SetPriority(USART2_IRQn,1,0); HAL_NVIC_EnableIRQ(USART2_IRQn);
}
void board_init(void)
{
    __HAL_RCC_GPIOE_CLK_ENABLE(); GPIOE->BSRR=GPIO_PIN_1;
    gpio(GPIOE,GPIO_PIN_1,GPIO_MODE_OUTPUT_PP,0);
    HAL_Init(); clocks();
    __HAL_RCC_GPIOA_CLK_ENABLE(); __HAL_RCC_GPIOC_CLK_ENABLE(); __HAL_RCC_GPIOD_CLK_ENABLE(); __HAL_RCC_GPIOF_CLK_ENABLE();
    SCB_EnableICache(); /* CPU-only peripheral buffers: no DMA/cache ownership. */
    pwm_init(); adc_init(); encoder_init();
    watchdog.Instance=IWDG1; watchdog.Init.Prescaler=IWDG_PRESCALER_4;
    watchdog.Init.Reload=799; watchdog.Init.Window=IWDG_WINDOW_DISABLE; check(HAL_IWDG_Init(&watchdog));
}
void board_start(void)
{
    check(HAL_ADCEx_InjectedStart(&adc[0])); check(HAL_ADCEx_InjectedStart(&adc[1])); check(HAL_ADCEx_InjectedStart_IT(&adc[2]));
    check(HAL_HRTIM_WaveformCounterStart(&pwm,HRTIM_TIMERID_MASTER|HRTIM_TIMERID_TIMER_A|HRTIM_TIMERID_TIMER_B|HRTIM_TIMERID_TIMER_C));
}
void board_watchdog_feed(void) { IWDG1->KR=0xAAAA; }
void board_output(const float duty[3], bool enabled)
{
    if(!enabled) { board_stop(); return; }
    for(unsigned n=0;n<3;n++) if(!isfinite(duty[n]) || duty[n]<0.05f || duty[n]>0.95f) { firmware_fault(FAULT_NUMERIC); board_stop(); return; }
    uint32_t irq=__get_PRIMASK(); __disable_irq();
    /* Commit all phase preloads on the next master update, never a partial vector. */
    HRTIM1->sCommonRegs.CR1 |= HRTIM_CR1_TAUDIS|HRTIM_CR1_TBUDIS|HRTIM_CR1_TCUDIS;
    for(unsigned n=0;n<3;n++) {
        uint32_t edge=(uint32_t)((1-duty[n])*0.5f*PWM_PERIOD);
        HRTIM1->sTimerxRegs[n].CMP1xR=edge;
        HRTIM1->sTimerxRegs[n].CMP3xR=PWM_PERIOD-edge;
    }
    HRTIM1->sCommonRegs.CR1 &= ~(HRTIM_CR1_TAUDIS|HRTIM_CR1_TBUDIS|HRTIM_CR1_TCUDIS);
    if(!outputs_enabled) {
        HRTIM1->sCommonRegs.CR2=HRTIM_CR2_TASWU|HRTIM_CR2_TBSWU|HRTIM_CR2_TCSWU;
        HRTIM1->sCommonRegs.OENR=PWM_OUTPUTS;
        GPIOE->BSRR=(uint32_t)GPIO_PIN_1<<16; outputs_enabled=true;
    }
    __set_PRIMASK(irq);
}
void USART2_IRQHandler(void)
{
    uint32_t status=USART2->ISR;
    if(status & (USART_ISR_ORE|USART_ISR_FE|USART_ISR_NE|USART_ISR_PE)) { USART2->ICR=USART_ICR_ORECF|USART_ICR_FECF|USART_ICR_NECF|USART_ICR_PECF; rx_error=true; }
    if(status & USART_ISR_RXNE_RXFNE) {
        uint8_t value=(uint8_t)USART2->RDR;
        if(rx_length<sizeof(rx_data)) rx_data[rx_length++]=value; else rx_error=true;
    }
}
unsigned board_encoder_receive(uint8_t *data)
{
    uint32_t irq=__get_PRIMASK(); __disable_irq(); unsigned count=rx_length;
    if(rx_error) { count=0; rx_error=false; }
    for(unsigned n=0;n<count;n++) data[n]=rx_data[n];
    rx_length=0; __set_PRIMASK(irq); return count;
}
bool board_encoder_send(const uint8_t *data, unsigned length)
{
    if(length!=1 || !(USART2->ISR & USART_ISR_TXE_TXFNF)) return false;
    USART2->TDR=data[0]; return true;
}
void ADC3_IRQHandler(void)
{
    uint32_t now=board_now_us();
    if(!(ADC3->ISR & ADC_ISR_JEOS)) { firmware_fault(FAULT_ADC); ADC3->ISR=ADC_ISR_JEOC|ADC_ISR_JEOS|ADC_ISR_JQOVF; return; }
    if(!(ADC1->ISR & ADC_ISR_JEOS) || !(ADC2->ISR & ADC_ISR_JEOS)) firmware_fault(FAULT_ADC);
    uint16_t raw[4]={(uint16_t)ADC1->JDR1,(uint16_t)ADC2->JDR1,(uint16_t)ADC3->JDR1,(uint16_t)ADC3->JDR2};
    ADC1->ISR=ADC_ISR_JEOS|ADC_ISR_JEOC; ADC2->ISR=ADC_ISR_JEOS|ADC_ISR_JEOC; ADC3->ISR=ADC_ISR_JEOS|ADC_ISR_JEOC;
    if(last_irq_us && now-last_irq_us>75) firmware_fault(FAULT_TIMING);
    last_irq_us=now; firmware_tick(raw,now);
    if(board_now_us()-now>40) firmware_fault(FAULT_TIMING);
    board_watchdog_feed();
}
void SysTick_Handler(void) { HAL_IncTick(); }
void HardFault_Handler(void) { board_stop(); __disable_irq(); for(;;) {} }
void MemManage_Handler(void) { HardFault_Handler(); }
void BusFault_Handler(void) { HardFault_Handler(); }
void UsageFault_Handler(void) { HardFault_Handler(); }
void NMI_Handler(void) { HardFault_Handler(); }
