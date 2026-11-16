import { fixedAlgorithmChildren } from '../children.mjs';
import { edit } from '../../../features/configuration/view.mjs';

export function renderAngleDelay(project) {
  const child = fixedAlgorithmChildren(project, 'foc-compensation').find(item => item.type === 'angle_delay');
  return edit('角度延时补偿', child.parameters.delayCycles, 'algorithm-child', 'delayCycles', {
    id: child.id, section: 'foc-compensation', type: 'number', unit: '周期', min: 0,
  });
}
