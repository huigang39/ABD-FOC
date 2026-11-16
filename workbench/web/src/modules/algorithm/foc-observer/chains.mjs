/** Each position chain owns an estimator and an extractor; PLL is not a BEMF estimator. */
const positive = {min:0, exclusiveMin:true};
const hz = { ...positive, rateLimited:true };
const extraction = [
 ['extraction','提取方式','',{type:'select',defaultValue:'pll',choices:[['pll','PLL 跟踪'],['atan2','反正切 + 速度滤波']],group:'角度与速度提取',description:'PLL 跟踪转子相位并输出速度；反正切先求角度，再对展开后的角度差分并滤波。反电动势须先转换为转子相位，不能直接把向量相位当作转子角度。'}],
 ['pllBandwidthHz','PLL 带宽','Hz',{...hz,group:'角度与速度提取',when:['extraction','pll']}],
 ['speedFilterHz','速度滤波截止频率','Hz',{...hz,group:'角度与速度提取',when:['extraction','atan2']}],
 ['validTimeMs','有效确认时间','ms',{min:0,group:'有效性',description:'输入、向量幅值与跟踪状态持续有效达到此时间后发布有效结果。输入失效立即撤销有效标志，不保持旧值冒充新反馈。'}],
];
export const OBSERVER_CHILDREN = [
 {id:'pll',title:'PLL',repeatable:true,fields:[['bandwidthHz','带宽','Hz',{...hz}]]},
 {id:'encoder_tracking_motor',title:'电机侧编码器跟踪',fields:[
  ['extraction','提取方式','',{type:'select',defaultValue:'pll',choices:[['pll','PLL 跟踪'],['difference','角度差分 + 速度滤波']],group:'角度与速度提取',description:'输入固定为电机侧编码器的单圈机械角度，按 2π 处理回绕；在该机械角度域内跟踪，无需反正切。输出角速度与输入同域；不隐式换算极对数。'}],
  ['pllBandwidthHz','PLL 带宽','Hz',{...hz,group:'角度与速度提取',when:['extraction','pll']}],
  ['speedFilterHz','速度滤波截止频率','Hz',{...hz,group:'角度与速度提取',when:['extraction','difference']}],
 ]},
 {id:'encoder_tracking_output',title:'出轴侧编码器跟踪',fields:[
  ['extraction','提取方式','',{type:'select',defaultValue:'pll',choices:[['pll','PLL 跟踪'],['difference','角度差分 + 速度滤波']],group:'角度与速度提取',description:'输入固定为出轴侧编码器的单圈机械角度，按 2π 处理回绕；在该机械角度域内跟踪，无需反正切。输出角速度与输入同域；不隐式换算减速比。'}],
  ['pllBandwidthHz','PLL 带宽','Hz',{...hz,group:'角度与速度提取',when:['extraction','pll']}],
  ['speedFilterHz','速度滤波截止频率','Hz',{...hz,group:'角度与速度提取',when:['extraction','difference']}],
 ]},
 {id:'smo',title:'滑模观测链路',fields:[
  ['gain','滑模注入幅值','V',{...positive,group:'反电动势估算',description:'按电压注入形式定义滑模项，增益单位为 V；具体离散实现须与此定义一致。'}],
  ['boundary','电流误差边界','A',{...positive,group:'反电动势估算'}],
  ['emfFilterHz','反电动势滤波截止频率','Hz',{...hz,group:'反电动势估算',description:'滤波带来相位延迟，提取转子相位时需要一致的延迟处理。'}],
  ...extraction,
  ['signalFloor','有效反电动势下限','V',{...positive,group:'有效性',description:'反电动势不足时输出无效；不能据此保证零速或低速闭环。阈值需结合电压重构误差和噪声确定。'}],
 ]},
 {id:'flux',title:'磁链观测链路',fields:[
  ['driftCutoffHz','漂移抑制截止频率','Hz',{...hz,group:'转子磁链估算',description:'电压模型积分需抑制偏置漂移；必须从定子磁链中分离电感磁链得到转子方向。凸极电机需适配对应模型，不能把定子磁链角直接用于换相。'}],
  ...extraction,
  ['signalFloor','有效转子磁链下限','Wb',{...positive,group:'有效性',description:'只有转子磁链估计及模型有效时才发布角度；低速时电阻误差、偏置和漂移可能占主导。'}],
 ]},
 {id:'load_torque',title:'扰动转矩观测',fields:[
  ['inertia','电机侧等效惯量','kg·m²',{...positive,group:'机械模型'}],
  ['bandwidthHz','观测带宽','Hz',{...hz,group:'机械模型',description:'基于机械模型估计总扰动，不直接对含噪速度做裸差分。未扣除摩擦与模型误差，不能等同出轴负载转矩。'}],
 ]},
 {id:'angle_fusion',title:'电角度选择与融合',fields:[
  ['weight','主来源权重','',{min:0,max:1,group:'融合',whenRoute:['method','weighted']}],
  ['transitionMs','切换过渡时间','ms',{min:0,group:'融合'}],
  ['maxDisagreementRad','来源角度差上限','rad',{...positive,max:Math.PI,group:'有效性',description:'按最短圆弧计算差值。来源不一致超过限值时撤销融合有效性，禁止把相差半圈的两个方向直接平均。'}],
 ]},
 {id:'speed_fusion',title:'速度选择与融合',fields:[
  ['weight','主来源权重','',{min:0,max:1,group:'融合',whenRoute:['method','weighted']}],
  ['transitionMs','切换过渡时间','ms',{min:0,group:'融合'}],
 ]},
];
export function childParameterVisible(child, field) {
 const [key,,,options] = field;
 if(options?.hidden)return false;
 if(options?.when && child.parameters[options.when[0]]!==options.when[1])return false;
 if(options?.whenRoute && child.routing[options.whenRoute[0]]!==options.whenRoute[1])return false;
 return key!=='pwmDutyPercent'||child.parameters.pwmEnabled;
}
export function childDefaults(type) {
 return Object.fromEntries(type.fields.map(([key,,,options])=>[key,options?.defaultValue??null]));
}
