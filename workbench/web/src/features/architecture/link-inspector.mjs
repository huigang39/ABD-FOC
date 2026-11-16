import { MODULES } from '../../modules/registry.mjs';
import { resolveFieldReference } from '../../core/interface-defaults.mjs';
import { esc } from '../../shared/esc.mjs';
import { getPhaseHealth } from './phase-health.mjs';
import { getActiveActuator } from '../equipment/model.mjs';

const modules = new Map(MODULES.map(module => [module.id, module]));
const transports = { can: 'CAN', canfd: 'CAN FD', ethernet: 'Ethernet', ethercat: 'EtherCAT', uart: 'RS485', unselected: '未配置' };
const directionLinks = {
  control: ['控制给定', 'app', 'foc', '应用 → 算法'],
  feedback: ['反馈快照', 'foc', 'app', '算法 → 应用'],
  modulation: ['调制提交', 'foc', 'hardware', '算法 → 硬件'],
  sampling: ['同步采样', 'hardware', 'foc', '硬件 → 算法'],
};
const note = text => `<p class="design-note">${esc(text)}</p>`;
const section = (title, html) => `<section class="home-link-section"><h3>${esc(title)}</h3>${html}</section>`;
const table = (headers, rows) => `<div class="contract-table-wrap"><table class="contract-table home-link-table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const configLink = (path, label) => `<a class="button small navigation-action" href="${esc(path)}">${esc(label)}</a>`;
const params = (project, moduleId) => project.instances?.[moduleId]?.parameters || {};
const structures = project => project.design?.structures || [];
const fieldType = field => `${field.type || '未定义'}${Number(field.count) > 1 ? `[${field.count}]` : ''}`;
const moduleName = id => modules.get(id)?.title || id || '未指定模块';
const isEnabled = (project, id) => project.instances?.[id]?.enabled !== false && project.instances?.[id]?.runtimeEnabled !== false;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

function endpoint(project, link, side) {
  const moduleId = side === 'source' ? link.fromModule : link.toModule;
  const role = side === 'source' ? 'output' : 'input';
  // Follow the module's currently bound contract, as the interface editor does.
  const id = project.design?.moduleContracts?.[moduleId]?.[role] || link[`${side}Structure`];
  return structures(project).find(structure => structure.id === id);
}

function fieldCell(field, reference) {
  return field ? `<code>${esc(field.name)}</code><small>${esc(fieldType(field))}${field.unit ? ` · ${esc(field.unit)}` : ''}</small>` : `<span class="home-link-missing">未解析字段：${esc(reference || '未选择')}</span>`;
}

function rateText(project, rate) {
  const board = params(project, 'hw-board');
  const tasks = project.design?.schedule?.tasks || [];
  const task = tasks.find(task => task.trigger === (rate === 'fast' ? 'current' : rate));
  let frequency = task?.frequencyHz;
  if (rate === 'fast' && !positive(frequency) && positive(board.pwmHz) && positive(board.currentLoopDivider)) frequency = board.pwmHz / board.currentLoopDivider;
  const label = { fast: '电流环周期', control: '应用控制周期', background: '后台任务', event: '事件触发', unselected: '周期未配置' }[rate] || rate || '周期未配置';
  return `${label}${positive(frequency) ? ` · 配置 ${frequency} Hz` : ''}`;
}

function renderInterface(project, link) {
  const source = endpoint(project, link, 'source'), target = endpoint(project, link, 'target');
  const disabled = [link.fromModule, link.toModule].filter(id => !isEnabled(project, id));
  const handoff = { call: '同周期传递', snapshot: '一致性快照', queue: '消息队列', unselected: '交接方式未配置' }[link.handoff] || link.handoff;
  const rows = (link.fieldMap || []).map(mapping => {
    const from = resolveFieldReference(source, mapping.sourceField), to = resolveFieldReference(target, mapping.targetField);
    return [fieldCell(from, mapping.sourceField), fieldCell(to, mapping.targetField), esc(from?.meaning || to?.meaning || '—')];
  });
  return section(link.name || '数据交接', note(`${moduleName(link.fromModule)} → ${moduleName(link.toModule)} · ${handoff || '交接方式未配置'} · ${rateText(project, link.rate)}`)
    + (disabled.length ? note(`${disabled.map(moduleName).join('、')}未启用，以下为保留配置。`) : '')
    + note(`${source?.name || '输出结构未配置'} → ${target?.name || '输入结构未配置'}`)
    + (rows.length ? table(['来源字段', '目标字段', '含义'], rows) : note('尚未配置字段映射。')));
}

function matchingLinks(project, from, to) {
  return (project.design?.layerInterfaces || []).filter(link => modules.get(link.fromModule)?.layer === from && modules.get(link.toModule)?.layer === to);
}

function resourceTable(resources) {
  if (!resources.length) return note('尚未配置外设资源。');
  return table(['资源', '引脚', '触发 / 速率'], resources.map(resource => [
    `${esc(resource.name || resource.id)}<small>${esc(resource.instance || resource.kind)}</small>`,
    esc(Object.entries(resource.pins || {}).map(([signal, pin]) => `${signal}: ${pin}`).join(' · ') || '未配置'),
    esc([resource.settings?.trigger && `触发 ${resource.settings.trigger}`, positive(resource.settings?.sampleCycles) && `${resource.settings.sampleCycles} cycles`, positive(resource.settings?.bitrate) && `${resource.settings.bitrate} bit/s`].filter(Boolean).join(' · ') || '未配置'),
  ]));
}

function renderSensors(project, key) {
  const labels = { 'current-sampling': '电流采样', 'phase-voltage-sampling': '相电压采样', 'bus-voltage-sampling': '母线电压采样' };
  const fieldName = { 'current-sampling': 'phase_current', 'phase-voltage-sampling': 'phase_voltage', 'bus-voltage-sampling': 'bus_voltage' }[key];
  const board = params(project, 'hw-board');
  const outputId = project.design?.moduleContracts?.['hw-board']?.output;
  const output = structures(project).find(structure => structure.id === outputId);
  const field = output?.fields?.find(field => field.name === fieldName);
  const matches = matchingLinks(project, 'hardware', 'foc').flatMap(link => {
    const source = endpoint(project, link, 'source');
    const fieldMap = (link.fieldMap || []).filter(mapping => {
      const mapped = resolveFieldReference(source, mapping.sourceField);
      return mapped?.name === fieldName || mapped?.name?.startsWith(`${fieldName}[`);
    });
    return fieldMap.length ? [{ ...link, fieldMap }] : [];
  });
  let html = note(`硬件采样 → 算法 · ${rateText(project, 'fast')}`);
  if (field) html += table(['输出字段', '含义'], [[fieldCell(field), esc(field.meaning || '—')]]);
  else html += note(`当前硬件输出结构未定义${labels[key]}字段，尚无可显示的数据映射。`);
  html += matches.map(link => renderInterface(project, link)).join('');
  if (field && !matches.length) html += note('当前输出字段尚未映射到算法输入。');
  html += section('ADC 配置', resourceTable((board.resources || []).filter(resource => resource.kind === 'adc')));
  html += note('以上为工程配置，未取得实时采样值。') + configLink('#/parameters/hardware?module=hw-board', '外设配置');
  return { title: labels[key], html };
}

function renderTransport(project, key) {
  const protocol = project.design?.protocol || {}, configured = protocol.transport || 'unselected';
  const matches = configured === key || (key === 'can' && configured === 'canfd');
  let html = note(`查看链路：${transports[key]} · 工程协议：${transports[configured] || configured}`);
  if (!matches) html += note('当前工程未使用此链路。以下为当前工程协议配置。');
  if (!isEnabled(project, 'app-comms')) html += note('应用通信模块未启用。');
  const meta = [positive(protocol.bitrate) && `${protocol.bitrate} bit/s`, protocol.nodeId != null && `节点 ${protocol.nodeId}`, positive(protocol.timeoutMs) && `超时 ${protocol.timeoutMs} ms`].filter(Boolean);
  if (meta.length) html += note(meta.join(' · '));
  const messages = protocol.messages || [];
  html += messages.length ? messages.map(message => {
    const payload = structures(project).find(structure => structure.id === message.payload);
    const direction = { command: '上位机 → 应用通信', telemetry: '应用通信 → 上位机', response: '应用通信 → 上位机' }[message.direction] || '方向未配置';
    const opcode = Number.isInteger(message.opcode) ? ` · 消息 0x${message.opcode.toString(16).toUpperCase()}` : '';
    const timing = positive(message.periodMs) ? ` · 配置周期 ${message.periodMs} ms` : ' · 事件触发';
    return section(message.name || '未命名消息', note(`${direction}${opcode}${timing}`) + (payload ? table(['载荷字段', '含义'], (payload.fields || []).map(field => [fieldCell(field), esc(field.meaning || '—')])) : note('载荷结构未配置。')));
  }).join('') : note('尚未定义通信消息。');
  html += note('当前显示协议定义，未取得在线报文。') + configLink('#/project/protocol', '协议配置');
  return { title: `${transports[key]} 数据`, html };
}

function renderDebug(context) {
  const native = context.nativeState || {}, capture = native.debug?.capture;
  const applied = capture?.configured === true;
  const channels = applied ? capture.channels || [] : (native.channels || []).filter(channel => channel.enabled);
  let html = note(`调试器 ↔ MCU · ${native.debug?.connected ? '已连接' : '未连接'}`);
  html += note(applied ? '以下为已应用的采样通道。' : '以下为待应用的采样通道配置。');
  html += channels.length ? table(['采样通道', '类型', '地址'], channels.map(channel => [esc(channel.name), esc(channel.type), esc(typeof channel.address === 'number' ? `0x${channel.address.toString(16).toUpperCase()}` : channel.address || '未配置')])) : note('尚未配置采样通道。');
  const hz = native.captureMeta?.nominalSampleHz;
  if (positive(hz)) html += note(`配置采样频率 ${hz} Hz；实际有效采样率尚未确认。`);
  html += note('采样帧包含序号、原始字和解码值；此处不展示实时数值。') + configLink('#/debug', '打开调试器');
  return { title: 'J-Link 采样', html };
}

function renderEncoderConfig(project) {
  const drivers = params(project, 'hw-drivers');
  const rows = [['电机编码器', 'motorEncoder', 'encoderCapability'], ['出轴编码器', 'outputEncoder', 'outputEncoderCapability']].map(([label, prefix, capability]) => {
    const state = { present: '已配置', absent: '未安装', unconfirmed: '待确认' }[drivers[capability]] || '待确认';
    const frequency = drivers[`${prefix}RateHz`];
    return [esc(label), esc(state), esc(drivers[`${prefix}Resource`] || '未配置'), esc(drivers[capability] === 'present' && positive(frequency) ? `${frequency} Hz` : '—')];
  });
  return section('编码器配置', table(['反馈源', '状态', '外设', '配置读取频率'], rows)) + configLink('#/parameters/hardware?module=hw-drivers', '驱动配置');
}

function renderPower(project, phase, context) {
  const health = getPhaseHealth(project, phase, context.phaseDiagnostics, context.now ?? Date.now());
  const board = params(project, 'hw-board');
  const outputId = project.design?.moduleContracts?.['hw-board']?.output;
  const output = structures(project).find(structure => structure.id === outputId);
  const phaseIndex = ['U', 'V', 'W'].indexOf(phase);
  const phaseField = name => {
    const field = output?.fields?.find(field => field.name === name);
    return field ? resolveFieldReference(output, `${field.id}[${phaseIndex}]`) : null;
  };
  const current = phaseField('phase_current'), voltage = phaseField('phase_voltage');
  let html = note(`功率级 → 电机 ${phase} 相`);
  html += `<p class="home-link-health ${esc(health.state)}"><strong>${esc(health.label)}</strong> ${esc(health.message)}</p>`;
  html += section(`${phase} 相电流与电压`, table(['采样量', '契约字段', '说明'], [
    [`${phase} 相电流`, current ? fieldCell(current) : '未配置', esc(current?.meaning || `当前硬件输出结构未定义 ${phase} 相电流采样字段。`)],
    [`${phase} 相电压`, voltage ? fieldCell(voltage) : '未配置', esc(voltage?.meaning || `当前硬件输出结构未定义 ${phase} 相电压采样字段。`)],
  ]));
  html += note('同一相线承载该相电压与电流；以上为采样字段定义，未取得实时数值。');
  html += section('功率输出配置', resourceTable((board.resources || []).filter(resource => resource.kind === 'pwm')));
  const info = [positive(board.pwmHz) && `PWM ${board.pwmHz} Hz`, positive(board.deadtimeNs) && `死区 ${board.deadtimeNs} ns`].filter(Boolean);
  if (info.length) html += note(info.join(' · '));
  html += note('PWM 引脚配置不能证明相线已连接或电流正常。') + configLink('#/parameters/hardware?module=hw-board', '外设配置');
  return { title: `${phase} 相功率线`, html };
}

function renderPowerSupply(project) {
  const board = params(project, 'hw-board');
  let html = note('电源 → 驱动器直流母线');
  html += note(`配置母线电压：${positive(board.busVoltageV) ? `${board.busVoltageV} V` : '未配置'}`);
  if (positive(board.adcBits)) html += note(`ADC 配置精度：${board.adcBits} bit`);
  html += renderSensors(project, 'bus-voltage-sampling').html;
  return { title: '电源与母线采样', html };
}

function renderMechanicalOutput(project, key) {
  const actuator = getActiveActuator(project), reducer = actuator?.reducer || {};
  const ratio = positive(reducer.ratio) && reducer.ratio >= 1 ? reducer.ratio : null;
  const efficiency = positive(reducer.efficiency) && reducer.efficiency <= 1 ? reducer.efficiency : null;
  const pretty = value => String(Number(value.toPrecision(10)));
  const outputContract = structures(project).find(structure => structure.id === project.design?.moduleContracts?.['foc-observer']?.output);
  const angle = outputContract?.fields?.find(field => field.name === 'motor_angle');
  const speed = outputContract?.fields?.find(field => field.name === 'motor_velocity');
  const divisor = ratio === null ? 'N（待配置）' : pretty(ratio);
  const torqueFactor = ratio !== null && efficiency !== null ? pretty(ratio * efficiency) : `${ratio === null ? 'N' : pretty(ratio)} × η`;
  let html = note(key === 'motor-output' ? '电机 → 减速机 · 位置、速度、力矩' : '减速机 → 关节出轴 · 位置、速度、力矩');
  html += note(actuator ? `执行器：${actuator.name || '未命名执行器'}` : '尚未选择执行器。');
  html += table(['机械量', '电机侧输入', '减速机出轴侧输出', '单位'], [
    ['位置', '<code>θ_motor</code>', `<code>Δθ_out = Δθ_motor / ${esc(divisor)}</code>`, esc(angle?.unit || 'rad')],
    ['速度', '<code>ω_motor</code>', `<code>ω_out = ω_motor / ${esc(divisor)}</code>`, esc(speed?.unit || 'rad/s')],
    ['力矩', '<code>τ_motor</code>', `<code>τ_out ≈ τ_motor × ${esc(torqueFactor)}</code>`, 'N·m'],
  ]);
  html += note(`减速比 N：${ratio === null ? '未配置或无效' : pretty(ratio)} · 传动效率 η：${efficiency === null ? '未配置或无效' : `${pretty(efficiency * 100)}%`}`);
  if (efficiency === null) html += note('传动效率未知，不能确定输出力矩系数。');
  html += note('位置按相同方向约定的连续机械位置增量换算，绝对位置还需各自零位。力矩关系适用于电机驱动出轴的传动方向。');
  html += note('以上为机械传递关系，未取得电机或出轴的实时位置、速度、力矩。');
  html += configLink(actuator ? `#/equipment/actuators/${encodeURIComponent(actuator.id)}` : '#/equipment/actuators', '执行器配置');
  return { title: key === 'motor-output' ? '电机输出' : '减速机输出', html };
}

/** Read-only inspector. Project contracts describe configured transfers, never live telemetry. */
export function renderHomeLinkDetails(project, key, context = {}) {
  let result;
  if (directionLinks[key]) {
    const [title, from, to, direction] = directionLinks[key], links = matchingLinks(project, from, to);
    result = { title, html: note(direction) + (links.length ? links.map(link => renderInterface(project, link)).join('') : note('尚未配置此方向的数据映射。')) + note('以上为工程定义，未取得实时传输值。') };
    if (key === 'sampling') result.html += renderEncoderConfig(project);
    else {
      const routes = { control: ['#/parameters/app?module=app-motion', '运动控制配置'], feedback: ['#/parameters/app?module=app-safety', '诊断配置'], modulation: ['#/parameters/foc?module=foc-modulation', '调制配置'] };
      result.html += configLink(...routes[key]);
    }
  } else if (['current-sampling', 'phase-voltage-sampling', 'bus-voltage-sampling'].includes(key)) result = renderSensors(project, key);
  else if (['can', 'ethercat', 'ethernet'].includes(key)) result = renderTransport(project, key);
  else if (key === 'jlink') result = renderDebug(context);
  else if (key === 'motor-output' || key === 'reducer-output') result = renderMechanicalOutput(project, key);
  else if (key === 'power-supply') result = renderPowerSupply(project);
  else if (/^power-[uvw]$/.test(key)) result = renderPower(project, key.at(-1).toUpperCase(), context);
  else result = { title: '链路详情', html: note('此链路尚未配置。') };
  return { ...result, html: `<div class="home-link-details">${result.html}</div>` };
}
