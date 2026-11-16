import { configurationFingerprint } from '../../core/contracts.mjs';

export const isFirmwareImage = job => job?.status === 'built' && job.manifest?.template === 'abd-modular-v1' && job.manifest?.firmwareReady === true;

/** Selection state only. Device identity and artifact contents are verified by the local service. */
export function getFirmwareFlashState(project, state = {}) {
  const job = state.job || null;
  const built = isFirmwareImage(job);
  const current = built && job.fingerprint === configurationFingerprint(project);
  const artifacts = job?.artifacts || job?.manifest?.artifacts || [];
  const images = ['cm7', 'cm4'].map(core => {
    const candidates = artifacts.filter(item => item.core === core && item.kind === 'bin');
    const artifact = candidates.length === 1 ? candidates[0] : null;
    return { core, artifact, address: artifact?.loadAddress ?? artifact?.address ?? job?.manifest?.flashaddresses?.[core] };
  });
  const complete = images.every(image => image.artifact?.path && Number.isSafeInteger(image.address) && image.address >= 0);
  const probe = (state.probes || []).find(item => String(item.serialNumber) === String(state.serialNumber));
  const speedValid = Number.isSafeInteger(state.speedKHz) && state.speedKHz >= 5 && state.speedKHz <= 50000;
  const locked = !!(state.busy || state.pendingAction || state.debug?.connected || state.capturing);
  const reason = !built ? '请先选择已编译的双核固件。'
    : !current ? '所选固件与当前配置不一致，请重新构建或选择对应固件。'
    : !complete ? '所选固件缺少完整的 M7 / M4 BIN 和烧录地址，请重新构建。'
    : state.capturing ? '请先停止波形采集。'
    : state.debug?.connected ? '请先断开当前调试连接。'
    : state.busy || state.pendingAction ? '本地服务正在处理任务，请等待完成。'
    : !probe ? '请扫描并选择本次使用的 J-Link 探针。'
    : !speedValid ? 'SWD 速度需要是 5 至 50000 kHz 之间的整数。' : '';
  return { job, built, current, images, complete, probe, speedValid, locked, ready: !reason, reason };
}
