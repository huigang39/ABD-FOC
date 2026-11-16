"""Generate package-specific pin choices from ST's STM32_open_pin_data XML.
Usage: python3 workbench/scripts/import-h745-pin-data.py /path/STM32H745IIKx.xml
Source: https://github.com/STMicroelectronics/STM32_open_pin_data
"""
import sys,json,xml.etree.ElementTree as ET
from pathlib import Path
root=ET.parse(sys.argv[1]).getroot();ns={'s':'http://dummy.com'}
kinds={'ADC':'adc','HRTIM':'pwm','SPI':'spi','USART':'uart','UART':'uart','LPUART':'uart','LPTIM':'lptim','I2C':'i2c','GPIO':'gpio','COMP':'comparator','FDCAN':'can','ETH':'ethernet','DAC':'dac','OPAMP':'opamp','RTC':'rtc','IWDG':'iwdg','WWDG':'wwdg','DMA':'dma','BDMA':'bdma','MDMA':'mdma','DMA2D':'dma2d','FMC':'fmc','QUADSPI':'qspi','SDMMC':'sdmmc','SAI':'sai','I2S':'i2s','SPDIFRX':'spdifrx','DFSDM':'dfsdm','DCMI':'dcmi','LTDC':'ltdc','JPEG':'jpeg','CRC':'crc','RNG':'rng','MDIOS':'mdios','SWPMI':'swpmi','HDMI_CEC':'cec','USB_OTG_FS':'usb','USB_OTG_HS':'usb','VREFBUF':'vrefbuf'}
labels={'pwm':'HRTIM','timer':'TIM','lptim':'LPTIM','uart':'USART / UART / LPUART','comparator':'COMP','can':'FDCAN','ethernet':'ETH','qspi':'QUADSPI','usb':'USB OTG'}
items=[]
for ip in root.findall('s:IP',ns):
 name,instance=ip.get('Name'),ip.get('InstanceName');kind='timer' if instance.startswith('TIM') else kinds.get(name)
 if not kind:continue
 pins={}
 for pin in root.findall('s:Pin',ns):
  if pin.get('Type')!='I/O':continue
  pname=pin.get('Name').split(' ')[0]
  for signal in pin.findall('s:Signal',ns):
   sig=signal.get('Name')
   if kind=='gpio' and sig=='GPIO':pins.setdefault('IO',[]).append(pname)
   elif sig.startswith(instance+'_'):
    key=sig[len(instance)+1:]
    if kind=='pwm' and key.startswith('CH'):key=key[2:]
    pins.setdefault(key,[]).append(pname)
 items.append({'kind':kind,'instance':'HRTIM1' if instance=='HRTIM' else instance,'pins':{key:sorted(set(value)) for key,value in pins.items()}})
unique=list(dict.fromkeys(x['kind'] for x in items))
out=Path('workbench/web/src/modules/hardware/hw-board/h745-pin-data.mjs')
out.write_text('// Generated from STMicroelectronics/STM32_open_pin_data mcu/STM32H745IIKx.xml (UFBGA176).\n// Source: https://github.com/STMicroelectronics/STM32_open_pin_data/blob/master/mcu/STM32H745IIKx.xml\nexport const H745_KINDS = '+json.dumps([[k,labels.get(k,k.upper())] for k in unique],ensure_ascii=False)+';\nexport const H745_RESOURCES = '+json.dumps(items,ensure_ascii=False,indent=2)+';\n')
print(len(items),'instances',len(unique),'categories')
