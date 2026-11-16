import { esc } from '../esc.mjs';
import { compatibleUnits, convertUnit, defaultDisplayUnit, normalizeUnit } from './units.mjs';

const unitStates = new WeakMap();
const draftMessages = new WeakMap();
const inputLabel = input => input.getAttribute('aria-label') || input.closest('.form-field')?.querySelector('.field-label')?.textContent.trim() || '数值';

function draftError(input, message) {
  const { module, edit = '', scope = '', key = '', id = '', child = '', section = '', owner = '' } = input.dataset;
  const host=input.closest('[data-guide-module], [data-parameter-module], [data-module]');
  const moduleId=module||host?.dataset.guideModule||host?.dataset.parameterModule||host?.dataset.module||(edit==='platform-core'?'hw-platform':'');
  return { input, moduleId, label:inputLabel(input), message, scope:edit||scope, key, id, child, section, owner, value:input.value };
}

/** Current invalid drafts only; rejected input has intentionally not changed the project model. */
export function getNumericDraftErrors(root = globalThis.document) {
  return [...(root?.querySelectorAll?.('input[data-number-input="true"]') || [])]
    .filter(input=>input.isConnected!==false&&!input.disabled&&!input.readOnly&&!input.matches?.(':disabled')&&draftMessages.get(input))
    .map(input=>draftError(input,draftMessages.get(input)));
}

const decimal = /^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function parseNumericValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const prefixed=/^([+-]?)(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)$/.exec(text);
  if (prefixed) {
    const number=Number(prefixed[2])*(prefixed[1]==='-'?-1:1);
    return Number.isSafeInteger(number)?number:NaN;
  }
  return decimal.test(text) && Number.isFinite(Number(text.replaceAll(',', ''))) ? Number(text.replaceAll(',', '')) : NaN;
}
export function readNumericInput(input) {
  const value = parseNumericValue(input.value), state = unitStates.get(input);
  if (!state || value === null || !Number.isFinite(value)) return value;
  return value === state.displayValue ? state.canonical : convertUnit(value, state.display, state.base);
}
export const isNumericInput = input => input?.type === 'number' || input?.dataset?.numberInput === 'true';

/** Group the original digits; never round fractional digits or expand exponents. */
export function formatNumericValue(value) {
  const text = String(value ?? '').trim();
  if (!text || !Number.isFinite(parseNumericValue(text))) return text;
  if (/^[+-]?0[xbo]/i.test(text)) return text;
  return text.replaceAll(',', '').replace(/^([+-]?)(\d+)/, (_, sign, digits) => sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
}
export function formatHexValue(value) {
  const number=parseNumericValue(value);
  return number!==null&&Number.isSafeInteger(number)?(number<0?'-':'')+'0x'+Math.abs(number).toString(16).toUpperCase().padStart(4,'0'):String(value??'');
}
export function numericInputAttributes(value, {radix} = {}) {
  const number = parseNumericValue(value);
  return `type="text" inputmode="text" data-number-input="true"${radix === 16 ? ' data-display-radix="16"' : ''} role="spinbutton" autocomplete="off" spellcheck="false" value="${esc(radix === 16 ? formatHexValue(value) : formatNumericValue(value))}"${number === null || !Number.isFinite(number) ? '' : ` aria-valuenow="${esc(number)}"`}`;
}

export function numericDraftError(text,{integer=false,final=false}={}) {
  const raw=String(text??'').trim();
  if(!raw)return '';
  if(!final&&/^[+-]?0[xbo]$/i.test(raw))return '';
  if(!final&&/^(?:[+-]?\.?|[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?)$/.test(raw))return '';
  const value=parseNumericValue(raw);
  if(!Number.isFinite(value))return '请输入有效数值：十进制，或使用 0x、0b、0o 前缀。';
  return integer&&!Number.isSafeInteger(value)?'请输入有效整数。':'';
}

export function installNumericInputs(doc = globalThis.document) {
  const preferences = new Map();
  const numeric = event => event.target?.matches?.('input[data-number-input="true"]') ? event.target : null;
  const displayValue = (input, value) => {
    const state = unitStates.get(input);
    return state ? convertUnit(value, state.base, state.display) : value;
  };
  const setDisplay = (input, canonical) => {
    const state = unitStates.get(input), value = displayValue(input, canonical);
    input.value = value === null ? '' : formatNumericValue(value);
    if (state) { state.canonical = canonical; state.displayValue = value; }
  };
  const enhanceUnit = input => {
    if (unitStates.has(input) || input.dataset.displayRadix) return;
    const wrapper = input.closest('.field-input-wrap'), suffix = wrapper?.querySelector(':scope > .field-unit');
    const base = normalizeUnit(suffix?.textContent), choices = compatibleUnits(base);
    if (choices.length < 2) return;
    const canonical = readNumericInput(input);
    if (canonical !== null && !Number.isFinite(canonical)) return;
    const label=inputLabel(input);
    const key = [doc.defaultView?.location?.hash || '', ...['edit','scope','module','id','child','section','owner','key','nativeField','performanceField','performanceRow','performanceKey'].map(name => input.dataset[name] || ''), label, base].join('|');
    const display = preferences.get(key) || defaultDisplayUnit(base, canonical, `${label} ${input.dataset.key || ''}`);
    const select = doc.createElement('select');
    select.className = 'field-select field-unit-select';
    select.dataset.unitChoice = 'true';
    select.setAttribute('aria-label', `${label}单位`);
    select.disabled = input.disabled || input.readOnly;
    for (const symbol of choices) { const option = doc.createElement('option'); option.value = symbol; option.textContent = symbol; select.append(option); }
    select.value = display;
    suffix.replaceChildren(select); suffix.classList.add('field-unit-picker');
    input.dataset.unitBase = base; input.dataset.unitDisplay = display;
    unitStates.set(input, { base, display, canonical, displayValue: canonical, key, select });
    setDisplay(input, canonical);
  };
  const sync = input => {
    enhanceUnit(input);
    const value = readNumericInput(input);
    const state = unitStates.get(input);
    if (state) { state.select.disabled = input.disabled || input.readOnly; if(value===null||Number.isFinite(value)){state.canonical=value;state.displayValue=parseNumericValue(input.value);} }
    if (value !== null && Number.isFinite(value)) input.setAttribute('aria-valuenow', String(displayValue(input, value))); else input.removeAttribute('aria-valuenow');
    if (state) input.setAttribute('aria-valuetext', `${input.value} ${state.display}`.trim());
    for (const key of ['min', 'max']) if (input.hasAttribute(key)) input.setAttribute(`aria-value${key}`, String(displayValue(input, Number(input.getAttribute(key)))));
    if (doc.activeElement !== input) input.value = input.dataset.displayRadix==='16' ? formatHexValue(input.value) : formatNumericValue(input.value);
  };
  const probeFor = input => {
    const probe = doc.createElement('input'); probe.type = 'number';
    for (const key of ['min', 'max', 'step']) if (input.hasAttribute(key)) probe.setAttribute(key, input.getAttribute(key));
    const value = readNumericInput(input); probe.value = value === null || !Number.isFinite(value) ? '' : String(value);
    return probe;
  };
  const focus = event => {
    const input = numeric(event); if (!input) return;
    if (Number.isNaN(readNumericInput(input))) return;
    // Let the browser finish focus/select-all before changing the displayed text.
    queueMicrotask(()=>{
      if(doc.activeElement!==input||!input.isConnected)return;
      const start = input.selectionStart, end = input.selectionEnd, value = input.value;
      if (!value.includes(',')) return;
      input.value = value.replaceAll(',', '');
      if (start !== null && end !== null) input.setSelectionRange(value.slice(0,start).replaceAll(',','').length, value.slice(0,end).replaceAll(',','').length);
    });
  };
  const blur = event => { const input = numeric(event); if (input) sync(input); };
  let sequence=0;
  const validate=(input,final=false)=>{
    input.setCustomValidity('');
    const probe=probeFor(input);
    const integer=input.dataset.valueType==='integer'||input.step==='1';
    const canonical=readNumericInput(input), state=unitStates.get(input);
    const limit=value=>`${formatNumericValue(displayValue(input,Number(value)))}${state?' '+state.display:''}`;
    const message=numericDraftError(input.value,{integer:integer&&!state,final})
      ||(state&&Number.isFinite(parseNumericValue(input.value))&&!Number.isFinite(canonical)?'数值超出可表示范围。':'')
      ||(state&&integer&&Number.isFinite(canonical)&&!Number.isSafeInteger(canonical)?`按 ${state.base} 换算后必须为整数。`:'')
      ||(probe.validity.rangeUnderflow?`数值不能小于 ${limit(input.min)}。`:probe.validity.rangeOverflow?`数值不能大于 ${limit(input.max)}。`:probe.validity.stepMismatch?'数值不符合此项的步长要求。':'');
    input.dataset.liveValidation='true';input.setCustomValidity(message);
    const host=input.closest('.form-field')||input.parentElement;
    let note=host.querySelector('[data-live-input-error]');
    if(message){
      if(!note){note=doc.createElement('span');note.className='field-error live-input-error';note.dataset.liveInputError='true';note.id=`live-input-error-${++sequence}`;note.setAttribute('aria-live','polite');host.append(note);input.dataset.liveErrorId=note.id;input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),note.id].filter(Boolean).join(' '));}
      note.textContent=message;input.setAttribute('aria-invalid','true');
    }else if(note){note.remove();input.removeAttribute('aria-invalid');const ids=(input.getAttribute('aria-describedby')||'').split(' ').filter(id=>id&&id!==input.dataset.liveErrorId);if(ids.length)input.setAttribute('aria-describedby',ids.join(' '));else input.removeAttribute('aria-describedby');delete input.dataset.liveErrorId;}
    const previous=draftMessages.get(input)||'';
    if(message)draftMessages.set(input,message);else draftMessages.delete(input);
    if(message!==previous) {
      const EventClass=doc.defaultView?.CustomEvent||globalThis.CustomEvent;
      input.dispatchEvent(new EventClass('numeric-draft-change',{bubbles:true,detail:{input,error:message?draftError(input,message):null}}));
    }
    return message;
  };
  const live=event=>{const input=numeric(event);if(input&&!event.isComposing)validate(input);};
  const change = event => {
    if(event.target?.matches?.('select[data-unit-choice="true"]')) {
      event.stopImmediatePropagation();
      const select=event.target, input=select.closest('.field-input-wrap')?.querySelector('input[data-number-input="true"]'), state=unitStates.get(input);
      if(!state)return;
      const value=readNumericInput(input);
      const converted=convertUnit(value,state.base,select.value);
      if(validate(input,true)||!compatibleUnits(state.base).includes(select.value)||(converted!==null&&!Number.isFinite(converted))){select.value=state.display;select.closest('[data-select-menu]')?.updateTrigger?.();input.reportValidity();return;}
      state.display=select.value;input.dataset.unitDisplay=state.display;preferences.set(state.key,state.display);
      setDisplay(input,value);sync(input);return;
    }
    const input = numeric(event); if (!input) return;
    if(validate(input,true))event.stopImmediatePropagation();
    sync(input);
  };
  const keydown = event => {
    const input = numeric(event);
    if (!input || input.disabled || input.readOnly || event.ctrlKey || event.metaKey || event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (Number.isNaN(readNumericInput(input))) return;
    const probe = probeFor(input), state=unitStates.get(input);
    if(probe.step==='any'&&state) {
      let next=convertUnit((parseNumericValue(input.value)??0)+(event.key==='ArrowUp'?1:-1),state.display,state.base);
      if(!Number.isFinite(next))return;
      if(input.hasAttribute('min'))next=Math.max(next,Number(input.min));
      if(input.hasAttribute('max'))next=Math.min(next,Number(input.max));
      setDisplay(input,next);
    } else {
      if(probe.step==='any')probe.step='1';
      if (event.key === 'ArrowUp') probe.stepUp(); else probe.stepDown();
      setDisplay(input,parseNumericValue(probe.value));
    }
    input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true}));
  };
  for (const [type, handler] of [['focusin',focus],['focusout',blur],['input',live],['compositionend',live],['change',change],['keydown',keydown]]) doc.addEventListener(type,handler,true);
  return {
    refresh(root=doc) { root.querySelectorAll('input[data-number-input="true"]').forEach(sync); },
    setValue(input, canonical) { enhanceUnit(input);setDisplay(input,canonical);if(input.dataset.liveValidation==='true')validate(input,true);sync(input); },
    getDraftErrors(root=doc) { return getNumericDraftErrors(root); },
  };
}
