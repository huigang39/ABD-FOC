import { MODULES } from '../../core/catalog.mjs';
import { esc } from '../../shared/esc.mjs';

export function renderFirmwareSources(job, preview) {
  const files = job?.manifest?.generatedFiles;
  if (!files?.length) return '';
  const entries = files.map((file, index) => ({ file, index }));
  const button = ({ file, index }) => `<button class="button small" type="button" data-native-action="preview-source" data-index="${index}" title="${esc(file.path)}">${esc(file.path.split('/').at(-1))}</button>`;
  const layers = [['hardware', '硬件层'], ['algorithm', '算法层'], ['application', '应用层']];
  return `<details class="native-source-browser" data-state-key="generated-module-sources"><summary>模块源码 · ${files.length} 个文件</summary><p class="design-note">展开模块查看 C 源文件与头文件。每次生成对应一份固定的配置快照。</p>${layers.map(([layer, label]) => {
    const members = entries.filter(({ file }) => file.layer === layer);
    const moduleIds = [...new Set(members.map(({ file }) => file.moduleId))];
    return `<div class="native-source-layer"><strong>${label}</strong>${moduleIds.map(id => {
      const group = members.filter(({ file }) => file.moduleId === id);
      const primary = group.filter(({ file }) => file.primary);
      const dependencies = group.filter(({ file }) => !file.primary);
      return `<details class="native-source-module" data-state-key="source-module-${esc(layer)}-${esc(id)}"><summary>${esc(MODULES.find(module => module.id === id)?.title || id)}<small>${group.length} 个文件</small></summary><div class="native-source-files">${primary.map(button).join('')}</div>${dependencies.length ? `<details class="native-source-dependencies" data-state-key="source-dependencies-${esc(layer)}-${esc(id)}"><summary>内部实现与依赖 · ${dependencies.length}</summary><div class="native-source-files">${dependencies.map(button).join('')}</div></details>` : ''}</details>`;
    }).join('')}</div>`;
  }).join('')}<div data-live="native-source-preview">${preview ? `<p class="design-note"><code>${esc(preview.path)}</code></p><pre class="native-log native-source-code" tabindex="0" data-log-key="source:${esc(job.id)}:${esc(preview.path)}">${esc(preview.content)}</pre>` : '<p class="design-note">选择文件查看源码。</p>'}</div></details>`;
}
