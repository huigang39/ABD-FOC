import {randomUUID,createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {resolve,join,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODULES} from '../web/src/core/catalog.mjs';
import {validateProject} from '../web/src/core/model.mjs';
import {configurationFingerprint} from '../web/src/core/contracts.mjs';
import {OPTIMIZATION_LEVELS} from '../web/src/features/build/options.mjs';
import {MODULE_CODE} from './generator/modules.mjs';
import {checkRuntimeLayout} from './generator/contracts.mjs';
import {driverConfigurationIssues} from './generator/drivers.mjs';
import {moduleConfig,writeNewProject} from './generator/project.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const defaultOutput=join(workspace,'.workbench-local/generated');
const TEMPLATE='abd-modular-v1';
const issue=(code,message,path='')=>{
  const moduleId = path.startsWith('design.moduleContracts.') ? path.split('.')[2] : path === 'target' ? 'hw-platform' : path.split('.')[0];
  return {code,id:`generator-${code}-${path}`,level:'error',title:'构建条件未满足',message,path,...(MODULES.some(module=>module.id===moduleId)?{moduleId}:{})};
};
const encrypted=p=>p?.build?.encryptFirmware?issue('encryption-unsupported','尚未接入服务器签名加密服务与设备 Bootloader，不能生成或编译明文固件冒充加密包。','build.encryptFirmware'):null;
export function findFirmwareToolchain(toolchainPath){
  let prefix=toolchainPath||process.env.ACTUATOR_GCC_PREFIX||join(workspace,'.workbench-local/toolchains/arm-gnu-expanded/Payload/bin/arm-none-eabi-');
  if(prefix.endsWith('gcc'))prefix=prefix.slice(0,-3);else if(!prefix.endsWith('arm-none-eabi-'))prefix=join(prefix,'bin/arm-none-eabi-');
  if(!existsSync(prefix+'gcc'))throw Error('未找到 GNU Arm GCC，请配置 ACTUATOR_GCC_PREFIX。');return prefix;
}
export function inspectFirmwareSupport(project){
  const sourceIssues=[],applied=[],parameters={};
  const enc=encrypted(project);if(enc)sourceIssues.push(enc);
  const errors=validateProject(project).filter(i=>i.level==='error');
  for(const error of errors)sourceIssues.push({...error,code:'validation',path:error.moduleId||error.paramKey||'project'});
  for(const module of MODULES){
    if(!project.instances?.[module.id]?.enabled)continue;
    if(!MODULE_CODE[module.id]){sourceIssues.push(issue('implementation',`${module.title}尚无新的模块实现。`,module.id));continue;}
    for(const message of checkRuntimeLayout(project,module))sourceIssues.push(issue('contracts',message,`design.moduleContracts.${module.id}`));
    if(module.id==='hw-drivers')for(const problem of driverConfigurationIssues(project.instances[module.id].parameters))sourceIssues.push(issue('driver-config',problem.message,`${module.id}.${problem.paramKey||''}`));
    try{moduleConfig(project,module.id);for(const [key,value] of Object.entries(MODULE_CODE[module.id].values?.(project)||{}))parameters[`${module.id}.${key}`]=value;}catch(error){sourceIssues.push(issue('implementation',error.message,module.id));}
    applied.push({path:module.id,target:`firmware/${{hardware:'hardware',foc:'algorithm',app:'application'}[module.layer]}/${MODULE_CODE[module.id].name}`,value:'独立模块源码与数据结构'});
  }
  if(!OPTIMIZATION_LEVELS.includes(project.build?.optimization))sourceIssues.push(issue('optimization','请选择全局优化等级。','build.optimization'));
  for(const [id,level] of Object.entries(project.build?.moduleOptimizations||{}))if(!MODULE_CODE[id]||!OPTIMIZATION_LEVELS.includes(level))sourceIssues.push(issue('module-optimization','模块优化等级无效。',`build.moduleOptimizations.${id}`));
  // A portable module library is not a firmware image. Never fall back to an imported image.
  const integrationIssues=[
    issue('platform-port','新的 MCU 启动、时钟、中断与 PCBA 外设适配尚未完成，不能生成可烧录镜像。','target'),
    issue('runtime-assembly','新的模块调度、输入输出交接及双核通信装配尚未完成。','execution'),
    issue('storage-port','新的校准、参数、日志存储适配尚未完成。','memory'),
  ];
  if(project.instances?.['app-comms']?.enabled)integrationIssues.push(issue('transport-port',`${project.instances['app-comms'].parameters.bus} 总线适配与线协议尚未接入新运行结构。`,'app-comms'));
  const issues=[...sourceIssues,...integrationIssues];
  return {supported:false,sourceReady:sourceIssues.length===0,sourceIssues,integrationIssues,issues,applied,unsupported:issues.map(i=>i.message),profile:project.name,template:TEMPLATE,parameters,notes:['源码直接由各模块实现、配置和输入/输出/状态定义生成。','不复制既有驱动工程，不保留原运行结构或按器件型号选择协议的分支。','模块库编译与可运行固件分别检查；完整平台装配完成前禁止烧录。']};
}
export async function generateFirmware({project,outputRoot=defaultOutput,onProgress=()=>{}}={}){
  const report=inspectFirmwareSupport(project);
  if(!report.sourceReady)throw Object.assign(Error(report.sourceIssues.map(i=>i.message).join('\n')),{issues:report.sourceIssues});
  const id=randomUUID(),root=join(resolve(outputRoot),id);await mkdir(root,{recursive:true});
  onProgress('依据模块配置和数据结构生成新的 C 源码。');
  const generatedFiles=await writeNewProject(root,project);
  const manifest={id,root,status:'generated',createdAt:new Date().toISOString(),template:TEMPLATE,profile:project.name,mcu:project.target.mcu,projectFingerprint:configurationFingerprint(project),artifactKind:'module-library',firmwareReady:false,generatedFiles,artifacts:[],applied:report.applied,unsupported:report.integrationIssues.map(i=>i.message),notes:report.notes};
  await writeFile(join(root,'project.json'),JSON.stringify(project,null,2));await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2));
  onProgress(`已生成 ${generatedFiles.length/2} 个独立模块，完整固件仍需完成平台装配。`);
  return {id,root,manifest};
}
async function storedJob(jobId,outputRoot){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(jobId||''))throw Error('构建任务标识无效。');
  const base=await realpath(resolve(outputRoot)),root=await realpath(join(base,jobId));if(!root.startsWith(base+sep))throw Error('构建路径不在生成目录内。');
  const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
  const project=JSON.parse(await readFile(join(root,'project.json'),'utf8'));
  const enc=encrypted(project);if(enc)throw Object.assign(Error(enc.message),{issues:[enc]});
  if(manifest.template!==TEMPLATE)throw Error('该产物来自已停用的生成器，请按新模块实现重新生成。');
  if(configurationFingerprint(project)!==manifest.projectFingerprint)throw Error('已保存的配置与生成源码不一致，请重新生成。');
  return {root,manifest,project};
}
export async function buildFirmware({project,jobId,outputRoot=defaultOutput}={}){
  const enc=encrypted(project);if(enc)throw Object.assign(Error(enc.message),{issues:[enc]});
  if(jobId){const saved=await storedJob(jobId,outputRoot);if(project&&configurationFingerprint(project)!==saved.manifest.projectFingerprint)throw Error('配置在代码生成后已改变，请重新生成。');project=saved.project;}
  if(!project)throw Error('缺少配置。');
  const report=inspectFirmwareSupport(project);
  throw Object.assign(Error(report.issues.map(i=>i.message).join('\n')),{issues:report.issues});
}
/** Compiler verification for developer use. The result is a library, never flashable. */
export async function compileModuleLibraries({jobId,outputRoot=defaultOutput,toolchainPath,onProgress=()=>{}}={}){
  const {root,manifest,project}=await storedJob(jobId,outputRoot);
  const enc=encrypted(project);if(enc)throw Error(enc.message);
  const prefix=findFirmwareToolchain(toolchainPath);
  await new Promise((accept,reject)=>{
    const child=spawn(process.env.ACTUATOR_PYTHON||'python3',[join(root,'tools/compile.py'),'--root',root,'--prefix',prefix],{shell:false});
    let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',part=>{log=(log+part).slice(-30000);onProgress(String(part));});
    child.on('error',reject);child.on('close',code=>code===0?accept():reject(Error(log)));
  });
  const result=JSON.parse(await readFile(join(root,'compile-result.json'),'utf8'));
  for(const artifact of result.artifacts){artifact.size=(await stat(artifact.path)).size;artifact.sha256=createHash('sha256').update(await readFile(artifact.path)).digest('hex');}
  const toolchain=spawnSync(prefix+'gcc',['--version'],{encoding:'utf8',timeout:5000}).stdout.split('\n')[0];
  Object.assign(manifest,result,{toolchain,compiledAt:new Date().toISOString()});await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2));
  return {id:jobId,root,...result,manifest};
}
