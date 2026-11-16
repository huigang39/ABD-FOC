import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newModuleProject} from './support/new-project.mjs';
import {generateFirmware} from '../native/firmware.mjs';

test('module-library compiler honors core ABI, global/module optimization, LTO and compiler version',async t=>{
  const outputRoot=await mkdtemp(join(tmpdir(),'abd-compiler-manifest-'));t.after(()=>rm(outputRoot,{recursive:true,force:true}));
  const p=newModuleProject();p.build.optimization='O2';p.build.moduleOptimizations={'foc-current':'O3'};p.build.lto=true;p.build.version='15.3.1';
  const job=await generateFirmware({project:p,outputRoot});
  const script=`import json,runpy,sys
from pathlib import Path
from unittest.mock import patch
root=Path(sys.argv[1]);module=runpy.run_path(str(root/'tools/compile.py'));commands=[]
with patch('subprocess.run',side_effect=lambda args,**kw:commands.append(args)),patch('subprocess.check_output',return_value='15.3.1'):
    result=module['compile_libraries'](root,'arm-none-eabi-')
assert result['firmwareReady'] is False
assert len(result['artifacts'])==2
assert all(item['kind']=='library' for item in result['artifacts'])
assert all('-flto' in cmd for cmd in commands if cmd[0].endswith('gcc'))
assert all(cmd[0].endswith('gcc-ar') for cmd in commands if '-c' not in cmd)
assert any('-mcpu=cortex-m7' in cmd and '-mfpu=fpv5-d16' in cmd for cmd in commands)
assert any('-mcpu=cortex-m4' in cmd and '-mfpu=fpv4-sp-d16' in cmd for cmd in commands)
for cmd in commands:
    if '-c' in cmd:
        path=cmd[cmd.index('-c')+1]
        assert ('-O3' if path.endswith('/current.c') else '-O2') in cmd
spec=json.loads((root/'build-manifest.json').read_text())
for key,value in [('compiler','clang'),('version','0.0.0'),('mcu','HPM5361')]:
    altered=dict(spec);altered[key]=value;(root/'build-manifest.json').write_text(json.dumps(altered))
    with patch('subprocess.check_output',return_value='15.3.1'):
        try:module['compile_libraries'](root,'arm-none-eabi-')
        except ValueError:pass
        else:raise AssertionError('Unsupported compiler settings accepted: '+key)
print('compiler configuration passed')`;
  assert.match(execFileSync('python3',['-c',script,job.root],{encoding:'utf8'}),/compiler configuration passed/);
  const commands=JSON.parse(await readFile(join(job.root,'compile_commands.json'),'utf8'));assert.equal(commands.length,15);
});
