import { randomUUID } from 'node:crypto';
import { BuildFailure, failureResponse } from './errors.mjs';
const respond = (res,status,body,extra={}) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(body));};

export async function readConfiguration(req) {
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new BuildFailure('JSON_REQUIRED','请使用 application/json 提交配置。',{status:415});
  let size=0;const chunks=[];
  for await(const part of req){size+=part.length;if(size>2*1024*1024)throw new BuildFailure('CONFIGURATION_TOO_LARGE','配置 JSON 不能超过 2 MiB。',{status:413});chunks.push(part);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw new BuildFailure('INVALID_JSON','无法解析配置 JSON。',{status:400});}
}

/** Mount this handler independently; it has no source, artifact or log routes. */
export function createBuildHttpHandler({service,authenticate,path='/v1/build',acquire=async()=>()=>{}}) {
  return async function handleBuild(req,res,url) {
    if(url.pathname!==path)return false;
    const requestId=randomUUID();let release;
    const abort=new AbortController();const disconnect=()=>{if(!res.writableEnded)abort.abort();};res.on('close',disconnect);
    try {
      if(req.method!=='POST')throw new BuildFailure('METHOD_NOT_ALLOWED','此接口只接受 POST 请求。',{status:405,stage:'request'});
      const authorization=await authenticate(req);
      if(!authorization)throw new BuildFailure('AUTHENTICATION_REQUIRED','构建服务需要有效的身份凭据。',{status:401,stage:'request'});
      const input=await readConfiguration(req);
      release=await acquire();
      const {fingerprint,delivery}=await service.build(input,{authorization,requestId,signal:abort.signal});
      if(res.destroyed)return true;
      res.writeHead(200,{'Content-Type':delivery.contentType,'Content-Length':delivery.bytes.length,'Content-Disposition':`attachment; filename="${delivery.filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Build-Id':requestId,'X-Configuration-Fingerprint':fingerprint,'X-Firmware-SHA256':delivery.sha256,'X-Firmware-Format':delivery.format});
      res.end(delivery.bytes);
    } catch(error) {
      const failure=failureResponse(error,requestId);
      if(!res.destroyed)respond(res,failure.status,failure.body,failure.status===429?{'Retry-After':'3'}:failure.status===405?{Allow:'POST'}:{});
    } finally {release?.();res.off('close',disconnect);}
    return true;
  };
}
