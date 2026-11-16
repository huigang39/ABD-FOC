/** Canvas cards edit the current project on double-click or keyboard activation. */
export function homeRouteForEvent(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return '';
  if (event.type === 'keydown' && (!['Enter', ' '].includes(event.key) || event.repeat)) return '';
  if (!['dblclick', 'keydown'].includes(event.type)) return '';
  const card = event.target?.closest?.('[data-home-route]');
  if (!card) return '';
  // A select, action button or child link owns its interaction, not the enclosing card.
  const control = event.target.closest('a,button,input,select,textarea,summary,[data-select-menu],[contenteditable="true"]');
  if (control && control !== card && card.contains(control)) return '';
  const route = card.dataset.homeRoute || '';
  return route.startsWith('#/') ? route : '';
}

export function installHomeNavigation(root, navigate) {
  const activate = event => {
    const route = homeRouteForEvent(event);
    if (!route) return;
    event.preventDefault();
    navigate(route);
  };
  root.addEventListener('dblclick', activate);
  root.addEventListener('keydown', activate);
  return () => {
    root.removeEventListener('dblclick', activate);
    root.removeEventListener('keydown', activate);
  };
}

/** Source selection is a canvas preference, independent of project or device commands. */
export function installHomeSourceSelection(root, { getSource = () => 'can', onChange = () => {} } = {}) {
  const hosts = ['can', 'ethercat', 'ethernet'];
  const selector = 'input[type="radio"][name="canvas-source"]';
  let lastHostSource = hosts.includes(getSource()) ? getSource() : 'can';
  const remember = value => {
    if (hosts.includes(value)) lastHostSource = value;
    if (value !== getSource()) onChange(value);
  };
  const click = event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.button !== 0) return;
    const card = event.target?.closest?.('[data-home-source]');
    if (!card || !['host', 'debug'].includes(card.dataset.homeSource)) return;
    const control = event.target.closest('a,button,input,select,textarea,summary,label,[data-select-menu],[contenteditable="true"]');
    if (control && control !== card && card.contains(control)) return;
    const surface = card.closest('.architecture-overview');
    const radios = [...(surface?.querySelectorAll(selector) || [])];
    const value = card.dataset.homeSource === 'debug' ? 'jlink' : lastHostSource;
    if (!radios.some(radio => radio.value === value && !radio.disabled)) return;
    for (const radio of radios) radio.checked = radio.value === value;
    remember(value);
  };
  const change = event => {
    const radio = event.target;
    if (!radio?.matches?.(selector) || !radio.checked || !radio.closest('.architecture-overview')) return;
    if (hosts.includes(radio.value) || radio.value === 'jlink') remember(radio.value);
  };
  root.addEventListener('click', click);
  root.addEventListener('change', change);
  return () => {
    root.removeEventListener('click', click);
    root.removeEventListener('change', change);
  };
}
