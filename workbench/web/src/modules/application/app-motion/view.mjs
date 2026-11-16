import { esc } from '../../../shared/esc.mjs';
import { icon } from '../../../shared/ui/icons.mjs';
import { MOTION_LOOPS } from './loops.mjs';

const loopIcons={torque:'rotor',speed:'wave',position:'target',pd:'settings'};

/** All four fixed loops remain visible; this view only edits their gains. */
export function renderMotionLoops(project,renderField) {
  const parameters=project?.instances?.['app-motion']?.parameters||{};
  return `<div class="motion-loops">${MOTION_LOOPS.map(loop=>`<section class="hardware-resource motion-loop-card" data-motion-loop="${esc(loop.id)}"><header class="hardware-resource-heading">${icon(loopIcons[loop.id])}<strong>${esc(loop.title)}</strong><span class="motion-loop-tags"><span class="attribute-tag">${esc(loop.controller)}</span></span></header><div class="hardware-resource-body"><div class="profile-form">${loop.fields.map(field=>renderField(field,parameters[field.key]??field.defaultValue??null,'module','app-motion')).join('')}</div></div></section>`).join('')}</div>`;
}
