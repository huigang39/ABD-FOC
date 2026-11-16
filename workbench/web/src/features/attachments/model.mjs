export const FIRMWARE_KINDS = [['bootloader','引导'],['hardware','硬件'],['algorithm','算法'],['application','应用'],['combined','整合']];
export const RELEASE_TAGS = ['stable','beta','test'];
export function firmwareMetadata(values) {
  const text = key => String(values[key] || '').trim();
  const result = {kind:text('kind'),name:text('name'),version:text('version'),target:text('target'),notes:text('notes')};
  if (!FIRMWARE_KINDS.some(([key])=>key===result.kind)) throw new Error('请选择固件类型。');
  for (const [key,label] of [['name','固件名称'],['version','版本号'],['target','适用型号']]) {
    if (!result[key] || result[key].length > 120) throw new Error(`${label}需要填写，且不能超过 120 个字符。`);
  }
  result.tags = [...new Set(text('tags').split(/[,，\s]+/).filter(Boolean).map(tag=>tag.toLowerCase()))];
  if (result.tags.length > 12 || result.tags.some(tag=>tag.length>32)) throw new Error('最多 12 个标签，每个标签不超过 32 个字符。');
  if (result.notes.length>2000) throw new Error('说明不能超过 2,000 个字符。');
  result.versionKey = JSON.stringify([result.kind,result.name,result.target,result.version]);
  return result;
}
export function validateFirmwareFile(file) {
  if (!file || !file.size) throw new Error('请选择非空固件文件。');
  if (!/\.(hex|bin|elf|enc)$/i.test(file.name)) throw new Error('支持 HEX、BIN、ELF 和 ENC 文件。');
  if (file.size > 32*1024*1024) throw new Error('单个固件文件不能超过 32 MiB。');
}
export function filterFirmware(records,{kind='',tag=''}={}) {
  return records.filter(record=>(!kind||record.kind===kind)&&(!tag||record.tags.includes(tag))).sort((a,b)=>b.createdAt-a.createdAt);
}
