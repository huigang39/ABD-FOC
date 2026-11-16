import { getCurrentLoopDesign } from './design.mjs';

/** Pure rendering; project state and shared formatting are supplied by the shell. */
export function renderExtras({ project, issues, escape, number, moduleRoute, issueNoticeButton }) {
  {
    const design=getCurrentLoopDesign(project);
    return `<div class="module-feature-link" data-live="current-loop-design"><strong>带宽与电机模型</strong><p>内部按 $\\omega_c = 2\\pi f_c$、$K_p = \\omega_c L$、$K_i = \\omega_c R$ 计算连续 PI 设计值，其中 $f_c$ 为电流环带宽，离散参数由固件按控制周期计算。</p>${design.gains?`<dl class="config-summary">${Object.entries(design.gains).map(([key,value])=>`<div class="config-row"><dt>${key}</dt><dd>${number(value)}</dd></div>`).join('')}</dl>`:issueNoticeButton(issues.filter(issue=>issue.id.startsWith('current-loop-')&&issue.id!=='current-loop-runtime-unverified'),{label:'查看电流环配置检查'})}<a class="button small navigation-action" href="#/equipment">查看执行器参数 →</a></div>`;
  }
}
