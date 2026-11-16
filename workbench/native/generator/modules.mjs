import { schedulerTasks, validateSchedule } from '../../web/src/features/configuration/schedule.mjs';
import {getActiveActuator} from '../../web/src/features/equipment/model.mjs';
const at=(p,id,key)=>p.instances[id].parameters[key];
const positive=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<=0||!Number.isFinite(Math.fround(value)))throw Error(`${label}必须为已配置的正数。`);return value;};
const bounded=(value,label,low,high)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<low||value>high)throw Error(`${label}必须在 ${low}–${high} 范围内。`);return value;};
export const MODULE_CODE = {
  'hw-platform':{name:'core',base:'Core'},
  'hw-board':{name:'peripherals',base:'Peripherals'},
  'hw-sensors':{name:'drivers',base:'Drivers'},
  'hw-safety':{name:'protection',base:'Protection'},
  'foc-lifecycle':{name:'control',base:'Control',values:p=>{if(at(p,'foc-lifecycle','protectionPaths')?.some(path=>path.compiled))throw Error('自定义算法保护路径尚未接入生成器。');return {};}},
  'foc-feedback':{name:'feedback',base:'Feedback',config:'float pole_pairs, ratio; bool use_output_encoder;',values:p=>{
    const a=getActiveActuator(p);if(at(p,'foc-feedback','angleSource')!=='encoder')throw Error('当前反馈实现需要编码器角度；观测器与强拖角度交接尚未接入。');
    return {pole_pairs:positive(a?.motor.polePairs,'电机极对数'),ratio:positive(a?.reducer.ratio,'减速比'),use_output_encoder:at(p,'app-motion','positionFeedback')==='output_encoder'};
  }},
  'foc-current':{name:'current',base:'Current',config:'float kp[2], ki, max_current; uint32_t reference_timeout_us;',values:p=>{
    const a=getActiveActuator(p),omega=2*Math.PI*positive(at(p,'foc-current','bandwidthHz'),'电流环带宽');
    if(at(p,'foc-current','decoupling'))throw Error('电流交叉耦合补偿尚未接入新实现。');
    return {kp:[omega*positive(a?.motor.inductanceDH,'d 轴电感'),omega*positive(a?.motor.inductanceQH,'q 轴电感')],ki:omega*positive(a?.motor.resistanceOhm,'相电阻'),max_current:positive(at(p,'foc-lifecycle','maxCurrentA'),'电流保护边界'),reference_timeout_us:positive(at(p,'foc-lifecycle','referenceTimeoutMs'),'给定有效期')*1000};
  }},
  'foc-modulation':{name:'modulation',base:'Modulation',config:'float duty_min, duty_max; bool svpwm;',values:p=>{
    const method=at(p,'foc-modulation','method');if(!['svpwm','spwm'].includes(method))throw Error('请选择调制方式。');
    const low=bounded(at(p,'foc-modulation','dutyMin'),'最小占空比',0,1),high=bounded(at(p,'foc-modulation','dutyMax'),'最大占空比',0,1);if(low>=high)throw Error('占空比边界无效。');
    return {duty_min:low,duty_max:high,svpwm:method==='svpwm'};
  }},
  'foc-observer':{name:'observer',base:'Observer',values:()=>{throw Error('观测链路与结果选择尚未接入固件生成，不能用单一 PLL 模板代替。');}},
  'foc-compensation':{name:'friction',base:'Friction',config:'float viscous, coulomb, transition, limit;',values:p=>{
    if(at(p,'foc-compensation','frictionModel')!=='coulomb_viscous')throw Error('请选择库仑与粘性摩擦模型。');
    return {viscous:bounded(at(p,'foc-compensation','viscousNmPerRadS'),'粘性系数',0,1e6),coulomb:bounded(at(p,'foc-compensation','coulombNm'),'库仑摩擦',0,1e6),transition:positive(at(p,'foc-compensation','transitionRadS'),'平滑速度'),limit:positive(at(p,'foc-compensation','maxCompensationNm'),'补偿上限')};
  }},
  'app-state':{name:'state_machine',base:'StateMachine',values:p=>{if(at(p,'app-state','stateMachine')!=='local')throw Error('CiA 402 状态机尚未接入新实现。');return {};}},
  'app-runtime':{name:'scheduler',base:'Scheduler',config:'uint32_t task_count, period_us[16];',values:p=>{
    if(at(p,'app-runtime','scheduler')!=='cooperative')throw Error('新调度器目前实现协作式周期释放；抢占式调度尚未接入。');
    const errors=validateSchedule(p).filter(issue=>issue.level==='error');if(errors.length)throw Error(errors.map(issue=>issue.message).join(' '));
    const periods=schedulerTasks(p).map(task=>1e6/positive(task.frequencyHz,'任务频率'));
    if(!periods.length || periods.some(period=>!Number.isSafeInteger(period)||period<=0||period>=0x80000000))throw Error('当前调度时基要求控制周期为有效的整微秒。');
    return {task_count:periods.length,period_us:periods};
  }},
  'app-motion':{name:'motion',base:'Motion',config:'float current_limit;',values:p=>{
    if(at(p,'app-motion','supportedModes').some(mode=>mode!=='current'))throw Error('新运动模块目前实现电流给定仲裁；速度、位置、PD 和力矩外环尚未接入。');
    return {current_limit:positive(at(p,'app-motion','currentLimitA'),'应用电流上限')};
  }},
  'app-comms':{name:'commands',base:'Commands',config:'uint32_t timeout_us;',values:p=>({timeout_us:positive(at(p,'app-comms','timeoutMs'),'命令超时')*1000})},
  'app-params':{name:'records',base:'Records'},
  'app-calibration':{name:'zeroing',base:'Zeroing',config:'uint32_t sample_count;',values:()=>{
    throw Error('编码器校准与摩擦辨识尚未接入；静止标零属于参数管理，不可作为校准实现。');
  }},
  'app-safety':{name:'diagnostics',base:'Diagnostics',values:p=>{if(at(p,'app-safety','faultAction')!=='disable')throw Error('新诊断模块目前仅实现故障锁存停机。');return {};}}
};
