import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeApi } from '../native/api.mjs';
import { createProject } from '../web/src/core/model.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { newModuleProject } from './support/new-project.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'actuator-native-api-'));
  const generated = join(root, '.workbench-local/generated/example'); await mkdir(generated, { recursive: true });
  const bin = join(generated, 'cm7.bin'); await writeFile(bin, Buffer.from([1, 2, 3, 4]));
  const manifest = { template: 'abd-modular-v1', firmwareReady: true, profile: 'NEO_75_H_GW_KW', trace: { controlAddress: 0x2001c000, dataAddress: 0x2001d000, sampleHz: 20000 }, artifacts: [{ core: 'cm7', kind: 'bin', path: bin, size: 4 }] };
  const calls = [];
  const firmware = {
    inspectFirmwareSupport: async (project, args) => { calls.push({ method: 'inspect', project, args }); return options.inspect ? options.inspect(project, args) : { supported: true, issues: [] }; },
    generateFirmware: async args => { calls.push({ method: 'generate', args }); if (options.generateGate) await options.generateGate.promise; if (options.generateError) throw new Error(options.generateError); return { id: 'generated-1', root: generated, manifest }; },
    buildFirmware: async args => { calls.push({ method: 'build', args }); if (options.buildGate) await options.buildGate.promise; return { status: 'built', root: generated, manifest, artifacts: manifest.artifacts }; },
  };
  const debug = {
    status: async () => ({ connected: false }), probe: async () => ({ available: true, probes: [] }),
    connect: async args => { calls.push({ method: 'connect', args }); return { connected: true }; },
    disconnect: async () => ({ connected: false }),
    configureCapture: async args => { calls.push({ method: 'configure', args }); return { enabled: true }; },
    readCapture: async () => ({ channels: [] }),
    flash: async args => { calls.push({ method: 'flash', args }); if (options.flashGate) await options.flashGate.promise; return { programmed: true }; },
  };
  let api;
  const server = createServer(async (req, res) => { if (!await api(req, res, new URL(req.url, `http://${req.headers.host}`))) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  api = createNativeApi({ workspaceRoot: root, port, firmware, debug });
  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {
          const text = Buffer.concat(chunks).toString(); let data; try { data = JSON.parse(text); } catch { data = text; }
          resolve({ status: res.statusCode, headers: res.headers, data, bytes:Buffer.concat(chunks) });
        });
      });
      req.on('error', reject); req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
    });
  }
  const session = (await request('/api/session')).data;
  const post = (path, body, headers = {}) => request(path, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': session.token, ...headers } });
  const inspect = async project => {
    const response = await post('/api/firmware/inspect', { project });
    assert.equal(response.status, 200); assert.equal(response.data.supported, true);
    return response.data;
  };
  const waitJob = async id => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await request(`/api/jobs/${id}`);
      if (!['generating', 'building'].includes(response.data.status) && !(await request('/api/status')).data.busy) return response.data;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('job did not finish');
  };
  const close = async () => {
    for (let attempt = 0; attempt < 100 && (await request('/api/status')).data.busy; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true });
  };
  return { root, generated, manifest, calls, port, request, post, inspect, waitJob, close };
}

test('本地二进制入口复用会话检查，一次提交自动检查并交付，私有调试资料另行读取',async()=>{
  const app=await fixture(),project=newModuleProject();
  try{
    app.manifest.mcu=project.target.mcu;app.manifest.projectFingerprint=configurationFingerprint(project);
    for(const [core,address] of [['cm7',0x08000000],['cm4',0x08100000]]){
      const path=join(app.generated,`${core}.bin`),bytes=Buffer.from([1,2,3,4]);await writeFile(path,bytes);
      const artifact={kind:'bin',core,path,size:bytes.length,loadAddress:address,sha256:createHash('sha256').update(bytes).digest('hex')};
      const index=app.manifest.artifacts.findIndex(a=>a.core===core);if(index<0)app.manifest.artifacts.push(artifact);else app.manifest.artifacts[index]=artifact;
    }
    assert.equal((await app.post('/api/v1/build',project,{'X-Workbench-Token':'wrong'})).status,403);
    assert.deepEqual(app.calls,[]);
    const response=await app.post('/api/v1/build',project);
    assert.equal(response.status,200);assert.equal(response.headers['content-type'],'application/octet-stream');assert.equal(response.headers['x-firmware-format'],'intel-hex');
    assert.equal(response.headers['x-firmware-sha256'],createHash('sha256').update(response.bytes).digest('hex'));
    assert.deepEqual(app.calls.map(c=>c.method),['inspect','generate','build']);
    const job=(await app.request('/api/jobs/'+response.headers['x-build-id'])).data;
    assert.equal(job.status,'built');assert.equal(job.projectId,project.id);assert.equal(job.manifest.firmwareReady,true);
    assert.equal((await app.request('/api/status')).data.busy,false);
  }finally{await app.close();}
});

test('本地API检查Host、Origin、跨站标志、请求方式与会话令牌', async () => {
  const app = await fixture();
  try {
    for (const headers of [{ Host: `attacker.example:${app.port}` }, { Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await app.request('/api/session', { headers })).status, 403);
    assert.equal((await app.request('/api/debug/probe', { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await app.post('/api/debug/probe', {}, { 'X-Workbench-Token': 'invalid' })).status, 403);
    assert.equal((await app.post('/api/debug/probe', {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await app.request('/api/status', { method: 'DELETE' })).status, 405);
    const accepted = await app.post('/api/debug/probe', {}, { Origin: `http://127.0.0.1:${app.port}` });
    assert.equal(accepted.status, 200); assert.deepEqual(accepted.data.probes, []);
    assert.equal((await app.request('/api/session')).headers['cache-control'], 'no-store');
  } finally { await app.close(); }
});

test('job保留提交时配置与指纹，生成和编译使用同一配置且忽略客户端目录参数', async () => {
  const gate = deferred(), app = await fixture({ generateGate: gate }), project = createProject();
  const original = structuredClone(project), fingerprint = configurationFingerprint(original);
  try {
    await app.inspect(project);
    const response = await app.post('/api/firmware/build', { project, sourceRoot: '/outside', outputRoot: '/outside' });
    assert.equal(response.status, 200); assert.equal(response.data.fingerprint, fingerprint);
    project.instances['foc-current'].parameters.bandwidthHz = 999;
    gate.resolve(); const job = await app.waitJob(response.data.id);
    assert.equal(job.status, 'built'); assert.equal(job.fingerprint, fingerprint);
    const generated = app.calls.find(call => call.method === 'generate').args, built = app.calls.find(call => call.method === 'build').args;
    assert.deepEqual(generated.project, original); assert.deepEqual(built.project, original);
    assert.equal(built.jobId, 'generated-1'); assert.notEqual(generated.sourceRoot, '/outside');
    assert.equal(generated.outputRoot, join(app.root, '.workbench-local/generated'));
    assert.equal(job.artifacts[0].path, app.manifest.artifacts[0].path);
    assert.equal((await app.request(`/api/jobs?projectId=${encodeURIComponent(project.id)}`)).data.jobs.length, 1);
    assert.equal((await app.request('/api/jobs?projectId=other')).data.jobs.length, 0);
  } finally { gate.resolve(); await app.close(); }
});

test('重复构建被拒绝，生成失败释放任务锁且保留失败日志', async () => {
  const gate = deferred(), app = await fixture({ generateGate: gate, generateError: 'source missing' }), project = createProject();
  try {
    await app.inspect(project);
    const first = await app.post('/api/firmware/build', { project });
    assert.equal((await app.post('/api/firmware/generate', { project })).status, 409);
    assert.equal((await app.request('/api/status')).data.busy, true);
    gate.resolve(); const job = await app.waitJob(first.data.id);
    assert.equal(job.status, 'failed'); assert.equal(job.error, 'source missing'); assert.ok(job.log.includes('source missing'));
    assert.equal((await app.request('/api/status')).data.busy, false);
    assert.equal((await app.post('/api/firmware/generate', { project })).status, 200);
  } finally { gate.resolve(); await app.close(); }
});

test('调试连接与烧录只用服务器built job，不接受客户端伪造manifest', async () => {
  const app = await fixture(), project = createProject();
  try {
    await app.inspect(project);
    const generated = await app.post('/api/firmware/generate', { project }); await app.waitJob(generated.data.id);
    assert.equal((await app.post('/api/debug/flash', { jobId: generated.data.id })).status, 400);
    assert.equal((await app.post('/api/debug/connect', { jobId: 'missing', manifest: app.manifest })).status, 400);
    const built = await app.post('/api/firmware/build', { project }); await app.waitJob(built.data.id);
    const malicious = { profile: 'other', trace: { controlAddress: 0x40000000 }, artifacts: [{ path: '/outside' }] };
    assert.equal((await app.post('/api/debug/connect', { jobId: built.data.id, serialNumber: 123, manifest: malicious })).status, 200);
    assert.equal((await app.post('/api/debug/flash', { jobId: built.data.id, serialNumber: 123, manifest: malicious })).status, 200);
    for (const call of app.calls.filter(call => ['connect', 'flash'].includes(call.method))) {
      assert.equal(call.args.manifest.profile, 'NEO_75_H_GW_KW'); assert.equal(call.args.manifest.trace.controlAddress, 0x2001c000);
      assert.equal(call.args.manifest.artifacts[0].path, app.manifest.artifacts[0].path);
    }
  } finally { await app.close(); }
});

test('产物下载仅接受生成目录内真实文件，阻止路径和软链接逃逸', async () => {
  const app = await fixture(), project = createProject();
  try {
    await app.inspect(project);
    const built = await app.post('/api/firmware/build', { project }); const job = await app.waitJob(built.data.id);
    const downloaded = await app.request(job.artifacts[0].download);
    assert.equal(downloaded.status, 200); assert.equal(downloaded.headers['content-type'], 'application/octet-stream');
    const outside = join(app.root, 'outside.bin'); await writeFile(outside, 'outside');
    const escape = join(app.generated, 'escape.bin'); await symlink(outside, escape);
    for (const path of [outside, escape]) {
      app.manifest.artifacts[0].path = path;
      assert.equal((await app.request(job.artifacts[0].download)).status, 400);
    }
  } finally { await app.close(); }
});

test('编译进行中拒绝烧录已完成的旧job', async () => {
  const buildGate = deferred(), options = {}, app = await fixture(options), project = createProject();
  try {
    await app.inspect(project);
    const built = await app.post('/api/firmware/build', { project }); const job = await app.waitJob(built.data.id);
    options.buildGate = buildGate;
    await app.post('/api/firmware/build', { project });
    assert.equal((await app.post('/api/debug/flash', { jobId: job.id })).status, 400);
    assert.equal(app.calls.some(call => call.method === 'flash'), false);
  } finally { buildGate.resolve(); await app.close(); }
});

test('烧录期间快速status反映busy，不能并行构建或进行第二次设备操作', async () => {
  const flashGate = deferred(), app = await fixture({ flashGate }), project = createProject();
  let flash;
  try {
    await app.inspect(project);
    const built = await app.post('/api/firmware/build', { project }); const job = await app.waitJob(built.data.id);
    flash = app.post('/api/debug/flash', { jobId: job.id });
    for (let attempt = 0; attempt < 50 && !app.calls.some(call => call.method === 'flash'); attempt++) await new Promise(resolve => setTimeout(resolve, 2));
    const status = await app.request('/api/status'); assert.equal(status.data.busy, true); assert.equal(status.data.debug.pending, true);
    assert.ok([400, 409].includes((await app.post('/api/firmware/build', { project })).status));
    assert.equal((await app.post('/api/debug/connect', { jobId: job.id })).status, 409);
    assert.equal((await app.post('/api/debug/flash', { jobId: job.id })).status, 409);
    assert.equal((await app.post('/api/debug/configure', { channels: [] })).status, 409);
    flashGate.resolve(); assert.equal((await flash).status, 200);
    assert.equal((await app.request('/api/status')).data.busy, false);
  } finally { flashGate.resolve(); await flash; await app.close(); }
});

test('生成和构建自行检查提交配置，不要求先调用检查接口', async () => {
  const options={inspect:async()=>({supported:false,issues:[{level:'error',message:'配置不完整'}]})};
  const app=await fixture(options),project=createProject();
  try {
    for(const action of ['generate','build'])assert.equal((await app.post(`/api/firmware/${action}`,{project})).status,409);
    assert.equal(app.calls.some(c=>c.method==='generate'),false);
    options.inspect=async()=>({supported:true,issues:[]});
    for(const action of ['generate','build']) {
      project.build.optimization=action==='build'?'O3':'O2';
      const response=await app.post(`/api/firmware/${action}`,{project});assert.equal(response.status,200);
      assert.equal((await app.waitJob(response.data.id)).status,action==='build'?'built':'generated');
      assert.deepEqual(app.calls.filter(c=>c.method==='inspect').at(-1).project,project);
    }
    options.inspect=async()=>({supported:false,issues:[{level:'error',message:'new failure'}]});
    assert.equal((await app.post('/api/firmware/build',{project})).status,409);
  } finally {await app.close();}
});

test('配置错误或检查报告自带错误不能触发生成，即使检查器声称支持', async () => {
  const options={},app=await fixture(options);
  try {
    const invalid=createProject();invalid.instances['foc-current'].parameters.bandwidthHz=-1;
    for(const action of ['generate','build'])assert.equal((await app.post(`/api/firmware/${action}`,{project:invalid})).status,409);
    options.inspect=async()=>({supported:true,issues:[{level:'error',message:'missing implementation'}]});
    const project=createProject();
    const report=await app.post('/api/firmware/inspect',{project});assert.equal(report.data.supported,false);assert.equal(report.data.sourceReady,false);
    for(const action of ['generate','build'])assert.equal((await app.post(`/api/firmware/${action}`,{project})).status,409);
    assert.equal(app.calls.some(c=>c.method==='generate'),false);
  } finally {await app.close();}
});

test('模块源码可独立生成，但平台集成未完成时禁止固件构建', async () => {
  const options={inspect:async()=>({supported:false,sourceReady:true,sourceIssues:[],issues:[{level:'error',message:'platform missing'}]})};
  const app=await fixture(options),project=createProject();
  try {
    const response=await app.post('/api/firmware/generate',{project});assert.equal(response.status,200);await app.waitJob(response.data.id);
    assert.equal((await app.post('/api/firmware/build',{project})).status,409);
    assert.equal(app.calls.some(c=>c.method==='build'),false);
    options.inspect=async()=>({supported:false,sourceReady:true,sourceIssues:[{level:'error',message:'invalid layout'}],issues:[]});
    assert.equal((await app.post('/api/firmware/generate',{project})).status,409);
  } finally {await app.close();}
});

test('较早的异步检查不能覆盖新的报告，检查异常时不启动构建', async () => {
  const old=deferred(),entered=deferred(),options={},app=await fixture(options),project=createProject();let slow;
  try {
    let sequence=0;options.inspect=async()=>{if(++sequence===1){entered.resolve();await old.promise;return {supported:true,issues:[]};}return {supported:false,issues:[{level:'error',message:'new failure'}]};};
    slow=app.post('/api/firmware/inspect',{project});await entered.promise;
    assert.equal((await app.post('/api/firmware/inspect',{project})).data.supported,false);
    old.resolve();const result=await slow;assert.equal(result.data.stale,true);assert.equal(result.data.supported,false);
    options.inspect=async()=>{throw Error('inspection unavailable');};
    const response=await app.post('/api/firmware/build',{project});assert.equal(response.status,409);assert.match(response.data.error,/检查未完成/);
    assert.equal(app.calls.some(c=>c.method==='generate'),false);
  } finally {old.resolve();await slow;await app.close();}
});

test('不同配置身份和相同内容仍各自重新检查，不复用旧检查许可', async () => {
  const app=await fixture(),first=createProject(),second=structuredClone(first);second.id='another-console-configuration';
  assert.equal(configurationFingerprint(first),configurationFingerprint(second));
  try {
    for(const project of [first,second]){
      const response=await app.post('/api/firmware/build',{project});assert.equal(response.status,200);await app.waitJob(response.data.id);
    }
    assert.deepEqual(app.calls.filter(c=>c.method==='inspect').map(c=>c.project.id),[first.id,second.id]);
  } finally {await app.close();}
});

test('旧生成器产物与模块库即使标为built也不能用于设备连接或烧录', async () => {
  const app=await fixture(),project=createProject();
  try {
    const response=await app.post('/api/firmware/build',{project});await app.waitJob(response.data.id);
    for(const [template,firmwareReady] of [['retired-template',true],['abd-modular-v1',false]]){
      Object.assign(app.manifest,{template,firmwareReady});
      for(const action of ['connect','flash'])assert.equal((await app.post(`/api/debug/${action}`,{jobId:response.data.id})).status,400);
    }
    assert.equal(app.calls.some(c=>['connect','flash'].includes(c.method)),false);
  } finally {await app.close();}
});
