#!/usr/bin/env python3
"""Compile module libraries, never publish them as runnable firmware."""
import argparse,json,subprocess
from pathlib import Path

def run(args):
    subprocess.run([str(x) for x in args],check=True)

def compile_libraries(root,prefix):
    spec=json.loads((root/'build-manifest.json').read_text())
    if spec['compiler'] != 'gcc': raise ValueError('Only the GNU Arm GCC compiler adapter is implemented')
    if not str(spec['mcu']).startswith('STM32H745'): raise ValueError('This compiler adapter currently targets STM32H745 CM7/CM4')
    version=subprocess.check_output([prefix+'gcc','-dumpfullversion','-dumpversion'],text=True).strip()
    if spec.get('version') and version != spec['version'].strip(): raise ValueError('Selected GCC version does not match installed compiler: '+version)
    if not isinstance(spec.get('lto'),bool): raise ValueError('LTO must be explicitly enabled or disabled')
    includes=[root/'include']+sorted({(root/unit['source']).parent for unit in spec['modules']})
    outputs={}
    commands=[]
    for unit in spec['modules']:
        core=unit['core']
        if core not in ('cm7','cm4'): raise ValueError('This compiler adapter supports CM7 and CM4 only')
        cpu,fpu=('cortex-m7','fpv5-d16') if core=='cm7' else ('cortex-m4','fpv4-sp-d16')
        cfg=spec['coreConfigs'].get(core,{})
        abi=cfg.get('floatAbi')
        if abi not in ('soft','softfp','hard'): raise ValueError('Float ABI must be explicit')
        opt=unit['optimization']
        if opt not in ('O0','O1','O2','O3','Os','Og','Oz'):raise ValueError('Invalid optimization')
        output=root/'build'/core/(Path(unit['source']).stem+'.o');output.parent.mkdir(parents=True,exist_ok=True)
        cmd=[prefix+'gcc','-std=c11','-Wall','-Wextra','-Werror','-fno-fast-math','-ffunction-sections','-fdata-sections','-mcpu='+cpu,'-mthumb','-mfpu='+fpu,'-mfloat-abi='+abi,'-'+opt]
        if spec['lto']:cmd+=['-flto']
        for include in includes:cmd+=['-I',str(include)]
        cmd+=['-c',str(root/unit['source']),'-o',str(output)]
        run(cmd);commands.append({'directory':str(root),'file':str(root/unit['source']),'arguments':cmd})
        outputs.setdefault(core,[]).append(output)
    artifacts=[]
    for core,objects in outputs.items():
        library=root/'build'/core/('libmodules_'+core+'.a')
        run([prefix+('gcc-ar' if spec['lto'] else 'ar'),'rcs',library,*objects])
        artifacts.append({'core':core,'kind':'library','path':str(library)})
    result={'status':'compiled','artifactKind':'module-library','firmwareReady':False,'artifacts':artifacts}
    (root/'compile_commands.json').write_text(json.dumps(commands,indent=2))
    (root/'compile-result.json').write_text(json.dumps(result,indent=2))
    print('Module libraries compiled. No flashable image was produced.')
    return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--prefix',required=True)
    a=p.parse_args();compile_libraries(a.root.resolve(),a.prefix)
