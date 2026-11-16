import { number } from '../../shared/fields.mjs';

const gain=(key,label,unit,description)=>number(key,label,unit,'init',description,{min:0,required:false});
/** Fixed loop roles. Gains are never inferred from a previous mode or plant value. */
export const MOTION_LOOPS=Object.freeze([
 {id:'torque',title:'力矩环',controller:'PID',fields:[
  gain('torqueKp','Kp','A/(N·m)','负载力矩误差到 Iq 的比例增益。'),
  gain('torqueKi','Ki','A/(N·m·s)','负载力矩误差积分到 Iq 的积分增益。'),
  gain('torqueKd','Kd','A·s/(N·m)','负载力矩误差变化率到 Iq 的微分增益。'),
 ]},
 {id:'speed',title:'速度环',controller:'PID',fields:[
  gain('speedKp','Kp','A/(rad/s)','输出轴速度误差到 Iq 的比例增益。'),
  gain('speedKi','Ki','A/rad','输出轴速度误差积分到 Iq 的积分增益。'),
  gain('speedKd','Kd','A/(rad/s²)','输出轴速度误差变化率到 Iq 的微分增益。'),
 ]},
 {id:'position',title:'位置环',controller:'PID',fields:[
  gain('positionKp','Kp','1/s','输出轴位置误差到速度给定的比例增益。'),
  gain('positionKi','Ki','1/s²','输出轴位置误差积分到速度给定的积分增益。'),
  gain('positionKd','Kd','','输出轴位置误差变化率到速度给定的微分增益。'),
 ]},
 {id:'pd',title:'PD 环',controller:'PD',fields:[
  gain('pdKp','Kp','N·m/rad','输出轴位置误差到力矩给定的比例增益。'),
  gain('pdKd','Kd','N·m/(rad/s)','输出轴速度误差到力矩给定的微分增益。'),
 ]},
].map(loop=>Object.freeze({...loop,keys:Object.freeze(loop.fields.map(field=>field.key)),fields:Object.freeze(loop.fields.map(Object.freeze))})));
export const MOTION_GAIN_FIELDS=Object.freeze(MOTION_LOOPS.flatMap(loop=>loop.fields));
export const MOTION_GAIN_KEYS=Object.freeze(MOTION_GAIN_FIELDS.map(field=>field.key));
