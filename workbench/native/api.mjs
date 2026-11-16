import { MODULE_CODE } from './generator/modules.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, realpath, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, sep, basename } from 'node:path';
import { parseProject, validateProject } from '../web/src/core/model.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { createBuildService } from '../build-service/service.mjs';
import { createBuildHttpHandler } from '../build-service/http.mjs';
import { BuildFailure } from '../build-service/errors.mjs';

const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};
async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw Object.assign(new Error('请求必须使用 JSON。'), { status: 415 });
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw Object.assign(new Error('项目配置超过 2 MiB。'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('JSON 格式无法读取。'); }
}
const publicJob = job => ({ id: job.id, projectId: job.projectId, name: job.name, fingerprint: job.fingerprint, action: job.action, status: job.status, createdAt: job.createdAt, finishedAt: job.finishedAt, log: job.log, error: job.error, manifest: job.result?.manifest, artifacts: (job.result?.artifacts || job.result?.manifest?.artifacts || []).map((item, index) => ({ ...item, download: `/api/jobs/${job.id}/artifacts/${index}` })), root: job.result?.root });

/** Local-only API. No shell, arbitrary executable, source path, or output path from HTTP. */
export function createNativeApi({ workspaceRoot, port, firmware, debug }) {
  const token = randomBytes(32).toString('hex');
  const jobs = new Map();
  const inspections = new Map();
  let building = false;
  let hardwareBusy = false;
  const hardwareAction = async callback => {
    if (hardwareBusy || building) throw Object.assign(new Error('本地服务正在处理构建或设备操作，请等待完成。'), { status: 409 });
    hardwareBusy = true;
    try { return await callback(); } finally { hardwareBusy = false; }
  };
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const outputRoot = resolve(workspaceRoot, '.workbench-local/generated');
  const historyPath = resolve(workspaceRoot, '.workbench-local/build-jobs.json');
  const ready = (async () => {
    try {
      const saved = JSON.parse(await readFile(historyPath, 'utf8'));
      if (!Array.isArray(saved)) return;
      for (const job of saved.slice(-30)) {
        if (!job || typeof job.id !== 'string' || !/^[\w-]{1,80}$/.test(job.id) || typeof job.fingerprint !== 'string' || !Array.isArray(job.log)) continue;
        if (['generating', 'building'].includes(job.status)) { job.status = 'failed'; job.error = '上次构建被服务重启中断，请重新编译。'; }
        jobs.set(job.id, job);
      }
    } catch (error) { if (error.code !== 'ENOENT') console.warn('构建记录未能载入：', error.message); }
  })();
  async function saveHistory() {
    try {
      await mkdir(resolve(workspaceRoot, '.workbench-local'), { recursive: true });
      const temporary = `${historyPath}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify([...jobs.values()].slice(-30)));
      await rename(temporary, historyPath);
    } catch (error) { console.warn('构建记录未能保存：', error.message); }
  }
  const binaryBuild = createBuildHttpHandler({
    path: '/api/v1/build',
    authenticate: async () => ({authenticatedRole:'developer',environment:'development'}),
    acquire: async () => {
      if (building || hardwareBusy) throw new BuildFailure('BUILD_BUSY','已有构建或设备任务正在执行。',{status:409,stage:'service'});
      const status = await debug.status();
      if (building || hardwareBusy || status.connected) throw new BuildFailure('DEVICE_BUSY','请完成设备操作并断开调试连接后再构建。',{status:409,stage:'service'});
      building = true;
      return () => { building = false; };
    },
    service: createBuildService({firmware,outputRoot,onPrivateResult:async record=>{
      if (!record.project || !record.result) return;
      const {project,...job}=record;
      jobs.set(job.id,{...job,projectId:project.id,name:project.name,action:'build'});
      await saveHistory();
    }}),
  });
  const trustedJob = id => {
    const job = jobs.get(id);
    if (!job || job.status !== 'built') throw new Error('请先完成双核固件编译，再选择此次产物。');
    if (job.result?.manifest?.template !== 'abd-modular-v1' || job.result.manifest.firmwareReady !== true) throw new Error('该产物不是新架构下可烧录的固件镜像。');
    return job;
  };
  const manifestFor = job => ({ ...job.result.manifest, root: job.result.root, artifacts: job.result.artifacts || job.result.manifest.artifacts });
  function startJob(project, action) {
    if (building || hardwareBusy) throw Object.assign(new Error('已有构建或设备任务正在执行。'), { status: 409 });
    building = true;
    const job = { id: randomUUID(), projectId: project.id, name: project.name, fingerprint: configurationFingerprint(project), action, status: 'generating', createdAt: new Date().toISOString(), log: [], result: null };
    jobs.set(job.id, job);
    const progress = line => { job.log.push(String(line).slice(0, 20000)); if (job.log.length > 1500) job.log.splice(0, job.log.length - 1500); };
    (async () => {
      try {
        progress('读取模块配置与数据结构，生成独立源码。');
        job.result = await firmware.generateFirmware({ project, outputRoot, onProgress: progress });
        if (action === 'build') {
          job.status = 'building';
          const built = await firmware.buildFirmware({ project, jobId: job.result.id, outputRoot, onProgress: progress });
          job.result = { ...job.result, ...built };
          if (built.status && !['built', 'success', 'succeeded', 'completed'].includes(built.status)) throw new Error(built.error || '编译未完成，请查看构建日志。');
          job.status = 'built'; progress('M7 / M4 编译完成。');
        } else { job.status = 'generated'; progress('代码生成完成。'); }
      } catch (error) { job.status = 'failed'; job.error = error.message; progress(error.message); }
      finally { job.finishedAt = new Date().toISOString(); await saveHistory(); building = false; }
    })();
    return publicJob(job);
  }
  return async function handleNativeApi(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      await ready;
      const hostOrigin = `http://${req.headers.host}`;
      if (!origins.has(hostOrigin) || (req.headers.origin && !origins.has(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
        json(res, 403, { error: '本地服务仅接受同源请求。' }); return true;
      }
      if (!['GET', 'POST'].includes(req.method)) { json(res, 405, { error: '此接口不支持该请求方式。' }); return true; }
      if (req.method === 'POST' && req.headers['x-workbench-token'] !== token) { json(res, 403, { error: '服务会话已更新，请刷新页面后重试。' }); return true; }
      if (await binaryBuild(req,res,url)) return true;
      const path = url.pathname;
      let result;
      if (req.method === 'GET' && path === '/api/session') result = { token, outputRoot };
      else if (req.method === 'GET' && path === '/api/module-source') {
        const id=url.searchParams.get('module');
        const info=Object.hasOwn(MODULE_CODE,id||'')?MODULE_CODE[id]:null;
        if(!info)throw Object.assign(new Error('模块不存在。'),{status:404});
        result={filename:info.name+'.c',kind:'implementation-template',content:await readFile(new URL(`./generator/modules/${info.name}.c`,import.meta.url),'utf8')};
      }
      else if (req.method === 'GET' && path === '/api/status') result = { outputRoot, busy: building || hardwareBusy, debug: hardwareBusy ? { connected: false, pending: true } : await debug.status() };
      else if (req.method === 'GET' && path === '/api/jobs') result = { jobs: [...jobs.values()].filter(j => !url.searchParams.get('projectId') || j.projectId === url.searchParams.get('projectId')).slice(-20).reverse().map(publicJob) };
      else if (req.method === 'GET' && /^\/api\/jobs\/[^/]+$/.test(path)) {
        const job = jobs.get(path.split('/')[3]); if (!job) throw new Error('此服务会话中没有该构建任务。'); result = publicJob(job);
      } else if (req.method === 'GET' && /^\/api\/jobs\/[^/]+\/artifacts\/\d+$/.test(path)) {
        const parts = path.split('/'), job = trustedJob(parts[3]);
        const artifact = (job.result.artifacts || job.result.manifest.artifacts || [])[Number(parts[5])];
        if (!artifact) throw new Error('构建产物不存在。');
        const file = await realpath(artifact.path), safeRoot = await realpath(outputRoot);
        if (!file.startsWith(safeRoot + sep) || !(await stat(file)).isFile()) throw new Error('产物路径不在生成目录内。');
        const content = await readFile(file);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${basename(file).replace(/[^\w.-]/g, '_')}"`, 'Content-Length': content.length, 'X-Content-Type-Options': 'nosniff' }); res.end(content); return true;
      } else if (req.method === 'GET' && /^\/api\/jobs\/[^/]+\/sources\/\d+$/.test(path)) {
        const parts = path.split('/'), job = jobs.get(parts[3]);
        const entry = job?.result?.manifest?.generatedFiles?.[Number(parts[5])];
        if (!entry) throw new Error('没有此模块源码。');
        const file = await realpath(entry.path), safeRoot = await realpath(outputRoot);
        const info = await stat(file);
        if (!file.startsWith(safeRoot + sep) || !info.isFile() || info.size > 512 * 1024) throw new Error('此文件不在可预览的生成源码范围内。');
        result = { ...entry, content: await readFile(file, 'utf8') };
      } else if (req.method === 'GET' && path === '/api/debug/status') result = await debug.status();
      else if (req.method === 'GET' && path === '/api/debug/capture') result = await debug.readCapture();
      else if (req.method === 'POST') {
        const body = await readBody(req);
        if (path.startsWith('/api/debug/') && hardwareBusy) throw Object.assign(new Error('设备操作正在执行，请等待完成。'), { status: 409 });
        if (path === '/api/firmware/inspect') {
          const configurationId = body.project?.id;
          const inspectionId = Symbol('inspection');
          // A slower earlier response must not replace the latest report.
          if (typeof configurationId === 'string') {
            inspections.delete(configurationId);
            inspections.set(configurationId, inspectionId);
            if (inspections.size > 100) {
              const expired = inspections.keys().next().value;
              inspections.delete(expired);
            }
          }
          const configuration = parseProject(JSON.stringify(body.project));
          const fingerprint = configurationFingerprint(configuration);
          const inspection = await firmware.inspectFirmwareSupport(configuration, { outputRoot });
          const errors = validateProject(configuration).filter(issue => issue.level === 'error');
          const issues = [...new Map([...errors, ...(inspection.issues || [])].map((issue,index)=>[issue.id||`native-${index}`,issue])).values()];
          const stale = inspections.get(configurationId) !== inspectionId;
          const supported = inspection.supported === true && !issues.some(issue => issue.level === 'error');
          const sourceReady = errors.length === 0 && (inspection.sourceReady === undefined ? supported : inspection.sourceReady === true && !inspection.sourceIssues?.some(issue => issue.level === 'error'));
          result = { ...inspection, fingerprint, stale, supported: !stale && supported, sourceReady: !stale && sourceReady, issues };
        }
        else if (path === '/api/firmware/generate' || path === '/api/firmware/build') {
          if (building || hardwareBusy) throw Object.assign(new Error('已有构建或设备任务正在执行。'), {status:409});
          if (hardwareBusy || (await debug.status()).connected) throw new Error('请先完成设备操作并断开调试连接，再生成或编译。');
          const configuration = parseProject(JSON.stringify(body.project));
          const action=path.endsWith('/build')?'build':'generate';
          let inspection;
          try { inspection=await firmware.inspectFirmwareSupport(configuration,{outputRoot}); }
          catch (error) { throw Object.assign(new Error(`构建检查未完成：${error.message}`), {status:409}); }
          const errors=validateProject(configuration).filter(issue=>issue.level==='error');
          const supported=inspection.supported===true&&!inspection.issues?.some(issue=>issue.level==='error');
          const sourceReady=inspection.sourceReady===undefined?supported:inspection.sourceReady===true&&!inspection.sourceIssues?.some(issue=>issue.level==='error');
          if(errors.length||!(action==='generate'?sourceReady:supported))throw Object.assign(new Error('构建检查未通过：'+[...errors,...(action==='generate'?inspection.sourceIssues||inspection.issues||[]:inspection.issues||[])].map(issue=>issue.message||issue.title).join('\n')),{status:409});
          if (hardwareBusy || (await debug.status()).connected) throw Object.assign(new Error('检查期间设备状态发生变化，请断开调试后重新构建。'), {status:409});
          result = startJob(configuration, path.endsWith('/build') ? 'build' : 'generate');
        }
        else if (path === '/api/debug/probe') result = await debug.probe();
        else if (path === '/api/debug/connect') result = await hardwareAction(() => debug.connect({ manifest: manifestFor(trustedJob(body.jobId)), serialNumber: body.serialNumber, speedKHz: body.speedKHz || 4000 }));
        else if (path === '/api/debug/disconnect') result = await hardwareAction(() => debug.disconnect());
        else if (path === '/api/debug/configure') result = await debug.configureCapture({ divider: body.divider, channels: body.channels });
        else if (path === '/api/debug/flash') {
          if (building) throw new Error('请等待编译完成。');
          result = await hardwareAction(() => debug.flash({ manifest: manifestFor(trustedJob(body.jobId)), serialNumber: body.serialNumber, speedKHz: body.speedKHz || 4000 }));
        } else { json(res, 404, { error: '没有此服务接口。' }); return true; }
      } else { json(res, 404, { error: '没有此服务接口。' }); return true; }
      json(res, 200, result ?? { ok: true });
    } catch (error) { json(res, error.status || 400, { error: error.message }); }
    return true;
  };
}
