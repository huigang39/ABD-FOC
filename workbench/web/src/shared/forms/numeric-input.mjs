import { esc } from '../esc.mjs';

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
export const readNumericInput = input => parseNumericValue(input.value);
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
  const numeric = event => event.target?.matches?.('input[data-number-input="true"]') ? event.target : null;
  const sync = input => {
    const value = readNumericInput(input);
    if (value !== null && Number.isFinite(value)) input.setAttribute('aria-valuenow', String(value)); else input.removeAttribute('aria-valuenow');
    for (const key of ['min', 'max']) if (input.hasAttribute(key)) input.setAttribute(`aria-value${key}`, input.getAttribute(key));
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
    const start = input.selectionStart, end = input.selectionEnd, value = input.value;
    input.value = value.replaceAll(',', '');
    if (start !== null && end !== null) input.setSelectionRange(value.slice(0,start).replaceAll(',','').length, value.slice(0,end).replaceAll(',','').length);
  };
  const blur = event => { const input = numeric(event); if (input) sync(input); };
  let sequence=0;
  const validate=(input,final=false)=>{
    input.setCustomValidity('');
    const probe=probeFor(input);
    const integer=input.dataset.valueType==='integer'||input.step==='1';
    const message=numericDraftError(input.value,{integer,final})
      ||(probe.validity.rangeUnderflow?`数值不能小于 ${formatNumericValue(input.min)}。`:probe.validity.rangeOverflow?`数值不能大于 ${formatNumericValue(input.max)}。`:probe.validity.stepMismatch?'数值不符合此项的步长要求。':'');
    input.dataset.liveValidation='true';input.setCustomValidity(message);
    const host=input.closest('.form-field')||input.parentElement;
    let note=host.querySelector('[data-live-input-error]');
    if(message){
      if(!note){note=doc.createElement('span');note.className='field-error live-input-error';note.dataset.liveInputError='true';note.id=`live-input-error-${++sequence}`;note.setAttribute('aria-live','polite');host.append(note);input.dataset.liveErrorId=note.id;input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),note.id].filter(Boolean).join(' '));}
      note.textContent=message;input.setAttribute('aria-invalid','true');
    }else if(note){note.remove();input.removeAttribute('aria-invalid');const ids=(input.getAttribute('aria-describedby')||'').split(' ').filter(id=>id&&id!==input.dataset.liveErrorId);if(ids.length)input.setAttribute('aria-describedby',ids.join(' '));else input.removeAttribute('aria-describedby');delete input.dataset.liveErrorId;}
    return message;
  };
  const live=event=>{const input=numeric(event);if(input&&!event.isComposing)validate(input);};
  const change = event => {
    const input = numeric(event); if (!input) return;
    if(validate(input,true))event.stopImmediatePropagation();
    sync(input);
  };
  const keydown = event => {
    const input = numeric(event);
    if (!input || input.disabled || input.readOnly || event.ctrlKey || event.metaKey || event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (Number.isNaN(readNumericInput(input))) return;
    const probe = probeFor(input); if (probe.step === 'any') probe.step = '1';
    if (event.key === 'ArrowUp') probe.stepUp(); else probe.stepDown();
    input.value = probe.value;
    input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true}));
  };
  for (const [type, handler] of [['focusin',focus],['focusout',blur],['input',live],['compositionend',live],['change',change],['keydown',keydown]]) doc.addEventListener(type,handler,true);
  return { refresh(root=doc) { root.querySelectorAll('input[data-number-input="true"]').forEach(sync); } };
}
