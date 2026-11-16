import { esc } from '../esc.mjs';

/** 全站页头：可选面包屑（末项为当前位置）+ 眉题 + 标题 + 说明 + 右侧操作。 */
export function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="当前位置">${items.map((item, index) => index === items.length - 1
    ? `<span>${esc(item.label)}</span>`
    : `<a href="${esc(item.href)}">${esc(item.label)}</a><span>/</span>`).join('')}</nav>`;
}

export function pageHeading({ title, description = '', eyebrow = '', crumbs = [], actions = '' }) {
  return `${crumbs.length ? breadcrumbs(crumbs) : ''}<div class="page-heading"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h1>${esc(title)}</h1>${description ? `<p class="page-description">${esc(description)}</p>` : ''}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}
