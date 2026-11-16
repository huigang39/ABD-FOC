import { SENSOR_ROLES, SENSOR_PARAMS } from './sensors.mjs';

const roleForIssue = issue => {
  const key = issue.paramKey || '';
  const field = SENSOR_PARAMS.find(field => field.key === key);
  return SENSOR_ROLES.find(role => role.id === field?.sensorRole || key === role.capability || key.startsWith(role.prefix))
    || SENSOR_ROLES.find(role => String(issue.id || '').includes(role.prefix));
};

/** Present maintained-preset gaps without asking users to edit removed controls.
 * This does not change raw validation, severity, project data or build eligibility. */
export function driverIssuePresentation(parameters = {}, issues = []) {
  const result = [], groups = new Map();
  for (const issue of issues) {
    if (issue.moduleId !== 'hw-drivers' || issue.level !== 'pending') { result.push(issue); continue; }
    const role = roleForIssue(issue);
    if (!role) { result.push(issue); continue; }
    const key = issue.paramKey || '', modelKey = `${role.prefix}Model`;
    if (key === role.capability) {
      result.push({ ...issue, title: `${role.title} · 型号待选择`, message: '选择器件型号。', paramKey: modelKey });
      continue;
    }
    if (key === `${role.prefix}Bitrate`) {
      result.push({ ...issue, title: `${role.title} · 外设速率待配置`, message: '在外设页配置波特率或时钟频率。', paramKey: `${role.prefix}Resource` });
      continue;
    }
    if ([modelKey, `${role.prefix}Resource`, 'gateDriverEnablePin'].includes(key)) { result.push(issue); continue; }
    const resource = key.startsWith(role.prefix) && /Resource(?:\.|$)/.test(key);
    const category = resource ? 'resource' : 'preset', id = `sensor-${role.prefix}-${category}-pending`;
    const previous = groups.get(id);
    if (previous) { previous.sourceIssueIds.push(issue.id); continue; }
    const model = parameters[modelKey];
    const modelLabel = typeof model === 'string' && model.trim() && model !== 'unselected' ? ` ${model.trim()} ` : '';
    const aggregate = {
      ...issue,
      id,
      title: `${role.title} · ${resource ? '外设关联待确定' : '型号预设待完善'}`,
      message: resource
        ? '当前尚未确定可用的外设关联，请检查外设配置；不会自动猜测器件连接。'
        : `维护的${modelLabel}型号预设仍缺少通信协议或参数适配。`,
      paramKey: modelKey,
      sourceIssueIds: [issue.id],
    };
    groups.set(id, aggregate);
    result.push(aggregate);
  }
  return result;
}
