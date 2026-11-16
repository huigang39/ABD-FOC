/** Standalone private build service. It never mounts the workbench or debug API. */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import * as firmware from './native/firmware.mjs';
import { createBuildService } from './build-service/service.mjs';
import { createBuildHttpHandler } from './build-service/http.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.BUILD_SERVICE_PORT || 4320);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('BUILD_SERVICE_PORT 必须为 1024–65535 的整数。');
/** 环境变量优先；未提供时生成一次并保存到 .workbench-local，跨平台零配置启动。 */
async function resolveToken() {
  const fromEnv=process.env.BUILD_SERVICE_TOKEN || '';
  if (fromEnv) {
    if (fromEnv.length < 32) throw Error('BUILD_SERVICE_TOKEN 需要至少 32 个字符的服务凭据。');
    return fromEnv;
  }
  const tokenPath=resolve(dirname(fileURLToPath(import.meta.url)),'.workbench-local','build-service-token');
  let stored='';
  try { stored=(await readFile(tokenPath,'utf8')).trim(); } catch {}
  if (stored.length < 32) {
    stored=randomBytes(32).toString('hex');
    await mkdir(dirname(tokenPath),{recursive:true});
    await writeFile(tokenPath,stored,{mode:0o600});
    console.log(`已生成服务凭据：${tokenPath}`);
  }
  return stored;
}
const token=await resolveToken();
const environment=process.env.BUILD_SERVICE_ENVIRONMENT || 'production';
const authenticatedRole=process.env.BUILD_SERVICE_ROLE || 'end-user';
if(!['production','development'].includes(environment)||!['developer','end-user'].includes(authenticatedRole))throw Error('构建服务的发布环境或身份配置无效。');
const secret=Buffer.from(token);
const outputRoot=resolve(process.env.BUILD_SERVICE_OUTPUT || resolve(workspace,'.workbench-local/private-builds'));
const service=createBuildService({firmware,outputRoot,onPrivateResult:async record=>{
  const folder=resolve(outputRoot,'requests');await mkdir(folder,{recursive:true});
  // Private execution evidence; no HTTP endpoint serves this directory.
  await writeFile(resolve(folder,`${record.id}.json`),JSON.stringify(record,null,2));
}});
const handler=createBuildHttpHandler({service,authenticate:async req=>{
  const header=req.headers.authorization;
  if(typeof header!=='string'||!header.startsWith('Bearer '))return null;
  const supplied=Buffer.from(header.slice(7));
  return supplied.length===secret.length&&timingSafeEqual(supplied,secret)?{authenticatedRole,environment}:null;
}});
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(await handler(req,res,url))return;
    res.writeHead(404,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:{code:'NOT_FOUND',message:'此服务仅提供 POST /v1/build。'}}));
  } catch {if(!res.headersSent)res.writeHead(500);res.end();}
});
server.requestTimeout=300000;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'构建服务端口已被占用。':'构建服务启动失败。');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Build service: http://127.0.0.1:${port}/v1/build`));
