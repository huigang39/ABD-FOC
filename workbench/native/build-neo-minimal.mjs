import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNeo75hMinimalProject} from '../web/src/profiles/neo75h-minimal.mjs';
import {generateFirmware} from './firmware.mjs';
import {encodeIntelHex} from '../build-service/intel-hex.mjs';

const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const cube=process.env.STM32CUBE_H7;
if(!cube)throw Error('设置 STM32CUBE_H7 为本机 STM32Cube_FW_H7_Vx.y.z 目录。');
const project=createNeo75hMinimalProject();
const job=await generateFirmware({project,onProgress:console.log});
await cp(new URL('./targets/neo-minimal/',import.meta.url),join(job.root,'target'),{recursive:true});
execFileSync(process.env.ACTUATOR_PYTHON||'python',[join(job.root,'target/compile.py'),'--root',job.root,'--cube',cube],{stdio:'inherit'});
const result=JSON.parse(await readFile(join(job.root,'target-result.json'),'utf8'));
const segments=await Promise.all(result.images.map(async item=>({address:item.address,data:await readFile(item.bin)})));
const hex=encodeIntelHex(segments),filename=project.name+'.hex';
const release=join(workspace,'.workbench-local/releases',project.name,job.id);
await mkdir(release,{recursive:true});
await writeFile(join(release,filename),hex);
await writeFile(join(release,'project.json'),JSON.stringify(project,null,2));
await cp(new URL('./targets/neo-minimal/README.txt',import.meta.url),join(release,'README.txt'));
await mkdir(join(release,'licenses'),{recursive:true});
for(const [name,path] of [['STM32H7-HAL','Drivers/STM32H7xx_HAL_Driver/LICENSE.txt'],['CMSIS','Drivers/CMSIS/LICENSE.txt'],['STM32H7-CMSIS','Drivers/CMSIS/Device/ST/STM32H7xx/LICENSE.txt']])
  await cp(join(cube,path),join(release,'licenses',name+'.txt'));
for(const item of result.images)await cp(item.elf,join(release,item.core+'.elf'));
const manifest={...result,artifactKind:'firmware',target:'neo-minimal-independent-predriver',hardwareVerified:false,
  projectFingerprint:job.manifest.projectFingerprint,generatedRoot:job.root,calibrationStorage:'ram',
  filename,sha256:createHash('sha256').update(hex).digest('hex'),createdAt:new Date().toISOString()};
await writeFile(join(release,'manifest.json'),JSON.stringify(manifest,null,2));
await writeFile(join(workspace,'.workbench-local/neo-minimal-latest.json'),JSON.stringify({release,root:job.root,...manifest},null,2));
console.log(`NEO 最小速度闭环编译完成（尚未实机验证）：${join(release,filename)}`);
