import { configurationModuleMembers, configurationModule } from './module-aliases.mjs';
import { validateCoreConfigs } from '../../modules/hardware/hw-platform/cores.mjs';
import { calibrationEnabled } from '../../modules/application/app-calibration/validation.mjs';
import { sensorFieldRequired } from '../../modules/hardware/hw-drivers/sensors.mjs';
import { MODULES, TARGET_FIELDS } from '../../core/model.mjs';
import { getConfigurationSelection } from './workspace.mjs';

export const GUIDE_STEPS = [
  { id: 'actuator', title: '选型', summary: '分别选择执行器与驱动器，确定机械、电机和驱动硬件。', modules: [], outcome: '执行器与驱动硬件来源已选定。' },
  { id: 'hardware', title: '硬件', summary: '依次配置内核、外设和驱动。', modules: MODULES.filter(module=>module.layer==='hardware'&&module.id!=='hw-safety').map(module=>module.id), outcome: '目标硬件与模块配置明确。' },
  { id: 'algorithm', title: '算法', summary: '配置电流环、调制器、观测器、滤波器和补偿器。', why: '每个算法模块定义固定的功能与接口，只需配置对应参数。', modules: ['foc-current', 'foc-modulation', 'foc-observer', 'foc-filter', 'foc-compensation'], outcome: '算法参数、数据接口和电流环依赖一致。' },
  { id: 'application', title: '应用', summary: '配置调度器、状态机、控制环、通信、校准、异常与备份。', why: '错误码由保护与诊断模块管理，协议与解析由通信协议模块管理；各功能通过数据结构协作。', modules: ['app-runtime', 'app-state', 'app-motion', 'app-comms', 'app-calibration', 'app-safety', 'app-params'], designPages: ['faults', 'protocol'], outcome: '任务、业务策略、错误码与通信消息已定义。' },
  { id: 'build', title: '构建', summary: '检查当前配置，通过后生成模块源码并编译固件。', modules: [], outcome: '当前配置已完成构建。' },
];

const MODULE_MAP = new Map(MODULES.map(module => [module.id, module]));
// These remain in global checks; configuration progress does not claim physical verification.
const VERIFICATION_ISSUES = new Set(['build-verification', 'hardware-verification', 'realtime-budget', 'calibration-results', 'single-shunt-window', 'equipment-pin-capability', 'design-protocol-crc-definition', 'layer-version-runtime-unverified', 'current-loop-runtime-unverified', 'memory-runtime-unverified','ram-runtime-unverified', 'execution-runtime-unverified', 'compensation-stored-data-unverified', 'compensation-identification-unverified', 'compensation-runtime-unverified', 'cia402-mapping-unverified']);
const known = value => value !== null && value !== undefined && value !== '' && value !== 'unselected' && value !== 'unconfirmed' && (typeof value !== 'string' || value.trim() !== '');
const verificationIssue = issue => VERIFICATION_ISSUES.has(issue.id) || /^hardware-trip-.+-latency$/.test(issue.id || '') || /^(commission|evidence)[-:.]/.test(issue.id || '');
const enabled = (project, id) => project.instances?.[id]?.enabled === true;
const running = (project, id) => enabled(project, id) && project.instances[id].runtimeEnabled === true;
const parameter = (project, id, key) => project.instances?.[id]?.parameters?.[key];

function validField(field, value) {
  if (!known(value)) return false;
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'number' || field.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (field.type !== 'integer' || Number.isSafeInteger(value)) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
  if (field.type === 'select') return field.options.some(option => option.value === value);
  if (field.type === 'multiselect') return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every(item => field.options.some(option => option.value === item));
  return typeof value === 'string' && value.trim().length > 0;
}

function conditionalField(project, id, key) {
  if(id==='hw-drivers')return sensorFieldRequired(MODULE_MAP.get(id).params.find(field=>field.key===key),project.instances[id].parameters);
  if (id === 'foc-observer' && key === 'startupStrategy') return parameter(project, 'foc-feedback', 'angleSource') === 'observer';
  if (id === 'app-calibration' && key === 'maxCurrentA') return ['electrical_zero', 'hall', 'friction'].some(item => calibrationEnabled(project,item));
  return false;
}

function checksForStep(step, project, relevant, selection) {
  const checks = [];
  const invalid = (moduleId, key) => relevant.some(issue => issue.level === 'error' && issue.moduleId === moduleId && (!issue.paramKey || issue.paramKey === key));
  if (step.id === 'actuator') {
    const assemblyValid = !project.catalog?.activeAssemblyId || Boolean(selection.assembly);
    const actuatorMatches = !selection.assembly || selection.assembly.actuatorId === selection.actuator?.id;
    const driverMatches = !selection.assembly || selection.assembly.driverId === selection.driver?.id;
    // An empty driver reference has always meant editable custom hardware, including in older projects.
    const customHardware = selection.hardwareMode === 'custom' && !project.catalog?.activeDriverId && !selection.assembly?.driverId;
    checks.push(Boolean(selection.actuator) && assemblyValid && actuatorMatches, (Boolean(selection.driver) || customHardware) && assemblyValid && driverMatches);
  }
  if (step.id === 'hardware') for (const field of TARGET_FIELDS) checks.push(validField(field, project.target?.[field.key]));
  for (const id of new Set(step.modules.flatMap(configurationModuleMembers))) {
    const module = MODULE_MAP.get(id);
    if (!module) continue;
    if (module.required) checks.push(enabled(project, id));
    if (!enabled(project, id)) continue;
    if(id==='hw-platform')checks.push(validateCoreConfigs(project.target.mcu,project.instances[id].parameters,project).length===0);
    if (id==='foc-compensation'&&!running(project,id)) continue;
    for (const field of module.params.filter(field => !field.hidden && !(id==='hw-platform'&&field.group==='memory'&&project.memory?.layout.banks.length) && (!field.architectureOnly || field.architectureOnly === parameter(project,'hw-platform','architecture')))) if (field.required || conditionalField(project, id, field.key)) checks.push(validField(field, parameter(project, id, field.key)) && !invalid(id, field.key));
  }
  if (step.id === 'application') {
    for (const page of ['faults']) checks.push(Array.isArray(project.design?.[page]) && project.design[page].length > 0 && !relevant.some(issue => issue.designPage === page && ['error', 'pending'].includes(issue.level)));
    const protocol = project.design?.protocol;
    if (enabled(project,'app-comms') || known(protocol?.transport)) checks.push(Boolean(protocol && known(protocol.transport) && known(protocol.integrity) && Array.isArray(protocol.messages) && protocol.messages.length > 0 && !relevant.some(issue => issue.designPage === 'protocol' && ['error', 'pending'].includes(issue.level))));
  }
  return checks;
}

function moduleProgress(step, project, relevant, selection) {
  return step.modules.map(id => {
    const module = configurationModule(MODULE_MAP.get(id)), members = configurationModuleMembers(id);
    const moduleIssues = relevant.filter(issue => {
      if (issue.id === 'project-format') return true;
      if (issue.designPage === 'interfaces') {
        const link = project.design.layerInterfaces?.find(item => item.id === issue.itemId);
        return [link?.fromModule, link?.toModule].some(moduleId=>members.includes(moduleId));
      }
      if (issue.moduleId) return members.includes(issue.moduleId);
      if (issue.designPage === 'structures') return members.includes(project.design.structures.find(item => item.id === issue.itemId)?.owner);
      return issue.designPage === 'faults' && id === 'app-safety' || issue.designPage === 'protocol' && id === 'app-comms';
    });
    const errors = moduleIssues.some(issue => issue.level === 'error');
    if (!members.some(moduleId=>enabled(project,moduleId)) && !module.required && !errors) return { id, title: module.title, state: 'disabled', statusLabel: '未启用', completed: 0, total: 0, issues: moduleIssues };
    const criteria = checksForStep({ id: 'module', modules: [id] }, project, moduleIssues, selection);
    if (['hw-platform','hw-board'].includes(id)) for (const field of TARGET_FIELDS.filter(field => (field.key === 'board') === (id === 'hw-board'))) criteria.push(validField(field, project.target[field.key]));
    if (id === 'app-safety') criteria.push(project.design.faults.length > 0);
    if (id === 'app-comms' && enabled(project, id)) criteria.push(known(project.design.protocol.transport), known(project.design.protocol.integrity), project.design.protocol.messages.length > 0);
    const completed = criteria.filter(Boolean).length;
    const state = errors ? 'blocked' : completed === criteria.length && !moduleIssues.some(issue => issue.level === 'pending') ? 'configured' : 'todo';
    return { id, title: module.title, state, completed, total: criteria.length, issues: moduleIssues, statusLabel: { configured: '配置检查通过', blocked: '需要处理', todo: '待配置' }[state] };
  });
}

export function getGuide(project, issues = [], context = {}) {
  const sourceIssues = Array.isArray(issues) ? issues : [];
  const selection = context.selection || getConfigurationSelection(project);
  const inspectionCurrent = context.inspection?.current === true;
  const inspectionPassed = inspectionCurrent && context.inspection?.supported === true;
  const buildReady = inspectionPassed && context.buildStatus === 'built';
  const steps = GUIDE_STEPS.map(step => {
    if (step.id === 'build') {
      const failed=context.buildStatus==='failed'||inspectionCurrent&&!inspectionPassed;
      const flashed = buildReady && context.flashStatus?.current === true && context.flashStatus?.programmed === true;
      return {...step,state:buildReady?'configured':failed?'blocked':'todo',issues:sourceIssues,completed:Number(buildReady),total:1,
        statusLabel:flashed?'已烧录':buildReady?'已构建':context.buildStatus==='building'?'构建中':failed?'待处理':'待构建'};
    }
    const skipProtocol = !enabled(project,'app-comms') && !known(project.design?.protocol?.transport);
    const interfaceBelongsToStep = issue => {
      if(issue.designPage!=='interfaces')return false;
      const link=project.design.layerInterfaces?.find(item=>item.id===issue.itemId);
      const endpoints=[link?.fromModule,link?.toModule].filter(id=>MODULE_MAP.has(id));
      const layerOfStep={hardware:'hardware',algorithm:'foc',application:'app'};
      return endpoints.some(id=>step.modules.includes(id))
        ||(!endpoints.length&&step.id==='application')
        ||endpoints.some(id=>!GUIDE_STEPS.some(other=>other.modules.includes(id))&&MODULE_MAP.get(id)?.layer===layerOfStep[step.id]);
    };
    const equipmentBelongsToStep = issue => issue.designPage === 'equipment' && step.id === 'actuator' && (
      Boolean(issue.itemId) && [selection.actuator?.id, selection.driver?.id, selection.assembly?.id].includes(issue.itemId) ||
      ['equipment-actuator-selection', 'equipment-actuator-reference', 'equipment-driver-reference', 'equipment-active-reference', 'equipment-active-selection', 'equipment-format'].includes(issue.id)
    );
    const relevant = sourceIssues.filter(issue => !(skipProtocol && issue.designPage==='protocol' && issue.level!=='error') && !verificationIssue(issue) && (step.modules.flatMap(configurationModuleMembers).includes(issue.moduleId) || interfaceBelongsToStep(issue) || (issue.designPage === 'structures' && step.modules.flatMap(configurationModuleMembers).includes(project.design?.structures.find(item => item.id === issue.itemId)?.owner)) || equipmentBelongsToStep(issue) || step.designPages?.includes(issue.designPage) || (step.id === 'hardware' && issue.id === 'project-format')));
    const criteria = checksForStep(step, project, relevant, selection);
    const completed = criteria.filter(Boolean).length;
    const state = relevant.some(issue => issue.level === 'error') ? 'blocked' : completed === criteria.length && !relevant.some(issue => issue.level === 'pending') ? 'configured' : 'todo';
    return { ...step, state, issues: relevant, completed, total: criteria.length, children: moduleProgress(step, project, relevant, selection) };
  });
  const configuredCount = steps.filter(step => step.state === 'configured').length;
  return {
    steps,
    nextStepId: steps.find(step => step.state !== 'configured')?.id || null,
    configuredCount,
    totalSteps: steps.length,
    summary: `已完成 ${configuredCount}/${steps.length} 个步骤。`,
  };
}
