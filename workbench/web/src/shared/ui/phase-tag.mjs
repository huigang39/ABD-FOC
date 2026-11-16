import { esc } from '../esc.mjs';
const phases = {
  compile: ['编译期', '修改后需要重新生成并编译固件，烧录后生效。'],
  init: ['运行期', '上电初始化时加载，修改后需重新上电生效。'],
  runtime: ['运行期', '允许运行中调整，由控制任务在规定的周期边界应用。'],
};
export function phaseTag(phase) {
  const item=phases[phase];
  if(!item)return '';
  const help=item[1]+' 当前标签描述参数设计约定，设备端的修改限制与生效机制尚未接入。';
  return `<button type="button" class="phase-tag" data-phase="${phase}" data-help="${esc(help)}" aria-label="${item[0]}说明">${item[0]}</button>`;
}
