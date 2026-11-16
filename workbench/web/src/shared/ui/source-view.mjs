import { highlightC } from './code-highlight.mjs';
const pending=new Map();
async function source(moduleId) {
  if(!pending.has(moduleId))pending.set(moduleId,fetch('/api/module-source?module='+encodeURIComponent(moduleId)).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'源码读取失败');return data;}).catch(error=>{pending.delete(moduleId);throw error;}));
  return pending.get(moduleId);
}
export function installSourceView(doc,notify) {
  async function load(panel) {
    const host=panel.querySelector('[data-source-body]');if(!host||host.dataset.loaded||host.dataset.loading)return;
    host.dataset.loading='true';host.textContent='正在读取实现源码…';
    try {const data=await source(panel.dataset.sourceModule);const pre=doc.createElement('pre');pre.className='syntax-code implementation-code';const code=doc.createElement('code');code.innerHTML=highlightC(data.content);pre.append(code);host.replaceChildren(pre);host.dataset.loaded='true';}
    catch(error){host.textContent='';const retry=doc.createElement('button');retry.type='button';retry.className='button small';retry.textContent='重新读取源码';retry.onclick=()=>load(panel);host.append(retry);notify(error.message,{level:'error'});}
    finally{delete host.dataset.loading;}
  }
  doc.addEventListener('toggle',event=>{if(event.target.matches?.('.interface-source[data-source-module]')&&event.target.open)load(event.target);},true);
}
