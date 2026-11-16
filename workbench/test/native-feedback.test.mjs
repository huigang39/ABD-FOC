import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { validateProject } from '../web/src/core/model.mjs';
import { newModuleProject } from './support/new-project.mjs';
import { configurationFingerprint } from '../web/src/core/contracts.mjs';
import { getBuildInspectionState } from '../web/src/features/build/gate.mjs';
import { createNativeClient } from '../web/src/features/device/client.mjs';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function binaryResponse(project, changes = {}) {
  const bytes=Buffer.from(':020000040800F2\r\n:0400000001020304F2\r\n:00000001FF\r\n');
  return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','X-Firmware-Format':'intel-hex','Content-Length':String(bytes.length),'X-Build-Id':randomUUID(),'X-Configuration-Fingerprint':configurationFingerprint(project),'X-Firmware-SHA256':createHash('sha256').update(bytes).digest('hex'),...changes}});
}

function clientFixture(t, handler, getProject = () => ({ id: 'project-one', name: '关节模组' }), validateConfiguration = () => []) {
  const calls = [], notices = [], errors = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const request = { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(request);
    const result = url === '/api/session' ? { data: { token: 'session-token' } } : await handler(request);
    if (result instanceof Response) return result;
    if (url === '/api/firmware/inspect' && result.data && !Object.hasOwn(result.data, 'fingerprint')) result.data = { ...result.data, fingerprint: configurationFingerprint(request.body.project) };
    const status = result.status ?? 200;
    return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(result.data) };
  });
  const client = createNativeClient({
    getProject, validateConfiguration,
    onUpdate: () => {},
    onError: message => errors.push(message),
    onNotice: (message, options) => notices.push({ message, ...options }),
  });
  t.after(() => client.destroy());
  return { client, calls, notices, errors };
}

test('检查、生成和编译只发送当前固件配置，性能记录留在本地且项目不被修改', async t => {
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  let project;
  const { client, calls, errors } = clientFixture(t, ({ url, method, body }) => {
    assert.equal(method, 'POST');
    const { performance, ...configuration } = project;
    const submitted=url==='/api/v1/build'?body:body.project;
    assert.equal(Object.hasOwn(submitted, 'performance'), false);
    assert.deepEqual(submitted, configuration);
    assert.doesNotMatch(JSON.stringify(body), /private-measurement|private-fixture-notes/);
    if (url === '/api/firmware/inspect') return { data: { supported: true, issues: [] } };
    if (url === '/api/firmware/generate') return { data: { id: 'generated', status: 'generated' } };
    if (url === '/api/v1/build') return binaryResponse(body);
    assert.fail(`Unexpected request: ${url}`);
  }, () => project);
  for (const [index, action] of ['inspect', 'generate', 'build'].entries()) {
    project = freeze({
      id: 'project-one', name: '关节模组', revision: index,
      target: { mcu: 'STM32H745IIK6' },
      build: { compiler: 'gcc', optimization: ['O0', 'Og', 'O2'][index], encryptFirmware: false },
      instances: { 'foc-current': { enabled: true, parameters: { bandwidthHz: 500 + index } } },
      performance: { records: [{ id: 'private-measurement', conditions: { notes: 'private-fixture-notes' }, samples: [{ currentA: index, torqueNm: index * 8 }] }] },
    });
    const before = structuredClone(project), records = project.performance.records;
    await client.action(action);
    assert.deepEqual(errors, []);
    assert.deepEqual(project, before);
    assert.strictEqual(project.performance.records, records);
    assert.equal(calls.filter(call => call.url === (action==='build'?'/api/v1/build':`/api/firmware/${action}`)).length, 1);
  }
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => call.url), ['/api/firmware/inspect', '/api/firmware/inspect', '/api/firmware/generate', '/api/v1/build']);
});

test('生成检查按通过、待完善和错误阻塞分级，一次检查只汇总通知一次', async t => {
  let inspection;
  const { client, notices, errors } = clientFixture(t, ({ url }) => {
    assert.equal(url, '/api/firmware/inspect');
    return { data: inspection };
  });
  for (const [result, level] of [
    [{ supported: true, issues: [] }, 'success'],
    [{ supported: false, issues: [{ level: 'pending', path: 'hw-board.pwmHz', message: '采样频率待填写' }] }, 'warning'],
    [{ supported: false, issues: [{ level: 'error', path: 'foc-current.bandwidthHz', message: '带宽超出约束' }, { level: 'warning', message: '请核对电机参数' }] }, 'error'],
  ]) {
    inspection = result;
    const before = notices.length;
    await client.action('inspect');
    assert.equal(notices.length, before + 1);
    assert.equal(notices.at(-1).level, level);
    assert.deepEqual(notices.at(-1).issues, result.issues);
    assert.equal(notices.at(-1).presentation, 'notification');
    assert.ok(notices.at(-1).message);
  }
  assert.deepEqual(errors, []);
  assert.equal(client.state.pendingAction, '');
});

test('真实扫描返回空列表时仅发一次warning，不保留过期探针选择', async t => {
  const { client, calls, notices, errors } = clientFixture(t, ({ url }) => {
    assert.equal(url, '/api/debug/probe');
    return { data: { available: true, probes: [] } };
  });
  client.state.probes = [{ serialNumber: 123 }]; client.state.serialNumber = '123';
  await client.action('probe');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, 'warning'); assert.equal(notices[0].title, '未发现探针');
  assert.equal(notices[0].presentation, undefined);
  assert.deepEqual(client.state.probes, []); assert.equal(client.state.serialNumber, '');
  assert.deepEqual(errors, []);
  assert.equal(calls.filter(call => call.url === '/api/debug/probe').length, 1);
});

test('后台refresh失败静默，用户手动refresh失败只调用一次onError', async t => {
  const { client, notices, errors } = clientFixture(t, ({ url }) => {
    if (url === '/api/status') return { status: 503, data: { error: '本地服务暂不可用' } };
    if (url.startsWith('/api/jobs?')) return { data: { jobs: [] } };
    assert.fail(`Unexpected request: ${url}`);
  });
  await client.refresh();
  await client.refresh();
  assert.deepEqual(errors, []); assert.deepEqual(notices, []);
  await client.action('refresh');
  assert.deepEqual(errors, ['本地服务暂不可用']);
  assert.deepEqual(notices, []);
  await client.refresh();
  assert.equal(errors.length, 1);
});

test('完成通知只属于本次发起的job，重复刷新不重报，每个新job独立通知', async t => {
  const jobs = [{ id: 'historical', projectId: 'project-one', status: 'built', log: [] }];
  let sequence = 0;
  const { client, notices, errors } = clientFixture(t, ({ url }) => {
    if (url === '/api/status') return { data: { busy: false, debug: { connected: false } } };
    if (url.startsWith('/api/jobs?')) return { data: { jobs } };
    if (url === '/api/firmware/inspect') return { data: { supported: true, issues: [] } };
    if (url === '/api/firmware/generate') {
      const job = { id: `build-${++sequence}`, projectId: 'project-one', status: 'generating', log: [] };
      jobs.unshift(job); return { data: job };
    }
    assert.fail(`Unexpected request: ${url}`);
  });
  await client.refresh();
  assert.equal(notices.length, 0);
  await client.action('inspect'); notices.length = 0;
  for (let index = 1; index <= 2; index++) {
    await client.action('generate');
    assert.equal(notices.length, index - 1);
    jobs[0].status = 'generated';
    await client.refresh(); await client.refresh();
    assert.equal(notices.length, index);
    assert.equal(notices.at(-1).level, 'success'); assert.equal(notices.at(-1).title, '代码已生成');
    assert.equal(notices.at(-1).presentation, undefined);
  }
  assert.deepEqual(errors, []);
});

test('烧录条件说明仅通过onNotice展示，不发起网络或设备请求', async t => {
  const { client, calls, notices, errors } = clientFixture(t, () => assert.fail('不应请求本地服务'));
  await client.action('flash-requirements');
  assert.equal(notices.length, 1); assert.equal(notices[0].title, '烧录条件');
  assert.equal(notices[0].presentation, 'dialog');
  assert.match(notices[0].message, /双核固件/);
  assert.deepEqual(calls, []); assert.deepEqual(errors, []);
});

test('主动重看生成检查显式请求对话框，沿用详情且不重新请求服务', async t => {
  const issues = [{ level: 'warning', message: '参数待核对' }];
  const { client, calls, notices, errors } = clientFixture(t, ({ url }) => {
    assert.equal(url, '/api/firmware/inspect'); return { data: { supported: false, issues } };
  });
  await client.action('inspect');
  const requests = calls.length;
  await client.action('review-inspection');
  assert.equal(calls.length, requests); assert.equal(notices.length, 2);
  assert.equal(notices[0].presentation, 'notification');
  assert.equal(notices[1].presentation, 'dialog'); assert.equal(notices[1].level, 'warning');
  assert.deepEqual(notices[1].issues, issues); assert.match(notices[1].message, /上次/);
  assert.deepEqual(errors, []);
});

test('生成与烧录成功使用success通知，连接身份不符仍为warning通知', async t => {
  let connected = false;
  const { client, notices, errors } = clientFixture(t, ({ url, body }) => {
    if (url === '/api/firmware/inspect') return { data: { supported: true, issues: [] } };
    if (url === '/api/firmware/generate') return { data: { id: 'generated', status: 'generated', fingerprint: configurationFingerprint(body.project), artifacts: [{ core: 'cm7', kind: 'bin', path: '/generated/cm7.bin', loadAddress: 0x08000000 }, { core: 'cm4', kind: 'bin', path: '/generated/cm4.bin', loadAddress: 0x08100000 }] } };
    if (url === '/api/debug/flash') return { data: { programmed: true, message: '双核固件烧录完成' } };
    if (url === '/api/debug/probe') return { data: { probes: [{ serialNumber: 123 }] } };
    if (url === '/api/debug/connect') { connected = true; return { data: { connected: true } }; }
    if (url === '/api/debug/status') return { data: { connected, identity: { verified: false, message: '固件身份不匹配' } } };
    assert.fail(`Unexpected request: ${url}`);
  });
  await client.action('inspect'); notices.length = 0;
  await client.action('generate');
  client.state.job.status = 'built';
  client.state.job.manifest = { template:'abd-modular-v1',firmwareReady:true };
  await client.action('probe');
  await client.action('flash'); await client.action('connect');
  assert.equal(client.state.flashResult.jobId, 'generated');
  assert.equal(client.state.flashResult.fingerprint, client.state.job.fingerprint);
  assert.equal(client.state.flashResult.programmed, true);
  assert.deepEqual(notices.map(notice => notice.level), ['success', 'success', 'warning']);
  assert.deepEqual(notices.map(notice => notice.title), ['代码已生成', '烧录完成', '固件身份未核对']);
  assert.ok(notices.every(notice => notice.presentation === undefined));
  assert.deepEqual(errors, []);
});

test('客户端检查通过才发送一次配置 JSON，服务端拒绝也只通知一次，不额外请求检查接口', async t => {
  const project=newModuleProject();project.instances['foc-current'].parameters.bandwidthHz=-1;let supported=true;
  const {client,calls,notices,errors}=clientFixture(t,({url,body})=>{
    assert.equal(url,'/api/v1/build');
    if(supported)return binaryResponse(body);
    return {status:422,data:{fingerprint:configurationFingerprint(body),requestId:randomUUID(),error:{code:'CONFIGURATION_REJECTED',stage:'validation',message:'target incomplete'},issues:[{level:'error',moduleId:'hw-platform',message:'platform incomplete'}]}};
  },()=>project,validateProject);
  await client.action('build');assert.equal(calls.length,0);assert.equal(notices.at(-1).level,'error');
  project.instances['foc-current'].parameters.bandwidthHz=500;await client.action('build');
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
  assert.equal(client.state.delivery.fingerprint,configurationFingerprint(project));assert.equal(notices.at(-1).title,'构建完成');
  supported=false;await client.action('build');
  assert.equal(calls.filter(c=>c.method==='POST').length,2);assert.equal(notices.at(-1).title,'构建检查未通过');
  assert.deepEqual(client.state.inspection.issues,[{level:'error',moduleId:'hw-platform',message:'platform incomplete'}]);
  assert.equal(notices.length,3);assert.equal(notices.at(-1).presentation,'notification');assert.deepEqual(errors,[]);
});

test('构建期间配置改变或切换，晚到的HEX 文件不成为当前结果', async t => {
  let project={id:'one',name:'关节模组',build:{optimization:'O2'}},gate;
  const {client,calls,errors}=clientFixture(t,async({url,body})=>{
    assert.equal(url,'/api/v1/build');await gate.promise;return binaryResponse(body);
  },()=>project);
  for(const change of [()=>{project.build.optimization='O3';},()=>{project={...project,id:'two'};}]){
    gate=deferred();const pending=client.action('build');await new Promise(resolve=>setImmediate(resolve));change();gate.resolve();await pending;
    assert.equal(client.state.inspection.stale,true);assert.equal(client.state.delivery,null);
  }
  assert.equal(calls.filter(c=>c.method==='POST').length,2);assert.equal(errors.length,2);
});

test('检查期间配置修改或切换使晚到的通过结果失效，不触发成功通知', async t => {
  let project = { id: 'one', name: '关节模组', build: { optimization: 'O2' } };
  let gate;
  const { client, calls, notices, errors } = clientFixture(t, async ({ url, body }) => {
    assert.equal(url, '/api/firmware/inspect');
    const inspected = structuredClone(body.project);
    await gate.promise;
    return { data: { supported: true, issues: [], fingerprint: configurationFingerprint(inspected) } };
  }, () => project);
  for (const change of [() => { project.build.optimization = 'O3'; }, () => { project = { ...project, id: 'two' }; }]) {
    gate = deferred();
    const promise = client.action('inspect');
    // Let the API request enter before mutating the current configuration.
    await new Promise(resolve => setImmediate(resolve));
    change(); gate.resolve(); await promise;
    assert.equal(getBuildInspectionState(project, client.state).supported, false);
    assert.equal(client.state.inspection.stale, true);
    assert.equal(notices.at(-1).title, '检查已过期');
  }
  assert.equal(calls.filter(call => call.url === '/api/firmware/build').length, 0);
  assert.equal(notices.some(notice => notice.level === 'success'), false);
  assert.equal(errors.length, 0);
});

test('检查响应必须绑定请求指纹，错误响应或服务会话变化均撤销通过状态', async t => {
  let response = { data: { supported: true, issues: [], fingerprint: 'forged' } };
  const project = { id: 'one', name: '关节模组' };
  const { client, calls, errors } = clientFixture(t, () => response, () => project);
  await client.action('inspect');
  assert.equal(client.state.inspection, null);
  assert.match(errors.at(-1), /不一致/);
  response = { data: { supported: true, issues: [] } }; await client.action('inspect');
  assert.equal(getBuildInspectionState(project, client.state).supported, true);
  response = { status: 403, data: { error: 'session expired' } }; await client.action('build');
  assert.equal(client.state.inspection, null);
  const before = calls.length; await client.action('build');
  assert.equal(calls.length, before + 2);
  assert.equal(calls.some(call=>call.url==='/api/firmware/build'),false);
});

test('等待服务会话时冻结提交快照，后续原对象修改不能改变已发起的检查内容', async t => {
  const session = deferred(), project = { id: 'one', name: '关节模组', build: { optimization: 'O2' } };
  const notices = [], errors = [], requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url === '/api/session') { await session.promise; return { ok: true, json: async () => ({ token: 'token' }) }; }
    const body = JSON.parse(options.body); requests.push(body);
    return { ok: true, json: async () => ({ supported: true, issues: [], fingerprint: configurationFingerprint(body.project) }) };
  });
  const client = createNativeClient({ getProject: () => project, onUpdate: () => {}, onError: message => errors.push(message), onNotice: (message, options) => notices.push(options) });
  t.after(() => { session.resolve(); client.destroy(); });
  const checking = client.action('inspect');
  project.build.optimization = 'O3';
  session.resolve(); await checking;
  assert.equal(requests[0].project.build.optimization, 'O2');
  assert.equal(client.state.inspection.stale, true);
  assert.equal(getBuildInspectionState(project, client.state).supported, false);
  assert.deepEqual(errors, []); assert.equal(notices[0].title, '检查已过期');
});

test('直接调用构建动作也保留正在执行的任务锁，拒绝时不清除busy', async t => {
  const { client, calls, errors } = clientFixture(t, () => assert.fail('不应提交并行构建'));
  client.state.busy = true;
  await client.action('build'); await client.action('generate');
  assert.equal(client.state.busy, true); assert.equal(calls.length, 0); assert.equal(errors.length, 2);
});

test('固件响应的指纹、长度、格式和哈希必须通过校验，错误包不提供下载', async t => {
  const project={id:'one',name:'关节模组'};let changes;
  const {client,errors,notices}=clientFixture(t,()=>binaryResponse(project,changes),()=>project);
  for(const headers of [
    {'X-Configuration-Fingerprint':'other'}, {'X-Firmware-SHA256':'0'.repeat(64)},
    {'Content-Length':'1000'}, {'Content-Type':'text/html'}, {'X-Build-Id':'../../private'},
  ]){changes=headers;await client.action('build');assert.equal(client.state.delivery,null);}
  assert.equal(errors.length,5);assert.equal(notices.length,0);
});

test('固件下载对象在替换和关闭时释放，成功通知不依赖开发者 jobs 接口', async t => {
  const project={id:'one',name:'关节模组'};
  const release=t.mock.method(URL,'revokeObjectURL');
  const {client,calls,errors,notices}=clientFixture(t,({url,body})=>{assert.equal(url,'/api/v1/build');return binaryResponse(body);},()=>project);
  await client.action('build');const first=client.state.delivery.url;
  assert.match(await client.state.delivery.blob.text(),/:00000001FF/);
  await client.action('build');const second=client.state.delivery.url;
  assert.notEqual(first,second);assert.equal(release.mock.calls[0].arguments[0],first);
  client.destroy();assert.equal(release.mock.calls[1].arguments[0],second);
  assert.equal(notices.filter(n=>n.title==='构建完成').length,2);assert.deepEqual(errors,[]);
  assert.equal(calls.filter(c=>c.url.startsWith('/api/jobs')).length,0);
});

test('烧录动作在发送请求前检查当前配置、双核产物、探针及忙状态，不自动停采或扫描', async t => {
  const project = { id: 'one', name: '关节模组', build: { optimization: 'O2' } };
  const { client, calls, errors } = clientFixture(t, () => assert.fail('门控失败不应访问设备'), () => project);
  const ready = () => ({
    job: { id: 'built', status: 'built', manifest:{template:'abd-modular-v1',firmwareReady:true}, fingerprint: configurationFingerprint(project), artifacts: [{ core: 'cm7', kind: 'bin', path: '/generated/cm7.bin', loadAddress: 0x08000000 }, { core: 'cm4', kind: 'bin', path: '/generated/cm4.bin', loadAddress: 0x08100000 }] },
    probes: [{ serialNumber: 123 }], serialNumber: '123', speedKHz: 4000, debug: { connected: false }, capturing: false, busy: false,
  });
  for (const alter of [
    state => { state.job = null; },
    state => { state.job.status = 'generated'; },
    state => { state.job.fingerprint = 'older-config'; },
    state => { state.job.artifacts.pop(); },
    state => { state.probes = []; },
    state => { state.serialNumber = '999'; },
    state => { state.debug.connected = true; },
    state => { state.capturing = true; },
    state => { state.busy = true; },
    state => { state.speedKHz = 0; },
  ]) {
    Object.assign(client.state, ready()); alter(client.state);
    const wasCapturing = client.state.capturing, wasBusy = client.state.busy;
    await client.action('flash');
    assert.equal(client.state.capturing, wasCapturing); assert.equal(client.state.busy, wasBusy);
  }
  assert.equal(errors.length, 10); assert.deepEqual(calls, []);
});
