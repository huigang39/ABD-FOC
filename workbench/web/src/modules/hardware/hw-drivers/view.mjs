import { fieldHelp } from '../../../shared/ui/field-help.mjs';
import { esc } from '../../../shared/esc.mjs';
import { SENSOR_ROLES, SENSOR_PARAMS, sensorFieldVisible, sensorFieldRequired } from './sensors.mjs';

/** Render shared role cards; the caller owns field bindings and values. */
export function renderSensorConfig(parameters = {}, renderField, {renderTransport}={}) {
  const render = field => {
    const role = SENSOR_ROLES.find(item => item.id === field.sensorRole);
    const presence = field.key === role?.capability;
    return renderField({ ...field,
      ...(presence ? { label: `${role.title}启用`, binarySwitch: true } : {}),
      description: field.description === `${role?.title}的${field.label}配置。` ? '' : field.description,
      required: sensorFieldRequired(field, parameters),
    });
  };
  return `<div class="sensor-config">${SENSOR_ROLES.map((role, index) => {
    const fields = SENSOR_PARAMS.filter(field => field.sensorRole === role.id && sensorFieldVisible(field, parameters));
    const presence = fields.find(field => field.key === role.capability);
    const basic = fields.filter(field => field.key !== role.capability && !field.advanced && field.sensorGroup!=='protocol');
    const protocol=fields.filter(field=>field.sensorGroup==='protocol');
    const transport=statePresent(parameters,role)&&renderTransport?renderTransport(role):'';
    const advanced = fields.filter(field => field.advanced&&!(renderTransport&&field.key===role.prefix+'Bitrate')); 
    const linearHall = parameters[role.prefix + 'Type'] === 'hall' && parameters[role.prefix + 'HallMode'] === 'linear';
    const state = parameters[role.capability];
    const note = state === 'present' && linearHall ? '线性霍尔分别绑定 sin / cos 的 ADC 采样通道。' : '';
    return `<section class="sensor-card" data-sensor-role="${esc(role.id)}" aria-label="${esc(role.title)}配置">
      <div class="sensor-card-head"><span class="sensor-role-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div><h3>${esc(role.title)}${fieldHelp(role.description,role.title)}</h3></div>${presence ? `<div class="sensor-enable">${render(presence)}</div>` : ''}</div>
      ${basic.length ? `<div class="sensor-fields">${basic.map(render).join('')}</div>` : ''}
      ${protocol.length||transport?`<details class="sensor-communication" data-state-key="sensor-protocol-${role.id}"><summary>通信与帧格式</summary>${transport}<div class="sensor-fields">${protocol.map(render).join('')}</div></details>`:''}
      ${advanced.length ? `<details class="sensor-communication sensor-details" data-state-key="sensor-details-${role.id}"><summary>详细参数</summary><div class="sensor-fields">${advanced.map(render).join('')}</div></details>` : ''}
      ${note ? `<p class="sensor-note">${esc(note)}</p>` : ''}
    </section>`;
  }).join('')}</div>`;
}

function statePresent(parameters,role){return parameters[role.capability]==='present';}
