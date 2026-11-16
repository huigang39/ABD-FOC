import { readNumericInput } from '../../shared/forms/numeric-input.mjs';
import { configurationFingerprint } from '../../core/contracts.mjs';
import { validateProject } from '../../core/model.mjs';
import { getBuildInspectionState } from '../build/gate.mjs';
import { readBuildResponse } from '../build/transport.mjs';
import { getFirmwareFlashState, isFirmwareImage } from './flash-state.mjs';

export function createNativeClient({ getProject, onUpdate, onError, onNotice = () => {}, validateConfiguration = validateProject }) {
  const state = { available: false, busy: false, pendingAction: '', profileVariant: 'KW', error: '', jobs: [], job: null, delivery: null, inspection: null, debug: { connected: false }, probes: [], serialNumber: '', speedKHz: 4000, divider: 20, channels: [], series: [], capturing: false, captureMeta: null };
  let token = '', pollTimer, captureTimer, pending = false, alive = true, flashSequence = 0, buildAbort;
  const watchedJobs = new Set(), notifiedJobs = new Set();
  const update = full => onUpdate(full);
  // Bench measurements are project records, not firmware inputs.
  const buildProject = () => { const { performance, ...configuration } = getProject(); return structuredClone(configuration); };
  const reportInspection = (previous = false) => {
    const result = state.inspection; if (!result) return;
    const supported = result.supported === true && !result.stale && !result.issues?.some(issue => issue.level === 'error');
    const message = previous ? '以下为上次构建检查结果。重新构建时会检查最新配置。' : supported ? '当前配置满足构建条件。' : '请处理检查项后重新构建。';
    onNotice(message, { level: result.issues?.some(issue=>issue.level==='error') ? 'error' : supported ? (result.issues?.length ? 'info' : 'success') : 'warning', title: supported ? '构建检查通过' : '构建检查未通过', issues: result.issues || [], presentation: previous ? 'dialog' : 'notification' });
  };
  const announceJob = job => {
    if (!watchedJobs.has(job.id) || notifiedJobs.has(job.id) || !['built', 'generated', 'failed'].includes(job.status)) return;
    notifiedJobs.add(job.id);
    if (job.status === 'failed') onError(job.error || '构建未完成，请查看构建日志。');
    else onNotice(job.status === 'built' ? '固件编译完成，可查看产物或进入调试。' : '模块源码已生成，可查看输入、输出、状态和参数。完整固件的适配情况见构建检查结果。', { level: 'success', title: job.status === 'built' ? '编译完成' : '代码已生成' });
  };
  async function request(path, data, { binary = false, fingerprint, signal } = {}) {
    if (!token) {
      const response = await fetch('/api/session', { signal });
      if (!response.ok) throw new Error('本地构建服务未启动，请重启工作台服务。');
      const session = await response.json(); token = session.token;
    }
    const response = await fetch(`/api${path}`, data === undefined ? { signal } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': token }, body: JSON.stringify(data), signal });
    if (response.status === 401 || response.status === 403) { token = ''; state.inspection = null; }
    if (binary) { const delivery = await readBuildResponse(response, fingerprint); state.available = true; return delivery; }
    const result = await response.json();
    if (!response.ok) { if (response.status === 403) { token = ''; state.inspection = null; } throw new Error(result.error || `本地服务返回 ${response.status}`); }
    state.available = true;
    return result;
  }
  function selectJob(job) {
    state.job = job || null; state.sourcePreview = null; state.series = []; state.captureMeta = null;
    const channels = job?.manifest?.channels || job?.manifest?.trace?.channels || [];
    state.channels = channels.slice(0, 4).map(channel => ({ ...channel, enabled: true }));
    while (state.channels.length < 4) state.channels.push({ name: `通道 ${state.channels.length + 1}`, address: '', type: 'f32', enabled: false });
  }
  async function refresh({ notify = false } = {}) {
    const projectId = getProject().id;
    try {
      const [status, jobs] = await Promise.all([request('/status'), request(`/jobs?projectId=${encodeURIComponent(getProject().id)}`)]);
      if (projectId !== getProject().id) return;
      if (!status.debug?.pending) state.debug = status.debug;
      state.busy = status.busy;
      state.jobs = jobs.jobs.filter(job => !job.manifest || job.manifest.template === 'abd-modular-v1');
      state.error = '';
      const same = state.jobs.find(job => job.id === state.job?.id);
      if (same) { state.job = same; announceJob(same); } else if (!state.debug.connected) selectJob(state.jobs[0]);
      update(true);
      schedulePoll();
    } catch (error) { state.available = false; state.error = error.message; if (notify) onError(error.message); update(true); }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (alive && state.job && ['generating', 'building'].includes(state.job.status)) pollTimer = setTimeout(async () => {
      try {
        const id = state.job.id, job = await request(`/jobs/${id}`);
        if (state.job?.id === id) {
          state.job = job; state.busy = ['generating', 'building'].includes(job.status);
          if (job.status === 'built') selectJob(job);
          update(['built','generated','failed'].includes(job.status));
          announceJob(job);
        }
      } catch (error) { state.error = error.message; state.busy = false; update(false); if (state.job && watchedJobs.has(state.job.id) && !notifiedJobs.has(state.job.id)) { notifiedJobs.add(state.job.id); onError(error.message); } }
      schedulePoll();
    }, 700);
  }
  async function capture() {
    if (!state.capturing || !alive) return;
    try {
      const packet = await request('/debug/capture');
      state.captureMeta = packet;
      state.series = (packet.channels || []).map(channel => {
        let series = state.series.find(item => item.index === channel.index);
        if (!series || series.generation !== channel.generation || series.address !== channel.address || series.type !== channel.type) series = { ...channel, dropped: 0, samples: [] };
        series.dropped = (series.dropped || 0) + (channel.dropped || 0); series.overwrites = channel.overwrites;
        for (const sample of channel.samples || []) if (Number.isFinite(sample.value) && !series.samples.some(existing => existing.seq === sample.seq)) series.samples.push(sample);
        if (series.samples.length > 2000) series.samples.splice(0, series.samples.length - 2000);
        return series;
      });
      state.error = ''; update(false);
    } catch (error) { state.capturing = false; state.error = error.message; onError(error.message); update(true); }
    if (state.capturing) captureTimer = setTimeout(capture, 200);
  }
  async function action(name, data = {}) {
    if (pending) return;
    if (name === 'flash') {
      const flash = getFirmwareFlashState(getProject(), state);
      if (!flash.ready) { state.error = flash.reason; onError(state.error); update(false); return; }
    }
    if ((name === 'generate' || name === 'build') && state.busy) {
      state.error = '已有构建或设备任务正在执行，请等待完成。';
      onError(state.error); update(false); return;
    }
    pending = true; state.pendingAction = name;
    let showConnectionSettings = false;
    if (typeof document !== 'undefined') document.querySelectorAll('[data-native-menu][open]').forEach(menu => { menu.open = false; });
    update(true);
    try {
      state.error = '';
      if (name === 'refresh') await refresh({ notify: true });
      if (name === 'preview-source') { state.sourcePreview = await request(`/jobs/${state.job.id}/sources/${Number(data.index)}`); update(false); }
      if (name === 'inspect') {
        const configuration = buildProject(), fingerprint = configurationFingerprint(configuration);
        state.inspection = null;
        const inspected = await request('/firmware/inspect', { project: configuration });
        if (!alive) return;
        if (inspected.fingerprint !== fingerprint) throw new Error('检查结果与提交的配置不一致，请重新检查。');
        const stale = inspected.stale === true || configuration.id !== getProject().id || fingerprint !== configurationFingerprint(getProject());
        state.inspection = { ...inspected, fingerprint, projectId: configuration.id, stale, supported: !stale && inspected.supported === true && !inspected.issues?.some(issue => issue.level === 'error') };
        update(true);
        if (stale) onNotice('检查期间配置已变化，请重新检查当前配置。', { level: 'warning', title: '检查已过期' });
        else reportInspection();
      }
      if (name === 'review-inspection') reportInspection(true);
      if (name === 'flash-requirements') onNotice('选择与当前配置匹配、包含完整 M7 与 M4 BIN 的已编译双核固件，停止波形采集并断开调试连接。在烧录步骤中手动扫描并选择 J-Link 探针，再开始烧录。', { title: '烧录条件', presentation: 'dialog' });
      if (name === 'build') {
        if (state.debug.connected) throw new Error('请先断开当前调试连接，再构建新固件。');
        const configuration = buildProject(), fingerprint = configurationFingerprint(configuration);
        const isStale = () => configuration.id !== getProject().id || fingerprint !== configurationFingerprint(getProject());
        const issues = validateConfiguration(configuration);
        state.inspection = { projectId:configuration.id, fingerprint, supported:false, issues, stage:'client' };
        if (issues.some(issue => issue.level === 'error')) { reportInspection(); return; }
        state.busy = true; buildAbort = new AbortController(); update(true);
        try {
          const delivery = await request('/v1/build', configuration, { binary:true, fingerprint, signal:buildAbort.signal });
          if (!alive) return;
          if (isStale()) { state.inspection = {...state.inspection, stale:true}; throw new Error('构建期间配置已变化，返回的 HEX 文件未应用，请重新构建。'); }
          if (state.delivery?.url) URL.revokeObjectURL(state.delivery.url);
          state.delivery = {...delivery, projectId:configuration.id, url:URL.createObjectURL(delivery.blob)};
          state.inspection = {projectId:configuration.id, fingerprint, supported:true, sourceReady:true, issues, stage:'server'};
          onNotice('HEX 文件已接收并通过校验，可直接下载烧录，或在烧录页刷新固件列表。', {level:'success',title:'构建完成',presentation:'notification'});
        } catch (error) {
          if (!alive) return;
          if (error.issues?.length && error.fingerprint === fingerprint) {
            state.inspection = {projectId:configuration.id, fingerprint, supported:false, issues:error.issues, stage:error.stage, requestId:error.requestId, stale:isStale()};
            if (isStale()) onNotice('构建期间配置已变化，返回的是原配置的检查结果。', {level:'warning',title:'检查已过期',presentation:'notification'});
            else reportInspection();
          } else {
            if (/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(error.requestId || '')) error.message += ` 请求编号：${error.requestId}`;
            throw error;
          }
        } finally { state.busy = false; buildAbort = null; }
      }
      if (name === 'generate') {
        const configuration = buildProject();
        if (state.debug.connected) throw new Error('请先断开当前调试连接，再生成或编译新固件。');
        const fingerprint=configurationFingerprint(configuration);
        state.inspection=null;
        const inspected=await request('/firmware/inspect',{project:configuration});
        if(!alive)return;
        const stale=inspected.stale===true||inspected.fingerprint!==fingerprint||configuration.id!==getProject().id||fingerprint!==configurationFingerprint(getProject());
        state.inspection={...inspected,fingerprint,projectId:configuration.id,stale};
        update(true);
        if(stale)throw new Error('检查期间配置已变化，请重新构建当前配置。');
        const checked=getBuildInspectionState(configuration,state);
        if(!checked.sourceReady){reportInspection();return;}
        const job = await request(`/firmware/${name}`, { project: configuration });
        selectJob(job); state.busy = ['generating', 'building'].includes(job.status); state.jobs.unshift(job); watchedJobs.add(job.id); update(true); announceJob(job); schedulePoll();
      }
      if (name === 'probe') {
        const result = await request('/debug/probe', {}); state.probes = result.probes || [];
        if (state.probes.length === 1) state.serialNumber = String(state.probes[0].serialNumber);
        else if (!state.probes.some(probe => String(probe.serialNumber) === state.serialNumber)) state.serialNumber = '';
        if (state.probes.length > 1 && !state.serialNumber) showConnectionSettings = true;
        if (!state.probes.length) { state.error = result.error || '未发现 J-Link，请检查 USB 连接。'; onNotice(state.error, { level: 'warning', title: '未发现探针' }); }
        update(true);
      }
      if (name === 'connect') {
        if (!isFirmwareImage(state.job)) throw new Error('请先构建并选择新架构的固件镜像。');
        // Always enumerate the real USB list before choosing a probe, including after unplug/replug.
        const result = await request('/debug/probe', {}); state.probes = result.probes || [];
        if (state.probes.length === 1) state.serialNumber = String(state.probes[0].serialNumber);
        else if (!state.probes.some(probe => String(probe.serialNumber) === state.serialNumber)) state.serialNumber = '';
        if (!state.probes.length) throw Object.assign(new Error(result.error || '未发现 J-Link，请检查 USB 连接。'), { level: 'warning', title: '未发现探针' });
        if (!state.serialNumber) { showConnectionSettings = true; throw Object.assign(new Error('发现多个 J-Link，请在连接设置中选择本次使用的序列号。'), { level: 'warning', title: '选择探针' }); }
        await request('/debug/connect', { jobId: state.job.id, serialNumber: state.serialNumber, speedKHz: state.speedKHz });
        state.debug = await request('/debug/status'); update(true);
        if (state.debug.identity?.verified !== true) onNotice(state.debug.identity?.message || '设备固件身份尚未核对，暂不能配置波形采集。', { level: 'warning', title: '固件身份未核对' });
      }
      if (name === 'disconnect') { state.capturing = false; clearTimeout(captureTimer); await request('/debug/disconnect', {}); state.debug = await request('/debug/status'); update(true); }
      if (name === 'capture') {
        const channels = state.channels.filter(channel => channel.enabled).map(({ name, address, type }) => ({ name, address: typeof address === 'number' ? address : Number(address), type }));
        if (!channels.length) throw new Error('请至少选择一个采集变量。');
        if (channels.some(channel => !Number.isSafeInteger(channel.address) || channel.address <= 0)) throw new Error('采集变量需要有效的 RAM 地址。');
        await request('/debug/configure', { channels, divider: state.divider });
        state.series = []; state.capturing = true; update(true); capture();
      }
      if (name === 'stop-capture') { state.capturing = false; clearTimeout(captureTimer); await request('/debug/configure', { channels: [], divider: state.divider }); update(true); }
      if (name === 'flash') {
        const selectedJob = state.job;
        clearTimeout(captureTimer);
        state.busy = true; update(true);
        const result = await request('/debug/flash', { jobId: selectedJob.id, serialNumber: state.serialNumber, speedKHz: state.speedKHz });
        state.flashResult = { ...result, jobId: selectedJob.id, fingerprint: selectedJob.fingerprint, logId: ++flashSequence }; state.debug = await request('/debug/status'); state.busy = false; update(true);
        onNotice(result.message || '双核固件已烧录，设备保持停止。', { level: 'success', title: '烧录完成' });
      }
      if (name === 'export-csv') {
        const rows = ['channel,sequence,value'];
        for (const channel of state.series) for (const sample of channel.samples) rows.push(`"${String(channel.name).replaceAll('"', '""')}",${sample.seq},${sample.value}`);
        const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'neo75h-waveform.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { state.error = error.message; state.busy = false; if (error.level) onNotice(error.message, { level: error.level, title: error.title }); else onError(error.message); update(false); }
    finally {
      pending = false; state.pendingAction = ''; update(true);
      if (showConnectionSettings && typeof document !== 'undefined') {
        const settings = document.querySelector('[data-state-key="native-connection-settings"]');
        if (settings) { settings.open = true; settings.querySelector('[data-native-field="serialNumber"]')?.focus({ preventScroll: true }); }
      }
    }
  }
  function edit(input) {
    const { nativeField: field, channel: channelIndex } = input.dataset;
    if (field === 'profileVariant') { if (['KW', 'LD', 'SMH', 'XH'].includes(input.value)) state.profileVariant = input.value; update(true); return; }
    if (field === 'jobId') { if (!state.debug.connected) selectJob(state.jobs.find(job => job.id === input.value)); update(true); return; }
    if (channelIndex !== undefined) {
      const channel = state.channels[Number(channelIndex)]; if (!channel) return;
      if (field === 'variable') {
        const choices = state.job?.manifest?.channels || state.job?.manifest?.trace?.channels || [];
        const choice = choices[Number(input.value)]; if (choice) Object.assign(channel, choice, { enabled: true });
        update(true); return;
      }
      channel[field] = field === 'enabled' ? input.checked : input.value;
    } else if (['speedKHz', 'divider'].includes(field)) state[field] = readNumericInput(input);
    else if (field === 'serialNumber') state.serialNumber = input.value;
  }
  function draw(root) {
    const canvas = root.querySelector('[data-waveform]'); if (!canvas) return;
    const box = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, box.width * ratio); canvas.height = Math.max(1, box.height * ratio);
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.scale(ratio, ratio);
    const w = box.width, h = box.height, colors = ['#15796e', '#4269b4', '#9a703c', '#955b7e'];
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#e0e3dc'; ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) { const y = h * i / 5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    let end = state.series.find(channel => channel.samples.length)?.samples.at(-1).seq;
    for (const channel of state.series) if (channel.samples.length && ((channel.samples.at(-1).seq - end) | 0) > 0) end = channel.samples.at(-1).seq;
    state.series.forEach((channel, index) => {
      const samples = channel.samples.filter(sample => { const offset = (sample.seq - end) | 0; return offset >= -599 && offset <= 0; }); if (samples.length < 2) return;
      const values = samples.map(s => s.value), min = Math.min(...values), max = Math.max(...values), span = max - min || Math.max(1, Math.abs(max) * .1);
      ctx.strokeStyle = colors[(channel.index ?? index) % colors.length]; ctx.lineWidth = 1.6; ctx.beginPath();
      let started = false;
      samples.forEach((sample, i) => { const offset = (sample.seq - end) | 0; if (offset < -599 || offset > 0) return; const x = 8 + (1 + offset / 599) * (w - 16), y = h - 24 - (sample.value - min) / span * (h - 48); if (!started || ((sample.seq - samples[i - 1].seq) >>> 0) !== 1) ctx.moveTo(x, y); else ctx.lineTo(x, y); started = true; });
      ctx.stroke();
    });
  }
  function menuEvent(event, root = globalThis.document) {
    if (!root?.querySelectorAll) return;
    const menus = [...root.querySelectorAll('details[data-native-menu][open]')];
    if (event.type === 'keydown' && event.key === 'Escape' && menus.length) {
      const active = menus.find(menu => menu.contains(event.target)) || menus.at(-1);
      menus.forEach(menu => { menu.open = false; });
      active.querySelector('summary')?.focus({ preventScroll: true }); event.preventDefault(); return;
    }
    if (event.type !== 'click') return;
    const action = event.target?.closest?.('[data-action], [data-native-action], a[href]');
    menus.forEach(menu => { if (!menu.contains(event.target) || (action && !action.disabled)) menu.open = false; });
  }
  return { state, refresh, action, edit, draw, menuEvent, destroy() { alive = false; buildAbort?.abort(); if(state.delivery?.url)URL.revokeObjectURL(state.delivery.url); clearTimeout(pollTimer); clearTimeout(captureTimer); } };
}
