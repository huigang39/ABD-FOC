import { identifyMcu } from '../../features/deployment/mcu.mjs';
import { isEmptyChoice } from '../forms/select-control.mjs';

const ARROW = '<svg class="select-menu-arrow" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4"/></svg>';
const SELECTOR = 'select.field-select:not([multiple]), select.compact-input:not([multiple])';

/** Flattens an option list (including optgroups) into renderable groups; hidden placeholder options stay hidden. */
export function listSelectOptions(select) {
  const read = option => ({ value: option.value, label: option.textContent, disabled: Boolean(option.disabled), hidden: Boolean(option.hidden) });
  const groups = [];
  for (const child of select.children ?? []) {
    if (child.tagName === 'OPTGROUP') groups.push({ group: child.label ?? '', options: [...(child.children ?? [])].map(read) });
    else if (child.tagName === 'OPTION') groups.push({ group: '', options: [read(child)] });
  }
  return groups;
}

/** Picks below the trigger when there is room, flips up near the viewport floor, and clamps into view. */
export function placeSelectPop(triggerRect, popRect, viewport, gap = 6, margin = 8) {
  const roomBelow = viewport.height - triggerRect.bottom;
  const openUp = roomBelow < popRect.height + gap && triggerRect.top > roomBelow;
  const top = openUp ? Math.max(margin, triggerRect.top - popRect.height - gap) : triggerRect.bottom + gap;
  const left = Math.max(margin, Math.min(triggerRect.left, Math.max(margin, viewport.width - popRect.width - margin)));
  return { top, left, openUp };
}

/** The native <select> stays in the DOM (hidden) as the data source, so all change/dataset wiring keeps working. */
export function enhanceSelectMenus(root = document) {
  if (!root?.querySelectorAll) return 0;
  let count = 0;
  for (const select of root.querySelectorAll(SELECTOR)) {
    if (select.closest('[data-select-menu]') || select.disabled || !select.ownerDocument?.createElement) continue;
    enhanceSelect(select);
    count++;
  }
  return count;
}

function enhanceSelect(select) {
  const doc = select.ownerDocument, win = doc.defaultView;
  const container = doc.createElement('div');
  container.className = 'select-menu';
  container.setAttribute('data-select-menu', '');
  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-menu-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  if (select.id) {
    trigger.id = `${select.id}-menu`;
    const label = select.closest('.form-field')?.querySelector(`label[for="${select.id}"]`);
    if (label) {
      label.setAttribute('for', trigger.id);
      trigger.setAttribute('aria-label', label.textContent.trim());
    }
  }
  const value = doc.createElement('span');
  value.className = 'select-menu-value';
  const template = doc.createElement('template');
  template.innerHTML = ARROW;
  trigger.append(value, template.content.firstElementChild);
  const pop = doc.createElement('div');
  pop.className = 'select-menu-pop';
  pop.setAttribute('role', 'listbox');
  if (trigger.getAttribute('aria-label')) pop.setAttribute('aria-label', trigger.getAttribute('aria-label'));
  pop.hidden = true;
  container.append(trigger, pop);
  select.before(container);
  container.append(select);
  select.setAttribute('hidden', '');

  let openState = false, activeIndex = -1, cleanup = null;
  const items = () => [...pop.querySelectorAll('.select-menu-option:not([hidden])')];

  const updateTrigger = () => {
    const selected = select.selectedOptions?.[0];
    value.textContent = selected ? selected.textContent : '';
    trigger.dataset.empty = select.dataset.empty || String(isEmptyChoice(select.value));
  };
  container.updateTrigger = () => updateTrigger();
  updateTrigger();

  let vendorFilter = '';
  const renderPop = () => {
    pop.innerHTML = '';
    if(select.dataset.optionGroup==='mcu') {
      const bar=doc.createElement('div');bar.className='mcu-vendor-filter';bar.setAttribute('role','group');bar.setAttribute('aria-label','筛选 MCU 厂商');
      const vendors=[...new Set(listSelectOptions(select).flatMap(g=>g.options).map(o=>identifyMcu(o.value)?.vendor).filter(Boolean))];
      for(const [id,title] of [['','全部'],...vendors.map(id=>[id,({st:'ST',hpmicro:'先楫'})[id]||id])]){
        const chip=doc.createElement('button');chip.type='button';chip.className='mcu-vendor-chip';chip.textContent=title;
        if(id)chip.title=({st:'ST',hpmicro:'先楫 HPMicro'})[id]||id;
        chip.setAttribute('aria-pressed',String(id===vendorFilter));
        chip.addEventListener('click',event=>{event.stopPropagation();vendorFilter=id;renderPop();place();pop.querySelector('.mcu-vendor-chip[aria-pressed="true"]')?.focus();});
        bar.append(chip);
      }
      pop.append(bar);
    }

    if(select.dataset.edit==='algorithm-path' && ['field','comparisonField'].includes(select.dataset.key)){
      const bar=doc.createElement('div');bar.className='select-search-bar';
      const search=doc.createElement('input');search.type='search';search.className='field-input';search.placeholder='搜索结构或字段';search.setAttribute('aria-label','搜索数据字段');
      const button=doc.createElement('button');button.type='button';button.className='button small';button.textContent='搜索';
      const filter=()=>{const query=search.value.trim().toLocaleLowerCase();for(const item of pop.querySelectorAll('.select-menu-option'))item.hidden=!item.textContent.toLocaleLowerCase().includes(query);activeIndex=-1;place();};
      search.addEventListener('input',filter);search.addEventListener('keydown',event=>{if(event.key!=='Escape')event.stopPropagation();if(event.key==='Enter'){event.preventDefault();filter();}});
      button.addEventListener('click',event=>{event.stopPropagation();filter();search.focus();});
      bar.append(search,button);pop.append(bar);
    }
    let count = 0;
    for (const group of listSelectOptions(select)) {
      if (group.group) {
        const head = doc.createElement('div');
        head.className = 'select-menu-group-label';
        head.setAttribute('role', 'presentation');
        head.textContent = group.group;
        pop.append(head);
      }
      for (const entry of group.options) {
        if (entry.hidden || (select.dataset.optionGroup==='mcu'&&vendorFilter&&identifyMcu(entry.value)?.vendor!==vendorFilter)) continue;
        const item = doc.createElement('div');
        item.className = 'select-menu-option';
        item.setAttribute('role', 'option');
        item.tabIndex = -1;
        item.dataset.value = entry.value;
        item.textContent = entry.label;
        if (entry.disabled) { item.setAttribute('aria-disabled', 'true'); if(select.dataset.edit==='pcba-resource'&&['pins',''].includes(select.dataset.section||''))item.dataset.conflict='true'; }
        if (String(entry.value) === String(select.value)) item.setAttribute('aria-selected', 'true');
        pop.append(item);
        count++;
      }
    }
    if (!count) {
      const empty = doc.createElement('div');
      empty.className = 'select-menu-empty';
      empty.textContent = '暂无可选项';
      pop.append(empty);
    }
  };

  const setActive = (index, focus = true) => {
    const list = items();
    if (!list.length) { activeIndex = -1; return; }
    activeIndex = Math.max(0, Math.min(index, list.length - 1));
    for (const [at, item] of list.entries()) item.classList.toggle('active', at === activeIndex);
    if (focus) list[activeIndex].focus({ preventScroll: true });
    list[activeIndex].scrollIntoView?.({ block: 'nearest' });
  };

  const place = () => {
    const triggerRect = trigger.getBoundingClientRect();
    pop.hidden = false;
    const popRect = pop.getBoundingClientRect();
    const viewport = { width: win?.innerWidth ?? 1024, height: win?.innerHeight ?? 768 };
    const spot = placeSelectPop(triggerRect, popRect, viewport);
    pop.style.left = `${Math.round(spot.left)}px`;
    pop.style.top = `${Math.round(spot.top)}px`;
    pop.style.minWidth = `${Math.round(triggerRect.width)}px`;
  };

  const close = (restoreFocus = true) => {
    if (!openState) return;
    openState = false;
    container.removeAttribute('data-open');
    trigger.setAttribute('aria-expanded', 'false');
    pop.hidden = true;
    cleanup?.();
    cleanup = null;
    for (const item of items()) item.classList.remove('active');
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  };

  const open = () => {
    if (openState) return;
    renderPop();
    openState = true;
    container.setAttribute('data-open', '');
    trigger.setAttribute('aria-expanded', 'true');
    place();
    const outside = event => { if (!container.contains(event.target)) close(false); };
    const onScroll = event => { if (event.target === pop || pop.contains?.(event.target)) return; close(false); };
    doc.addEventListener('pointerdown', outside, true);
    win?.addEventListener('resize', onScroll, { passive: true });
    win?.addEventListener('scroll', onScroll, true);
    cleanup = () => {
      doc.removeEventListener('pointerdown', outside, true);
      win?.removeEventListener('resize', onScroll);
      win?.removeEventListener('scroll', onScroll, true);
    };
    const selectedAt = items().findIndex(item => item.getAttribute('aria-selected') === 'true');
    setActive(selectedAt >= 0 ? selectedAt : 0, !pop.querySelector('.select-search-bar'));
    pop.querySelector('.select-search-bar input')?.focus({preventScroll:true});
  };

  const commit = item => {
    if (!item || item.getAttribute('aria-disabled') === 'true') return;
    select.value = item.dataset.value ?? select.value;
    select.dataset.empty = String(isEmptyChoice(select.value));
    updateTrigger();
    close(false);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  trigger.addEventListener('click', () => { openState ? close() : open(); });
  container.addEventListener('keydown', event => {
    if(event.target.closest?.('.mcu-vendor-filter')&&event.key!=='Escape')return;
    const list = items();
    if (event.key === 'Escape') { if (openState) { event.preventDefault(); close(); } return; }
    if (event.key === 'Tab') { close(false); return; }
    if (!openState) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(); }
      return;
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex - 1); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(list.length - 1); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); commit(list[activeIndex]); }
  });
  pop.addEventListener('mousedown', event => {if(!event.target.closest?.('.mcu-vendor-filter,.select-search-bar'))event.preventDefault();});
  pop.addEventListener('click', event => commit(event.target.closest?.('.select-menu-option')));
}
