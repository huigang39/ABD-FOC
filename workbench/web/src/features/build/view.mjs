import { pageHeading } from '../../shared/ui/page-heading.mjs';
import { renderNativeBuild, renderNativeDebug, renderNativeFlash } from '../device/view.mjs';
import { edit } from '../configuration/view.mjs';
import { OPTIMIZATION_LEVELS } from './options.mjs';

const optimizationLabels = {
  O0: 'O0 · 无优化', Og: 'Og · 调试', O1: 'O1', O2: 'O2', O3: 'O3',
  Os: 'Os · 代码体积', Oz: 'Oz · 更小体积',
};
const optimizationChoices = OPTIMIZATION_LEVELS.map(value => [value, optimizationLabels[value]]);
const title = (name, description) => pageHeading({ title: name, description });
export function renderBuild(project, native) {
  const build = project.build;
  return `<details class="panel build-options" data-state-key="build-options"><summary>构建设置</summary><div class="design-meta">${edit('编译器', build.compiler, 'build', 'compiler', { choices: [['unselected', '待选择'], ['gcc', 'GCC'], ['clang', 'Clang / LLVM'], ['armclang', 'Arm Compiler'], ['vendor', '厂商工具链']] })}${edit('工具链版本', build.version, 'build', 'version')}${edit('优化等级', build.optimization, 'build', 'optimization', { choices: [['unselected', '待选择'], ...optimizationChoices] })}${edit('链接时优化（LTO）', build.lto, 'build', 'lto', { type: 'boolean' })}${edit('固件加密', build.encryptFirmware, 'build', 'encryptFirmware', { type: 'boolean' })}</div></details>
    ${native ? renderNativeBuild(project,native) + renderNativeFlash(project,native) : ''}`;
}

export function renderDebug(project, native) { return `${title('设备调试', '连接 J-Link，核对固件身份并查看实际采样波形。')}${renderNativeDebug(project,native)}`; }
export function renderFlash(project, native) { return native ? renderNativeFlash(project, native) : ''; }
