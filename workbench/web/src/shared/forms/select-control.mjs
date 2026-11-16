const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const isEmptyChoice=value=>value===null||value===undefined||['','unselected','unconfirmed'].includes(String(value));
export const choiceItems=choices=>choices.map(item=>Array.isArray(item)?{value:item[0],label:item[1],disabled:!!item[2]}:typeof item==='object'?item:{value:item,label:item});
export function selectOptions(choices,value) {
  const items=choiceItems(choices).filter(item=>!isEmptyChoice(item.value));
  const selected=String(value??'');
  const known=items.some(item=>String(item.value)===selected);
  const placeholder=!known?`<option value="${escape(selected)}" selected hidden disabled>${isEmptyChoice(value)?'—':escape(selected)}</option>`:'';
  return placeholder+items.map(item=>`<option value="${escape(item.value)}"${String(item.value)===selected?' selected':''}${item.disabled?' disabled':''}${(item.hidden??item.disabled)?' hidden':''}>${escape(item.label)}</option>`).join('');
}
export function isBinaryChoice(choices) {
  const items=choiceItems(choices);
  return items.some(item=>item.value==='unconfirmed')&&items.filter(item=>!isEmptyChoice(item.value)).length===2;
}
export function binaryChoice(choices,value,attributes,{name,label}) {
  const attrs=attributes.replace(/\s*(?:id|aria-label)="[^"]*"/g,'');
  return `<div class="segmented-choice" role="radiogroup" aria-label="${escape(label)}">${choiceItems(choices).filter(item=>!isEmptyChoice(item.value)).map(item=>`<label><input type="radio" name="${escape(name)}" ${attrs} value="${escape(item.value)}"${String(value)===String(item.value)?' checked':''}><span>${escape(item.label)}</span></label>`).join('')}</div>`;
}
