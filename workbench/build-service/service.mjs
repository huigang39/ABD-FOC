import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseProject, validateProject } from '../web/src/core/model.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { resolveReleasePolicy } from '../native/release-policy.mjs';
import { BuildFailure } from './errors.mjs';
import { deliverFirmware } from './delivery.mjs';

/** One JSON request owns one immutable configuration snapshot and build. */
export function createBuildService({ firmware, outputRoot, onPrivateResult = async () => {} }) {
  let active = false;
  return {
    get busy() { return active; },
    async build(input, { authorization, requestId = randomUUID(), signal } = {}) {
      if (active) throw new BuildFailure('BUILD_BUSY','构建服务正在处理另一个请求，请稍后重试。',{status:429,stage:'service'});
      active = true;
      let project, fingerprint, generated, result, stage='validation';
      const createdAt=new Date().toISOString(),log=[];
      const progress = line => { log.push(String(line).slice(0,20000)); if(log.length>1500)log.shift(); };
      const checkAbort=()=>{if(signal?.aborted)throw new BuildFailure('REQUEST_CANCELLED','构建请求已取消。',{status:409,stage});};
      try {
        try { project=parseProject(JSON.stringify(input)); }
        catch { throw new BuildFailure('INVALID_CONFIGURATION','配置 JSON 格式不正确，请使用控制台导出的配置文件。',{status:400}); }
        // Measurements never enter compilation or public replies.
        delete project.performance;
        fingerprint=configurationFingerprint(project);
        let policy;
        try { policy=resolveReleasePolicy({...authorization,encryptFirmware:project.build.encryptFirmware}); }
        catch (error) { throw new BuildFailure(error.code || 'RELEASE_POLICY',error.message,{status:403,stage:'delivery'}); }
        if(policy.encryptFirmware)throw new BuildFailure('ENCRYPTION_NOT_IMPLEMENTED','签名加密发布与设备 Bootloader 尚未接入，无法交付加密固件。',{status:501,stage:'delivery'});
        checkAbort();
        const inspection=await firmware.inspectFirmwareSupport(project,{outputRoot:resolve(outputRoot)});
        const issues=[...validateProject(project).filter(issue=>issue.level==='error'),...(inspection.issues || [])];
        const unique=[...new Map(issues.map((issue,index)=>[JSON.stringify([issue.id||index,issue.message]),issue])).values()];
        if(inspection.supported!==true || unique.some(issue=>issue.level==='error'))throw new BuildFailure('CONFIGURATION_REJECTED','构建检查未通过，请处理配置或目标适配问题。',{issues:unique});
        checkAbort();stage='generation';
        generated=await firmware.generateFirmware({project,outputRoot:resolve(outputRoot),onProgress:progress,signal});
        checkAbort();stage='compilation';
        result=await firmware.buildFirmware({project,jobId:generated.id,outputRoot:resolve(outputRoot),onProgress:progress,signal});
        result={...generated,...result};
        checkAbort();stage='delivery';
        const delivery=await deliverFirmware({project,result,outputRoot,buildId:requestId,fingerprint});
        checkAbort();
        await onPrivateResult({id:requestId,project,createdAt,finishedAt:new Date().toISOString(),fingerprint,status:'built',log,result,delivery:delivery.manifest});
        return {requestId,fingerprint,delivery};
      } catch(error) {
        const safe=error instanceof BuildFailure?error:new BuildFailure('BUILD_FAILED',({validation:'服务端检查未能完成。',generation:'代码生成未能完成。',compilation:'固件编译未能完成。',delivery:'固件交付未能完成。'}[stage] || '构建未能完成。')+' 可凭请求编号查询服务端记录。',{status:500,stage});
        safe.requestId=requestId;safe.fingerprint=fingerprint;
        // Detailed errors remain server-side. The HTTP handler only exposes BuildFailure.
        try { await onPrivateResult({id:requestId,project,createdAt,finishedAt:new Date().toISOString(),fingerprint,status:'failed',log:[...log,error.stack||error.message],result:result||generated,error:safe.message}); } catch {}
        throw safe;
      } finally { active=false; }
    },
  };
}
