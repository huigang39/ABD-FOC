import { edit, esc } from '../configuration/view.mjs';
import { isAssemblyComplete } from '../equipment/model.mjs';
import { createOperation } from './model.mjs';

const transportChoices = [['unselected', '待选择'], ['canfd', 'CAN FD'], ['ethercat', 'EtherCAT'], ['ethernet', 'Ethernet']];
const modeChoices = [['disabled', '停用（给定配置）'], ['position', '位置'], ['speed', '速度'], ['torque', '力矩'], ['impedance', '阻抗 / PD']];
const blockedButton = (label, kind = '') => `<button type="button" class="button ${kind}" disabled aria-describedby="operation-service-note">${label}</button>`;

export function renderOperation(project) {
  const operation = project.operation ?? createOperation();
  const assembly = project.catalog?.assemblies?.find(item => item.id === project.catalog.activeAssemblyId && isAssemblyComplete(project.catalog,item));
  const control = (label, key, description = '') => edit(label, operation[key], 'operation', key, { type: 'number', description });
  return `<div class="page-heading"><div><h1>运行</h1><p class="page-description">配置上位机连接与关节模组控制给定。</p></div><span class="status-pill neutral">未连接</span></div>
    <div class="project-grid operation-layout"><div>
      <section class="panel" aria-label="运行连接配置">
        <div class="design-toolbar"><h2>当前关节模组</h2><a href="#/equipment/assemblies">${assembly ? '更换选型 →' : '前往选型 →'}</a></div>
        <p class="design-note">${assembly ? `<strong>${esc(assembly.name || '未命名关节模组')}</strong>` : '尚未选择关节模组。请先从货架选择并应用模组。'}</p>
        <h3>连接配置</h3><div class="design-meta">
          ${edit('通信接口', operation.transport, 'operation', 'transport', { choices: transportChoices, description: '选择计划使用的接口类型。' })}
          ${edit('适配器 / 网卡', operation.adapter, 'operation', 'adapter', { description: '填写本地适配器或网络接口标识；尚未枚举实际设备。' })}
          ${edit('设备地址', operation.address, 'operation', 'address', { description: '地址格式由通信服务与设备协议定义，可暂时留空。' })}
          ${edit('节点标识', operation.nodeId, 'operation', 'nodeId', { type: 'integer', description: '节点含义与有效范围待协议定义，不自动推断总线地址。' })}
          ${control('期望更新周期（ms）', 'periodMs', '仅保存期望周期；当前没有周期发送任务。')}
        </div>
        <p class="design-note" id="operation-service-note">本地通信服务未接入，尚未定义设备控制报文。这里的设置随当前配置保存；连接、使能、发送与停机操作均不可用。</p>
        <div class="design-toolbar">${blockedButton('连接')}${blockedButton('使能')}</div>
      </section>
      <section class="panel" aria-label="控制给定配置"><h2>控制给定</h2>
        <div class="design-meta">
          ${edit('给定模式', operation.mode, 'operation', 'mode', { choices: modeChoices, description: '配置目标模式；不会改变设备当前状态。' })}
          ${control('目标位置（rad）', 'positionRad')}
          ${control('目标速度（rad/s）', 'speedRadS')}
          ${control('目标力矩（Nm）', 'torqueNm')}
          ${control('位置增益 Kp（Nm/rad）', 'kp')}
          ${control('速度增益 Kd（Nm·s/rad）', 'kd')}
        </div>
        <p class="design-note">给定值按关节出轴侧记录。零位、正方向、传动换算、量程和设备支持的控制模式需由协议及实际配置确认；当前数值没有下发。</p>
        <div class="design-toolbar">${blockedButton('发送给定', 'primary')}${blockedButton('停机')}</div>
      </section>
    </div><section class="panel" id="operation-feedback" aria-label="设备反馈">
      <div class="design-toolbar"><h2>设备反馈</h2><span class="status-pill neutral">未连接</span></div>
      <div class="validation-summary">
        <div class="summary-stat">位置 · rad<strong>—</strong><small>未收到反馈</small></div>
        <div class="summary-stat">速度 · rad/s<strong>—</strong><small>未收到反馈</small></div>
        <div class="summary-stat">力矩 · Nm<strong>—</strong><small>未收到反馈</small></div>
      </div>
      <dl class="detail-list"><dt>设备使能状态</dt><dd>未连接</dd><dt>设备当前模式</dt><dd>—</dd><dt>故障状态</dt><dd>—</dd><dt>最近接收时间</dt><dd>—</dd></dl>
      <p class="design-note">尚无设备反馈或运行记录。控制给定与设备实测值分别显示。</p>
    </section></div>`;
}
