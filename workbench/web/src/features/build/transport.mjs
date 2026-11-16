/** The public build response contains a HEX download, never build internals. */
export async function readBuildResponse(response, fingerprint) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body.error;
    throw Object.assign(new Error(typeof detail === 'string' ? detail : detail?.message || `构建服务返回 ${response.status}`), {
      status: response.status, code: detail?.code, stage: detail?.stage,
      requestId: body.requestId, fingerprint: body.fingerprint,
      issues: Array.isArray(body.issues) ? body.issues : [],
    });
  }
  const id = response.headers.get('X-Build-Id');
  const sha256 = response.headers.get('X-Firmware-SHA256');
  const length = Number(response.headers.get('Content-Length'));
  if (response.headers.get('X-Configuration-Fingerprint') !== fingerprint) throw new Error('HEX 文件与提交的配置不一致，请重新构建。');
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id || '') || !/^[\da-f]{64}$/.test(sha256 || '')) throw new Error('HEX 文件缺少有效的构建标识或校验值。');
  if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/octet-stream' || response.headers.get('X-Firmware-Format') !== 'intel-hex' || !Number.isSafeInteger(length) || length < 12 || length > 100 * 1024 * 1024) throw new Error('构建服务返回的 HEX 格式不正确。');
  const bytes = await response.arrayBuffer();
  const contents = new TextDecoder().decode(bytes);
  if (bytes.byteLength !== length || !/^(?::[\dA-F]+\r?\n)+$/.test(contents) || !contents.trimEnd().endsWith(':00000001FF')) throw new Error('HEX 文件接收不完整，请重新构建。');
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== sha256) throw new Error('HEX 文件校验失败，请重新构建。');
  return { id, fingerprint, sha256, filename: `firmware-${id}.hex`, size: bytes.byteLength, blob: new Blob([bytes], {type:'application/octet-stream'}) };
}
