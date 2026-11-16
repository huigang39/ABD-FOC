import { getCia402Design } from './cia402.mjs';

/** Pure rendering; project state and shared formatting are supplied by the shell. */
export function renderExtras({ project, issues, escape, number, moduleRoute, issueNoticeButton }) {
  if(getCia402Design(project).enabled){
    const design=getCia402Design(project);
    return `<div class="module-feature-link"><strong>CiA 402 驱动状态机</strong><p>控制字驱动状态转换，状态字返回实际状态；故障处理和输出许可由驱动内部确认。EtherCAT 通信状态与驱动状态分别管理。</p><div class="cia402-states">${design.states.map(state=>`<span>${escape(state.label)}</span>`).join('')}</div><div class="contract-table-wrap"><table class="contract-table"><thead><tr><th>对象</th><th>名称</th><th>方向</th></tr></thead><tbody>${design.objects.map(item=>`<tr><td>0x${item.index.toString(16).toUpperCase()}</td><td>${item.name}</td><td>${item.direction==='input'?'输入':'输出'}</td></tr>`).join('')}</tbody></table></div><a class="button small navigation-action" href="#/project/protocol">查看应用通信配置 →</a></div>`;
  }
  return '';
}
