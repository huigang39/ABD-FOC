import test from 'node:test';
import assert from 'node:assert/strict';
import {getMcuResources,RESOURCE_KINDS,createResource,isPwmResource} from '../web/src/modules/hardware/hw-board/resources.mjs';
import {resourceSettingOptions} from '../web/src/modules/hardware/hw-platform/options.mjs';
test('H745 UFBGA176 exposes package routes beyond the NEO board subset',()=>{
 const routes=getMcuResources('STM32H745IIK6');
 for(const instance of ['TIM1','TIM8','TIM17','SPI1','SPI6','I2C4','UART8','FDCAN2','ETH','COMP2','DAC1','DMA','LPTIM5'])assert(routes.some(route=>route.instance===instance),instance);
 assert(!RESOURCE_KINDS.some(([,label])=>label==='PWM'));
 assert(routes.find(route=>route.instance==='TIM1').pins.CH1.includes('PA8'));
 assert.equal(getMcuResources('UNKNOWN').length,0);
});
test('TIM mode determines PWM usage, basic timers cannot select PWM',()=>{
 const timer=createResource('timer');timer.instance='TIM6';
 assert.deepEqual(resourceSettingOptions('STM32H745IIK6',timer,'mode').map(item=>item.value),['base']);
 timer.instance='TIM1';timer.settings.mode='pwm';assert(isPwmResource(timer));timer.settings.mode='capture';assert(!isPwmResource(timer));
});
