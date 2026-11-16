"""Build the explicitly scoped NEO bring-up image from generated modules and CubeH7."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

def build(root, cube, prefix):
    root, cube = Path(root).resolve(), Path(cube).resolve()
    target = root / 'target'
    drivers = cube / 'Drivers'
    cmsis = drivers / 'CMSIS'
    device = cmsis / 'Device/ST/STM32H7xx'
    hal = drivers / 'STM32H7xx_HAL_Driver'
    gcc = prefix + 'gcc'
    if not shutil.which(gcc) and not Path(gcc).is_file() and not Path(gcc + '.exe').is_file():
        raise ValueError('GNU Arm GCC not found: ' + gcc)
    startup = device / 'Source/Templates/gcc/startup_stm32h745xx.s'
    if not startup.is_file():
        raise ValueError('STM32CubeH7 package required: ' + str(cube))
    output = root / 'build'
    output.mkdir(exist_ok=True)
    spec = json.loads((root / 'build-manifest.json').read_text(encoding='utf-8'))
    modules = [root / item['source'] for item in spec['modules']]
    includes = [target, root/'include', cmsis/'Include', device/'Include', hal/'Inc']
    includes += sorted(set(source.parent for source in modules))
    hal_names = ['hal','hal_cortex','hal_dma','hal_dma_ex','hal_gpio','hal_rcc','hal_rcc_ex','hal_pwr','hal_pwr_ex',
                 'hal_flash','hal_flash_ex','hal_adc','hal_adc_ex','hal_hrtim','hal_uart','hal_uart_ex','hal_iwdg']
    sources = modules + [target/'main.c',target/'board.c', device/'Source/Templates/system_stm32h7xx.c']
    sources += [hal/'Src'/('stm32h7xx_'+name+'.c') for name in hal_names]
    commands = []
    def run(args):
        args = [str(arg) for arg in args]
        commands.append(args)
        subprocess.run(args, check=True, cwd=root)
    artifacts = []
    for core, address, ram, length, selected in [
        ('cm7',0x08000000,0x24000000,512*1024,sources),
        ('cm4',0x08100000,0x30040000,32*1024,[target/'park.c'])]:
        flags = ['-mcpu=cortex-m7' if core=='cm7' else '-mcpu=cortex-m4', '-mthumb',
                 '-mfpu=fpv5-d16' if core=='cm7' else '-mfpu=fpv4-sp-d16','-mfloat-abi=hard',
                 '-DSTM32H745xx','-DCORE_'+core.upper(),'-DUSE_HAL_DRIVER','-DHSE_VALUE=25000000U',
                 '-DUSER_VECT_TAB_ADDRESS','-DUSE_PWR_DIRECT_SMPS_SUPPLY','-O2','-g3','-ffunction-sections','-fdata-sections','-fno-fast-math']
        objects = []
        for index, source in enumerate(selected+[startup]):
            obj = output / (core+'_'+str(index)+'.o')
            warnings = ['-Wall','-Wextra','-Werror'] if source in modules or source.parent==target else []
            run([gcc,*flags,*warnings,*[part for inc in includes for part in ['-I',inc]],'-c',source,'-o',obj])
            objects.append(obj)
        elf = output / (core+'.elf')
        run([gcc,*flags,*objects,'-T',target/'link.ld',
             '-Wl,--defsym=FLASH_BASE='+hex(address),'-Wl,--defsym=FLASH_LENGTH='+str(512*1024),
             '-Wl,--defsym=RAM_BASE='+hex(ram),'-Wl,--defsym=RAM_LENGTH='+str(length),
             '-Wl,--gc-sections','-Wl,-Map='+str(output/(core+'.map')),
             '--specs=nano.specs','--specs=nosys.specs','-Wl,--start-group','-lc','-lm','-Wl,--end-group','-o',elf])
        binary = output / (core+'.bin')
        run([prefix+'objcopy','-O','binary',elf,binary])
        run([prefix+'size',elf])
        data = binary.read_bytes()
        sp = int.from_bytes(data[:4],'little'); reset = int.from_bytes(data[4:8],'little')
        if not (ram < sp <= ram+length and reset & 1 and address <= (reset & ~1) < address+len(data)):
            raise ValueError('Invalid vector table for '+core)
        artifacts.append({'core':core,'address':address,'bin':str(binary),'elf':str(elf),'bytes':len(data),'stackPointer':sp,'resetVector':reset})
    (root/'compile_commands.json').write_text(json.dumps(commands,indent=2),encoding='utf-8')
    (root/'target-result.json').write_text(json.dumps({'images':artifacts,'compiler':subprocess.check_output([gcc,'--version'],text=True).splitlines()[0]},indent=2),encoding='utf-8')
    return artifacts

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',required=True); parser.add_argument('--cube',required=True)
    parser.add_argument('--prefix',default=os.environ.get('ACTUATOR_GCC_PREFIX','arm-none-eabi-'))
    args=parser.parse_args(); build(args.root,args.cube,args.prefix)
