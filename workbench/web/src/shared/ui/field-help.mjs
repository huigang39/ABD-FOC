import { renderMath } from './math.mjs';
import { esc } from '../esc.mjs';

/** One shared help surface keeps long descriptions out of compact forms. */
export function fieldHelp(text, label = '配置说明') {
  if (!text) return '';
  return `<button type="button" class="field-help" data-help="${esc(text)}" aria-label="${esc(label)}说明"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="10" cy="10" r="7.25"/><path d="M8.1 7.6a2 2 0 0 1 3.9.5c0 1.5-2 1.7-2 3.2"/><path d="M10 13.5h.01" stroke-width="2" stroke-linecap="round"/></svg></button>`;
}

export function installFieldHelp(doc) {
  const win = doc.defaultView, tip = doc.createElement('div');
  tip.id = 'field-help-tooltip';
  tip.className = 'field-help-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  if ('showPopover' in tip) tip.setAttribute('popover', 'manual');
  doc.body.append(tip);
  let anchor = null, pinned = false, timer;
  const hide = () => {
    clearTimeout(timer);
    anchor?.removeAttribute('aria-describedby');
    if (tip.matches(':popover-open')) tip.hidePopover();
    tip.hidden = true;
    anchor = null; pinned = false;
  };
  const position = () => {
    if (!anchor?.isConnected) { hide(); return; }
    const rect = anchor.getBoundingClientRect(), margin = 12;
    tip.style.left = `${Math.max(margin, Math.min(rect.left - 12, win.innerWidth - tip.offsetWidth - margin))}px`;
    const below = rect.bottom + 8;
    tip.style.top = `${Math.max(margin, below + tip.offsetHeight < win.innerHeight - margin ? below : rect.top - tip.offsetHeight - 8)}px`;
  };
  const show = button => {
    clearTimeout(timer);
    if (anchor !== button) { hide(); anchor = button; }
    tip.textContent = button.dataset.help;
    renderMath(tip);
    button.setAttribute('aria-describedby', tip.id);
    tip.hidden = false;
    if (tip.showPopover && !tip.matches(':popover-open')) tip.showPopover();
    position();
  };
  const scheduleHide = () => { if (!pinned) timer = setTimeout(hide, 140); };
  doc.addEventListener('pointerover', event => {
    const button = event.target.closest?.('[data-help]');
    if (button && event.pointerType !== 'touch' && !pinned) show(button);
    if (tip.contains(event.target)) clearTimeout(timer);
  });
  doc.addEventListener('pointerout', event => {
    if (event.target.closest?.('[data-help]') || tip.contains(event.target)) scheduleHide();
  });
  doc.addEventListener('focusin', event => { if (event.target.matches?.('[data-help]')) show(event.target); });
  doc.addEventListener('focusout', event => { if (event.target === anchor) scheduleHide(); });
  doc.addEventListener('click', event => {
    const button = event.target.closest?.('[data-help]');
    if (button) {
      event.preventDefault(); event.stopPropagation();
      if (anchor === button && pinned) hide();
      else { show(button); pinned = true; }
    } else if (!tip.contains(event.target)) hide();
  }, true);
  doc.addEventListener('keydown', event => { if (event.key === 'Escape' && anchor) { hide(); event.stopPropagation(); } }, true);
  win.addEventListener('resize', hide);
  doc.addEventListener('scroll', hide, true);
  return { dismiss: hide };
}
