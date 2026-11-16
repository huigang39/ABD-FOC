
/** Pure rendering; project state and shared formatting are supplied by the shell. */
export function renderExtras({ project, issues, escape, number, moduleRoute, issueNoticeButton }) {
  return `<div class="module-feature-link"><strong>摩擦补偿数据</strong><p>补偿使用电机侧的摩擦模型参数，摩擦辨识在校准流程中执行。</p><a class="button small" href="${moduleRoute('app-calibration','config')}">配置摩擦辨识 →</a></div>`;
}
