import { getMcuCores } from '../deployment/mcu.mjs';
import { moduleCore } from '../deployment/execution.mjs';
import { icon } from '../../shared/ui/icons.mjs';
import { renderModuleToggles } from '../../shared/ui/module-tags.mjs';
import { renderNativeBuild, renderNativeDebug, renderNativeFlash } from '../device/view.mjs';
import { MODULES } from '../../core/catalog.mjs';
import { edit, esc } from '../configuration/view.mjs';
import { getModuleOptimization, OPTIMIZATION_LEVELS } from './options.mjs';
import { renderMemorySummary } from '../deployment/flash-view.mjs';
import { renderExecutionSummary } from '../deployment/execution-view.mjs';

const optimizationLabels = {
  O0: 'O0 · 无优化', Og: 'Og · 调试', O1: 'O1', O2: 'O2', O3: 'O3',
  Os: 'Os · 代码体积', Oz: 'Oz · 更小体积',
};
const optimizationChoices = OPTIMIZATION_LEVELS.map(value => [value, optimizationLabels[value]]);
const title = (name, description) => `<div class="page-heading"><div><h1>${esc(name)}</h1><p class="page-description">${esc(description)}</p></div></div>`;
const effectiveValue = (moduleId, effective) => `<span data-live="optimization-${esc(moduleId)}">${esc(effective === 'unselected' ? '待选择' : effective)}</span>`;
const optimizationEditor = (moduleId, setting) => edit('模块优化等级', setting, 'module-optimization', 'optimization', {
  id: moduleId, choices: [['inherit', '继承全局'], ...optimizationChoices],
});

export function renderBuild(project, native) {
  const build = project.build;
  const cores=getMcuCores(project.target.mcu), multicore=cores.length>1;
  return `<section class="panel"><div class="design-toolbar"><h2>目标部署</h2><span class="status-pill neutral">${renderExecutionSummary(project)}</span></div>${renderMemorySummary(project)}<div class="memory-summary"><div>${icon('chip')}<span><strong>模块协作</strong><small>模块执行内核与跨核数据交换</small></span></div><a class="button small navigation-action" href="#/project/execution">配置协作 →</a></div><p class="design-note">内核分工、RAM 与 Flash 使用同一套部署配置；各核固件的实际地址与占用需要核对链接产物。</p></section>
    <section class="panel"><h2>全局配置</h2><div class="design-meta">${edit('编译器', build.compiler, 'build', 'compiler', { choices: [['unselected', '待选择'], ['gcc', 'GCC'], ['clang', 'Clang / LLVM'], ['armclang', 'Arm Compiler'], ['vendor', '厂商工具链']] })}${edit('工具链版本', build.version, 'build', 'version')}${edit('全局优化等级', build.optimization, 'build', 'optimization', { choices: [['unselected', '待选择'], ...optimizationChoices] })}${edit('链接时优化（LTO）', build.lto, 'build', 'lto', { type: 'boolean' })}</div><p class="design-note">优化等级与 LTO 支持情况需按工具链及版本确认；LTO 对模块优化边界的影响需在构建时核对。</p></section>
    <section class="panel"><h2>固件交付</h2>${edit('固件加密', build.encryptFirmware, 'build', 'encryptFirmware', { type: 'boolean' })}<p class="design-note">本地开发与 J-Link 调试可关闭。开启后需要服务器签名加密服务与设备 Bootloader 配合；当前尚未接入，生成和编译会被阻止。</p></section>
    ${native ? renderNativeBuild(project,native) : ''}<section class="panel"><h2>模块配置</h2><p class="design-note">未单独设置的模块继承全局优化。运行期开关不改变编译选项；未包含的模块保留配置。</p><div class="contract-table-wrap"><table class="contract-table build-module-table"><thead><tr><th scope="col">模块</th>${multicore?'<th scope="col">执行核心</th>':''}<th scope="col">模块状态</th><th scope="col">优化等级</th><th scope="col">最终生效</th></tr></thead><tbody>${MODULES.map(module => {
    const state = getModuleOptimization(project, module.id);
    const instance = project.instances[module.id];
    const assigned=moduleCore(project,module.id), core=cores.find(item=>item.id===assigned);
    const coreLabel=core?.label||(assigned?`${assigned}（当前 MCU 不可用）`:'待分配');
    return `<tr><td><strong>${esc(module.title)}</strong></td>${multicore?`<td><a class="attribute-tag build-core-tag" href="#/project/execution" title="配置模块执行核心">${esc(coreLabel)}</a></td>`:''}<td>${renderModuleToggles(module,instance,{switchStyle:true})}</td><td>${optimizationEditor(module.id, state.setting)}</td><td><strong>${effectiveValue(module.id, state.effective)}</strong>${state.compiled ? '' : '<div class="muted">未参与编译</div>'}</td></tr>`;
  }).join('')}</tbody></table></div></section>`;
}

export function renderDebug(project, native) { return `${title('设备调试', '连接 J-Link，核对固件身份并查看实际采样波形。')}${renderNativeDebug(project,native)}`; }
export function renderFlash(project, native) { return native ? renderNativeFlash(project, native) : ''; }
