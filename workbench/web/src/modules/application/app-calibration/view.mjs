
/** Pure rendering; project state and shared formatting are supplied by the shell. */
export function renderExtras({ project, issues, escape, number, moduleRoute, issueNoticeButton }) {
  return `<div class="module-feature-link"><strong>校准运行许可</strong><p>先选择固件包含的校准项目，再指定运行时允许执行的项目。允许执行不等于开始校准。</p><a class="button small navigation-action" href="${moduleRoute('foc-compensation','config')}">查看摩擦补偿 →</a></div>`;
}
