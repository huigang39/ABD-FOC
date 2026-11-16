import { configurationModuleId, configurationModule } from './module-aliases.mjs';
import { MODULES } from '../../modules/registry.mjs';
import { esc } from '../../shared/esc.mjs';

const layers = {
  app: { title: '应用层', initial: 'app-runtime' },
  foc: { title: '算法层', initial: 'foc-current' },
  hardware: { title: '硬件层', initial: 'hw-platform' },
};

export function parameterModuleRoute(moduleId) {
  const module = MODULES.find(item => item.id === moduleId);
  if (!module) return '#/architecture';
  // Feedback is configured with the current loop, as in the project editor.
  const id = ['foc-feedback','foc-lifecycle'].includes(module.id) ? 'foc-current' : module.id === 'hw-safety' ? 'hw-platform' : configurationModuleId(module.id);
  return `#/parameters/${module.layer}?module=${encodeURIComponent(id)}`;
}

export function resolveParameterModule(layerId, moduleId) {
  const layer = layers[layerId];
  if (!layer) return null;
  const modules = MODULES.filter(module => module.layer === layerId && !['foc-feedback','foc-lifecycle','hw-safety'].includes(module.id)).sort((a, b) => a.order - b.order).map(configurationModule);
  const selectedId = ['foc-feedback','foc-lifecycle'].includes(moduleId) ? 'foc-current' : configurationModuleId(moduleId);
  const module = modules.find(item => item.id === selectedId) || modules.find(item => item.id === layer.initial) || modules[0];
  return { layer, modules, module };
}

/** Parameter editing only: no project workflow, build or device-operation shortcuts. */
export function renderModuleParameters(project, layerId, moduleId, { parameters = () => '' } = {}) {
  const selection = resolveParameterModule(layerId, moduleId);
  if (!selection) return '<section class="module-parameters-page"><div class="empty-state"><h1>未找到参数模块</h1></div><footer class="page-back-actions"><a class="button small navigation-action" href="#/architecture">← 返回主页</a></footer></section>';
  const { layer, modules, module } = selection;
  return `<section class="module-parameters-page configuration-workflow" data-parameter-layer="${esc(layerId)}" data-parameter-module="${esc(module.id)}"><div class="guide-layout">
    <nav class="module-parameters-sidebar configuration-tree guide-steps" aria-label="${esc(layer.title)}子模块">
      <div class="configuration-tree-heading"><h1>${esc(layer.title)}参数</h1></div>
      <ul class="module-parameters-nav">${modules.map((item,index) => `<li class="configuration-tree-item configuration-module-leaf"><a class="guide-step${item.id === module.id ? ' active' : ''}" href="${parameterModuleRoute(item.id)}"${item.id === module.id ? ' aria-current="page"' : ''}><span class="step-index">${String(index+1).padStart(2,'0')}</span><span class="step-copy"><strong>${esc(item.title)}</strong></span></a><span class="tree-chevron tree-chevron-blank" aria-hidden="true"></span></li>`).join('')}</ul>
    </nav>
    <section class="guide-content module-parameters-editor" aria-labelledby="module-parameters-title">
      <div class="guide-summary module-parameters-toolbar"><div class="guide-summary-copy"><h2 id="module-parameters-title">${esc(module.title)}</h2><p id="module-parameter-channel">设备参数通道未接入</p></div><div class="guide-summary-actions"><div class="module-parameter-transfer" aria-label="设备参数"><button class="button" type="button" data-parameter-action="read" disabled aria-describedby="module-parameter-channel">读取参数</button><button class="button" type="button" data-parameter-action="write" disabled aria-describedby="module-parameter-channel">写入参数</button></div></div></div>
      <div class="profile-form">${parameters(module)}</div>
    </section>
  </div><footer class="page-back-actions"><a class="button small navigation-action" href="#/architecture">← 返回主页</a></footer></section>`;
}
