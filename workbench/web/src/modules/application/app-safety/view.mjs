
/** Pure rendering; project state and shared formatting are supplied by the shell. */
export function renderExtras({ project, issues, escape, number, moduleRoute, issueNoticeButton }) {
  return '<div class="module-feature-link"><strong>错误码与故障处理</strong><p>管理故障来源、处置动作、锁存和恢复条件。</p><a class="button small" href="#/project/faults">配置错误码 →</a></div>';
}
