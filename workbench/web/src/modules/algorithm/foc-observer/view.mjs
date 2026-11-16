import { encoderTrackingDomain } from '../signals.mjs';
import { esc } from '../../../shared/esc.mjs';
import { fieldHelp } from '../../../shared/ui/field-help.mjs';
import { OBSERVER_CHILDREN } from './chains.mjs';

export function observerStages(type,method='pll',child) {
 const tracking=type?.startsWith('encoder_tracking');
 const extract=method==='pll'?'PLL 跟踪':tracking?'差分与滤波':'反正切与滤波';
 return tracking?[child?encoderTrackingDomain(child)?.label||'编码器机械角度':type==='encoder_tracking_output'?'出轴侧机械角度':'电机侧机械角度',extract,'同域角度与速度']
  :type==='smo'?['电流与已生效电压','反电动势估算',extract,'角度与速度']
  :type==='flux'?['电流与已生效电压','转子磁链估算',extract,'角度与速度']
  :type==='load_torque'?['机械速度与电磁转矩','机械模型','扰动转矩']
  :['同量纲、同坐标的来源',method==='fallback'?'主备选择':'有效性检查与融合','选定结果'];
}
export function renderObserverStages(stages) {
 return `<ol class="observer-stages" aria-label="处理顺序">${stages.map(stage=>`<li>${esc(stage)}</li>`).join('')}</ol>`;
}
export function renderObserverGuide() {
 return `<section class="observer-guide"><div class="design-toolbar"><h3>观测链路</h3>${fieldHelp('电机侧与出轴侧编码器各有一条跟踪链路，先启用需要的链路，再配置提取方式，最后选择发布结果。滑模与磁链依赖电机模型、电流和对应采样区间的已生效电压。启用只产生观测结果，不自动接管控制。','观测器用法')}</div>${renderObserverStages(['输入与模型','状态估算','角度与速度提取','选择或融合'])}<div class="observer-guide-notes"><span class="attribute-tag">电机侧机械量</span><span class="attribute-tag">出轴侧机械量</span><span class="attribute-tag">电气量</span>${fieldHelp('两条编码器跟踪链路的输入固定，均按单圈角度以 2π 处理回绕。出轴链路可以关闭；关闭后出轴位置与速度由电机侧跟踪结果经减速比估算，估算需结合减速机速比、方向与标零记录核对。机械角度换算为电角度需要校准零位、方向和转子极对数；出轴角度不能仅靠减速比直接替代换相角。','坐标与单位')}</div></section>`;
}
export function renderObserverArchitecture() {
 return `${renderObserverGuide()}<div class="observer-architecture-list">${OBSERVER_CHILDREN.map(type=>`<article><strong>${esc(type.title)}</strong>${renderObserverStages(observerStages(type.id))}</article>`).join('')}</div>`;
}
const f=(name,unit,meaning,type='f32',count=1)=>({name,unit,meaning,type,count});
export function observerChainContracts(child) {
 const timing=[f('sample_time_us','μs','测量时间戳','u32'),f('valid','','输入有效标志','bool')];
 const outputTiming=[f('sample_time_us','μs','结果对应的测量时间戳','u32'),f('valid','','本周期结果可用；关闭、失锁或过期时为 false','bool')];
 const positionOutput=[f('electrical_angle','rad','转子电角度'),f('electrical_velocity','rad/s','带方向的电角速度'),f('motor_velocity','rad/s','按转子极对数换算的机械速度'),...outputTiming];
 let input,output,state;
 const tracking=child.type.startsWith('encoder_tracking');
 if(tracking||['smo','flux'].includes(child.type)){
  const domain=encoderTrackingDomain(child);
  input=tracking?[f(domain?.angleField||'angle','rad',(domain?.label||'输入角度')+'；单圈输入，按 2π 处理回绕')]:[f('current_alpha_beta','A','本周期静止坐标电流','f32',2),f('applied_voltage_alpha_beta','V','对应采样区间的已生效电压，非本周期刚算出的指令','f32',2),f('voltage_time_us','μs','已生效电压时间戳','u32')];
  input.push(f('dt','s','派生自电流环控制周期'),...timing);
  output=tracking?[f(domain?.angleField||'angle','rad','跟踪后的'+(domain?.label||'输入角度')+'，保持来源坐标与轴侧'),f(domain?.speedField||'velocity','rad/s',domain?.speedLabel||'同域角速度'),...outputTiming]:[f(child.type==='smo'?'back_emf_alpha_beta':'rotor_flux_alpha_beta',child.type==='smo'?'V':'Wb','估计向量；尚未经过角度提取','f32',2),...positionOutput];
  state=child.parameters.extraction==='pll'?[f('tracked_angle','rad',tracking?'输入角度域内的 PLL 状态；单圈输入按 2π 回绕':'PLL 跟踪电角度'),f('integral_velocity','rad/s','PLL 积分状态')]:[f('previous_angle','rad','上一周期输入角度，按来源约定处理回绕'),f('filtered_velocity','rad/s','差分速度滤波状态')];
  if(child.type==='smo')state.unshift(f('estimated_current','A','滑模电流模型状态','f32',2),f('estimated_back_emf','V','反电动势滤波状态','f32',2));
  if(child.type==='flux')state.unshift(f('stator_flux','Wb','定子磁链积分状态，不能直接作为转子角度','f32',2),f('drift_correction','Wb','漂移抑制状态','f32',2));
 }else if(child.type==='load_torque'){
  input=[f('motor_velocity','rad/s','电机侧机械速度'),f('electromagnetic_torque','N·m','由实际电流及电机模型估计，不用转矩给定代替'),...timing];
  output=[f('disturbance_torque','N·m','包含负载、摩擦与模型误差的电机侧总扰动'),...outputTiming];
  state=[f('estimated_velocity','rad/s','机械模型速度状态'),f('estimated_disturbance','N·m','扰动估计状态')];
 }else{
  const angle=child.type==='angle_fusion',unit=angle?'rad':'rad/s';
  input=[f('values',unit,angle?'同零位同方向的两路电角度':'两路电机侧机械速度','f32',2),f('sample_time_us','μs','两路时间戳，融合前必须对齐','u32',2),f('valid','','两路有效标志','bool',2)];
  output=[f(angle?'electrical_angle':'motor_velocity',unit,'经过选择或融合的结果'),...outputTiming];
  state=[f('active_source','','当前有效来源','u8'),f('transition_elapsed','s','切换过渡时间'),f('previous_value',unit,'过渡状态，不能作为失效后的持续反馈')];
 }
 state.push(f('initialized','','内部状态已初始化','bool'));
 return {input,output,state};
}
export function renderObserverData(children) {
 return `<section class="observer-chain-data"><h3>链路数据约定</h3>${children.map(child=>`<details class="resource-disclosure hardware-resource" data-state-key="observer-data-${esc(child.type)}"><summary><strong>${esc(child.name)}</strong></summary><div class="hardware-resource-body"><div class="observer-data-grid">${Object.entries(observerChainContracts(child)).map(([role,fields])=>`<section><h4>${{input:'输入',output:'输出',state:'状态'}[role]}</h4><ul class="contract-field-preview">${fields.map(field=>`<li><code>${esc(field.name)}</code>${fieldHelp(field.meaning,field.name)}<span class="contract-field-meta">${field.unit?`<span class="contract-data-unit">${esc(field.unit)}</span>`:'<span class="contract-unit-empty"></span>'}<span class="contract-data-type">${field.type}${field.count>1?`[${field.count}]`:''}</span></span></li>`).join('')}</ul></section>`).join('')}</div></div></details>`).join('')}</section>`;
}
