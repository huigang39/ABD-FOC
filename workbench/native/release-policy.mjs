/**
 * Server-side policy foundation, not a remote build or encryption service.
 * authenticatedRole/environment must come from trusted server authentication
 * and deployment configuration, never from a submitted project or request body.
 */
export function resolveReleasePolicy({ authenticatedRole, environment = 'production', encryptFirmware } = {}) {
  if (!['developer', 'end-user'].includes(authenticatedRole)) throw policyError('UNAUTHORIZED_ROLE', '发布服务需要已认证的开发者或使用者身份。');
  if (!['development', 'production'].includes(environment)) throw policyError('INVALID_ENVIRONMENT', '发布环境必须是 development 或 production。');
  if (encryptFirmware !== undefined && typeof encryptFirmware !== 'boolean') throw policyError('INVALID_ENCRYPTION_SETTING', '固件加密选项必须是布尔值。');
  const encryptionRequired = environment === 'production' || authenticatedRole === 'end-user';
  if (encryptionRequired && encryptFirmware === false) throw policyError('ENCRYPTION_REQUIRED', '生产发布与使用者交付必须加密，不能关闭固件加密。');
  return Object.freeze({
    encryptFirmware: encryptFirmware ?? encryptionRequired,
    encryptionRequired,
    canDisableEncryption: !encryptionRequired,
  });
}

const policyError = (code, message) => Object.assign(new Error(message), { code });
const buildStatuses = new Set(['queued', 'generating', 'generated', 'building', 'built', 'failed', 'cancelled']);
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;

/**
 * Explicit public allowlist. No local API route uses this DTO yet.
 * No encrypted publisher or device Bootloader is integrated, so no input can
 * create a downloadable package. Raw jobs/manifests/artifacts must stay private.
 */
export function createPublicReleaseDto(release, authorization) {
  const policy = resolveReleasePolicy(authorization);
  if (!release || typeof release.id !== 'string' || !idPattern.test(release.id)) throw policyError('INVALID_RELEASE_ID', '发布标识无效。');
  return {
    id: release.id,
    buildStatus: buildStatuses.has(release.status) ? release.status : 'unknown',
    delivery: {
      ...policy,
      status: 'unavailable',
      reasonCode: policy.encryptFirmware ? 'ENCRYPTION_NOT_IMPLEMENTED' : 'LOCAL_DEVELOPMENT_ONLY',
    },
    package: null,
  };
}
