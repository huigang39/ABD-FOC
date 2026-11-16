/** Typed signal identities: unit alone is insufficient to establish compatibility. */
export const SIGNALS = [
 {id:'sensor.motor_angle',label:'电机侧编码器机械角度',quantity:'motor-angle',unit:'rad',module:'hw-drivers',sensorRole:'motor'},
 {id:'sensor.output_angle',label:'出轴侧编码器机械角度',quantity:'output-angle',unit:'rad',module:'hw-drivers',sensorRole:'output'},
 {id:'feedback.angle',label:'已换算的电角度',quantity:'electrical-angle',unit:'rad',module:'foc-feedback',sensorRole:'motor'},
 {id:'feedback.speed',label:'电机侧机械速度',quantity:'motor-speed',unit:'rad/s',module:'foc-feedback',sensorRole:'motor'},
 {id:'load_torque.torque',label:'电机侧扰动转矩',quantity:'motor-disturbance-torque',unit:'N·m',child:'load_torque'},
 {id:'sampling.current',label:'三相采样电流',quantity:'phase-current',unit:'A',module:'hw-board'},
 {id:'encoder_tracking_motor.angle',label:'跟踪后的电机侧机械角度',quantity:'motor-angle',unit:'rad',child:'encoder_tracking_motor'},
 {id:'encoder_tracking_motor.speed',label:'跟踪后的电机侧机械速度',quantity:'motor-speed',unit:'rad/s',child:'encoder_tracking_motor'},
 {id:'encoder_tracking_output.angle',label:'跟踪后的出轴侧机械角度',quantity:'output-angle',unit:'rad',child:'encoder_tracking_output'},
 {id:'encoder_tracking_output.speed',label:'跟踪后的出轴侧机械速度',quantity:'output-speed',unit:'rad/s',child:'encoder_tracking_output'},
 {id:'smo.angle',label:'滑模估算电角度',quantity:'electrical-angle',unit:'rad',child:'smo'},
 {id:'smo.speed',label:'滑模速度（按转子极对数换算）',quantity:'motor-speed',unit:'rad/s',child:'smo'},
 {id:'flux.angle',label:'磁链估算电角度',quantity:'electrical-angle',unit:'rad',child:'flux'},
 {id:'flux.speed',label:'磁链速度（按转子极对数换算）',quantity:'motor-speed',unit:'rad/s',child:'flux'},
 {id:'angle_fusion.angle',label:'融合电角度',quantity:'electrical-angle',unit:'rad',child:'angle_fusion'},
 {id:'speed_fusion.speed',label:'融合机械速度',quantity:'motor-speed',unit:'rad/s',child:'speed_fusion'},
];
export const CHILD_DESIGNS = {
 encoder_tracking_motor:{group:'角度跟踪',quantities:['motor-angle'],sourceIds:['sensor.motor_angle'],input:'电机侧编码器的单圈机械角度、采样时间与有效标志',output:'同一参考下的电机侧跟踪角度和角速度；不隐式乘除极对数',state:'跟踪角度、速度与上一采样状态',use:'只跟踪电机侧编码器的单圈机械角度，按 2π 处理回绕；单圈输入不能凭空建立多圈绝对参考。用于换相前须经过明确的电角度换算。',defaults:{source:'sensor.motor_angle'},formula:String.raw`$\hat\omega=K_p e_\theta+z$，$\dot z=K_i e_\theta$`},
 encoder_tracking_output:{group:'角度跟踪',quantities:['output-angle'],sourceIds:['sensor.output_angle'],input:'出轴侧编码器的单圈机械角度、采样时间与有效标志',output:'同一参考下的出轴侧跟踪角度和角速度；不隐式乘除减速比',state:'跟踪角度、速度与上一采样状态',use:'只跟踪出轴侧编码器的单圈机械角度，按 2π 处理回绕。本链路可以关闭；关闭后出轴位置与速度由电机侧跟踪结果经减速比估算，估算需结合减速机速比、方向与标零记录核对，不能替代真实出轴反馈。',defaults:{source:'sensor.output_angle'},formula:String.raw`$\hat\omega=K_p e_\theta+z$，$\dot z=K_i e_\theta$`},
 smo:{group:'电角度与速度',stages:['电流 / 已生效电压','反电动势估算','转子相位提取','角度 / 速度'],input:'本周期电流、对应采样区间的已生效电压、电机 R/L',output:'反电动势 αβ、电角度、电角速度、机械速度、时间戳与有效标志',state:'电流估计、反电动势与滤波状态',use:'反电动势方向先按旋转方向转换为转子相位，再由 PLL 或反正切提取；需要处理滤波延迟。反电动势不足时无效。',defaults:{}},
 flux:{group:'电角度与速度',stages:['电流 / 已生效电压','转子磁链估算','转子相位提取','角度 / 速度'],input:'本周期电流、对应采样区间的已生效电压、电机 R/L',output:'转子磁链 αβ、电角度、电角速度、机械速度、时间戳与有效标志',state:'磁链积分、漂移修正状态',use:'先分离转子磁链，再提取角度；定子磁链方向不是转子方向。低速性能取决于模型、偏置与漂移处理。',defaults:{}},
 load_torque:{group:'机械状态',quantity:'motor-speed',input:'电机侧机械速度、实际电流对应的电磁转矩、等效惯量',output:'电机侧估计扰动转矩、时间戳与有效标志',state:'速度滤波、转矩估计状态',use:'用于诊断或后续策略；包含负载、摩擦与模型误差，不等同力矩传感器读数，不自动加入给定',defaults:{source:'feedback.speed'},formula:String.raw`$\hat T_d\approx T_e-J\dot\omega_m$`},
 angle_fusion:{group:'选择与融合',quantity:'electrical-angle',input:'同一采样时刻、同一方向及零位的两个电角度与有效标志',output:'融合电角度、来源与有效标志',state:'上一有效角度、过渡状态',use:'加权时两路均须有效，按最短圆弧融合；主备模式仅在备用有效时切换。两路都失效则输出无效，不能冻结旧角度继续驱动',defaults:{source:'feedback.angle',secondary:'smo.angle',method:'weighted'}},
 speed_fusion:{group:'选择与融合',quantity:'motor-speed',input:'同一采样时刻的两路电机侧机械速度与有效标志',output:'融合机械速度、来源与有效标志',state:'滤波、切换过渡状态',use:'仅融合电机侧机械速度。加权时两路均须有效；主备模式两路都失效则输出无效。速度来源可独立选择，但不用于恢复机械位置',defaults:{source:'feedback.speed',secondary:'encoder_tracking_motor.speed',method:'weighted'}},
 friction:{group:'转矩补偿',quantity:'motor-speed',input:'电机侧机械速度、摩擦辨识参数',output:'受限电机侧补偿转矩与有效标志',state:'过零平滑与限幅状态',use:'叠加到电机侧转矩给定，合成后总限幅，再换算 Iq',defaults:{source:'feedback.speed'},formula:String.raw`$T_f=T_c\tanh(\omega_m/\omega_s)+B\omega_m$`},
 angle_delay:{group:'角度补偿',quantity:'electrical-angle',input:'电角度、电角速度、已知采样延迟',output:'预测到控制时刻的电角度与有效标志',state:'角度时间戳、预测状态',use:'角度反馈进入 Park 变换前；零位由编码器校准处理，再做延迟预测',defaults:{source:'feedback.angle'},formula:String.raw`$\theta_c=\operatorname{wrap}(\theta+\omega_e\Delta t)$`},
 current_calibration:{group:'电流补偿',quantity:'phase-current',input:'无相电流条件下的 ADC 电流采样、采样间隔、采集时长与 PWM 设置',output:'自动测得的三相零偏、有效样本数、测量状态；运行时输出去零偏电流',state:'采样累加值、样本计数、等待计时与测量结果',use:'开启每次使能前采集时，在使能请求上升沿进入采集流程，每次使能只采集一次，成功后才放行正常驱动输出；失败或取消保持输出关闭。先等待采样链路稳定，再按间隔采集并求均值。PWM 开启时三相使用同一占空比；必须由硬件适配确认无相电流且采样有效，禁止注入转矩。结果有效后才用于 Clarke 变换前的电流修正，失败不覆盖原结果。',defaults:{source:'sampling.current'},formula:String.raw`$b_k=\frac{1}{N}\sum_{n=1}^{N}i_k[n]$，$i_{c,k}=i_k-b_k$`},
};
export const OBSERVER_OUTPUTS = [
 ['angleOutput','发布电角度','electrical-angle'],
 ['speedOutput','发布电机侧机械速度','motor-speed'],
 ['motorAngleOutput','发布电机侧机械角度','motor-angle'],
 ['outputAngleOutput','发布出轴侧机械角度','output-angle'],
 ['outputSpeedOutput','发布出轴侧机械速度','output-speed'],
 ['torqueOutput','发布扰动转矩','motor-disturbance-torque'],
];
const TRACKING_DOMAINS = {
 'sensor.motor_angle':{label:'电机侧机械角度',angleField:'motor_angle',speedField:'motor_velocity',speedLabel:'电机侧机械速度',quantity:'motor-angle'},
 'sensor.output_angle':{label:'出轴侧机械角度',angleField:'output_angle',speedField:'output_velocity',speedLabel:'出轴侧机械速度',quantity:'output-angle'},
 'feedback.angle':{label:'电角度',angleField:'electrical_angle',speedField:'electrical_velocity',speedLabel:'电角速度',quantity:'electrical-angle'},
};
export function encoderTrackingDomain(child) {
 return TRACKING_DOMAINS[child?.routing?.source] || TRACKING_DOMAINS['sensor.motor_angle'];
}
export function signalChoices(type,project) {
 const spec=CHILD_DESIGNS[type];
 return SIGNALS.filter(s=>(spec.quantities||[spec.quantity]).includes(s.quantity)&&s.child!==type&&(!spec.sourceIds||spec.sourceIds.includes(s.id))).map(s=>[s.id,s.label]);
}
export function observerOutputOptions(key,project) {
 const spec=OBSERVER_OUTPUTS.find(([id])=>id===key);
 if(!spec)return null;
 return [{value:'none',label:'不发布'},...SIGNALS.filter(s=>s.child&&s.quantity===spec[2]).map(s=>({value:s.id,label:s.label}))];
}
