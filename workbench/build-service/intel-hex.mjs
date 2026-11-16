// Intel HEX: https://www.keil.com/support/docs/1584/default.htm
// One address-bearing file can contain both cores without filling the gap.
function record(type, address, data = Buffer.alloc(0)) {
  const bytes = Buffer.from([data.length, address >>> 8, address & 0xff, type, ...data]);
  const checksum = (-bytes.reduce((sum, byte) => sum + byte, 0)) & 0xff;
  return ':' + bytes.toString('hex').toUpperCase() + checksum.toString(16).padStart(2, '0').toUpperCase();
}

export function encodeIntelHex(segments) {
  if (!Array.isArray(segments) || !segments.length) throw new Error('HEX 至少需要一个镜像。');
  const sorted = [...segments].sort((a, b) => a.address - b.address), lines = [];
  let end = 0, upper = -1;
  for (const {address, data} of sorted) {
    if (!Number.isSafeInteger(address) || address < end || !Buffer.isBuffer(data) || !data.length || address + data.length > 0x100000000) throw new Error('HEX 镜像地址无效或发生重叠。');
    end = address + data.length;
    for (let offset = 0; offset < data.length;) {
      const current = address + offset, high = Math.floor(current / 0x10000), low = current % 0x10000;
      if (high !== upper) { lines.push(record(4, 0, Buffer.from([high >>> 8, high & 0xff]))); upper = high; }
      const count = Math.min(16, data.length - offset, 0x10000 - low);
      lines.push(record(0, low, data.subarray(offset, offset + count))); offset += count;
    }
  }
  lines.push(record(1, 0));
  return Buffer.from(lines.join('\r\n') + '\r\n', 'ascii');
}
