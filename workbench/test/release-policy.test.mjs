import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReleasePolicy, createPublicReleaseDto } from '../native/release-policy.mjs';

test('仅认证的开发者在开发环境可关闭加密，生产和使用者请求不能降级', () => {
  const development = { authenticatedRole: 'developer', environment: 'development' };
  assert.deepEqual(resolveReleasePolicy(development), { encryptFirmware: false, encryptionRequired: false, canDisableEncryption: true });
  assert.equal(resolveReleasePolicy({ ...development, encryptFirmware: true }).encryptFirmware, true);
  assert.equal(resolveReleasePolicy({ ...development, encryptFirmware: false }).encryptFirmware, false);
  for (const authenticatedRole of ['developer', 'end-user']) for (const environment of ['development', 'production']) {
    if (authenticatedRole === 'developer' && environment === 'development') continue;
    const context = { authenticatedRole, environment };
    assert.deepEqual(resolveReleasePolicy(context), { encryptFirmware: true, encryptionRequired: true, canDisableEncryption: false });
    assert.equal(resolveReleasePolicy({ ...context, encryptFirmware: true }).encryptFirmware, true);
    assert.throws(() => resolveReleasePolicy({ ...context, encryptFirmware: false }), { code: 'ENCRYPTION_REQUIRED' });
  }
  assert.equal(resolveReleasePolicy({ authenticatedRole: 'developer' }).encryptionRequired, true);
});

test('缺少认证身份、未知角色和非布尔开关均被拒绝', () => {
  for (const authenticatedRole of [undefined, null, '', 'admin', 'guest', 'DEVELOPER']) {
    assert.throws(() => resolveReleasePolicy({ authenticatedRole }), { code: 'UNAUTHORIZED_ROLE' });
  }
  assert.throws(() => resolveReleasePolicy({ authenticatedRole: 'developer', environment: 'local' }), { code: 'INVALID_ENVIRONMENT' });
  for (const encryptFirmware of [null, 0, 1, 'false', 'true', {}, []]) {
    assert.throws(() => resolveReleasePolicy({ authenticatedRole: 'developer', environment: 'development', encryptFirmware }), { code: 'INVALID_ENCRYPTION_SETTING' });
  }
});

test('公开 DTO 严格白名单，原始日志、路径、源码、ELF/MAP 和伪造的包信息不会泄露', () => {
  const release = {
    id: 'release-1', status: 'built', root: '/server/private', sourceRoot: '/server/source',
    log: ['private source line'], error: 'private stack trace', generatedFiles: ['secret.c'],
    artifacts: [{ kind: 'elf', path: '/secret/a.elf' }, { kind: 'map', path: '/secret/a.map' }],
    manifest: { sourceFiles: ['private.h'], imageAddress: 0x08000000 },
    package: { encrypted: true, url: '/secret.bin', size: 100 },
    publishedPackage: { encrypted: true, signed: true, downloadUrl: '/fake-release' },
    encryptFirmware: false, authenticatedRole: 'developer', environment: 'development',
  };
  const before = structuredClone(release);
  const dto = createPublicReleaseDto(release, { authenticatedRole: 'end-user' });
  assert.deepEqual(dto, {
    id: 'release-1', buildStatus: 'built',
    delivery: { encryptFirmware: true, encryptionRequired: true, canDisableEncryption: false, status: 'unavailable', reasonCode: 'ENCRYPTION_NOT_IMPLEMENTED' },
    package: null,
  });
  assert.deepEqual(release, before);
  assert.throws(() => createPublicReleaseDto(release), { code: 'UNAUTHORIZED_ROLE' });
  for (const id of ['../private', '/server/internal', '<script>', '', null, 42]) {
    assert.throws(() => createPublicReleaseDto({ ...release, id }, { authenticatedRole: 'end-user' }), { code: 'INVALID_RELEASE_ID' });
  }
  assert.equal(createPublicReleaseDto({ id: 'valid-id', status: 'private error text' }, { authenticatedRole: 'end-user' }).buildStatus, 'unknown');
});

test('尚未实现加密发布时任何策略都不能返回可下载包，开发明文仅用于本地', () => {
  const release = { id: 'release-1', status: 'built', package: { url: '/firmware.bin' } };
  for (const encryptFirmware of [false, true]) {
    const dto = createPublicReleaseDto(release, { authenticatedRole: 'developer', environment: 'development', encryptFirmware });
    assert.equal(dto.package, null);
    assert.equal(dto.delivery.status, 'unavailable');
    assert.equal(dto.delivery.reasonCode, encryptFirmware ? 'ENCRYPTION_NOT_IMPLEMENTED' : 'LOCAL_DEVELOPMENT_ONLY');
  }
});
