import { esc } from '../esc.mjs';
/** Escape every source token before adding presentation markup. */
export function highlightC(source) {
  const tokens=/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|void|static|return|if|else|for|while|struct|typedef|enum|sizeof|volatile|bool|true|false)\b|\b(?:[A-Z][A-Za-z0-9_]*|u?int\d+_t|size_t|float|double)\b|\b(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_]\w*(?=\s*\()/g;
  let html='',last=0;
  for(const match of source.matchAll(tokens)) {
    html+=esc(source.slice(last,match.index));
    const token=match[0];
    const kind=token.startsWith('/*')||token.startsWith('//')?'comment':/^["']/.test(token)?'string':/^(const|void|static|return|if|else|for|while|struct|typedef|enum|sizeof|volatile|bool|true|false)$/.test(token)?'keyword':/^\d/.test(token)?'number':/^[A-Z]|^(u?int\d+_t|size_t|float|double)$/.test(token)?'type':'function';
    html+=`<span class="code-${kind}">${esc(token)}</span>`;last=match.index+token.length;
  }
  return html+esc(source.slice(last));
}
