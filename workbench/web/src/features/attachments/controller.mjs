import {createFirmwareBundle} from './bundles.mjs';
import { firmwareMetadata, validateFirmwareFile } from './model.mjs';
import { firmwareStore } from './store.mjs';
export function createFirmwareLibrary({render,notify,doc=document}) {
  const state={records:[],bundles:[],componentKind:'',kind:'',tag:'',editId:'',busy:false,loading:true,error:false};
  const active=()=>Boolean(doc.querySelector('.shelf-navigation'));
  const refresh=()=>{if(active())render();};
  const error=err=>notify(err.name==='ConstraintError'?'此固件的型号和版本已存在，请编辑已有版本或使用新的版本号。':err.message||'附件操作失败。',{level:'error'});
  async function reload() {
    const entries=(await firmwareStore('list')).map(({file,...metadata})=>metadata);
    state.records=entries.filter(item=>item.kind!=='bundle');state.bundles=entries.filter(item=>item.kind==='bundle');
  }
  reload().then(()=>{state.loading=false;refresh();}).catch(err=>{state.loading=false;state.error=true;if(active())error(err);refresh();});
  doc.addEventListener('change',event=>{
    const key=event.target.dataset.firmwareFilter;
    if(key){state[key]=event.target.value;refresh();}
  });
  doc.addEventListener('click',async event=>{
    const category=event.target.closest('[data-firmware-component-kind]');
    if(category){state.componentKind=state.componentKind===category.dataset.firmwareComponentKind?'':category.dataset.firmwareComponentKind;state.editId='';location.hash='#/equipment/firmware';refresh();return;}
    const kind=event.target.closest('[data-firmware-kind]');
    if(kind){state.kind=state.kind===kind.dataset.firmwareKind?'':kind.dataset.firmwareKind;refresh();return;}
    const tag=event.target.closest('[data-firmware-tag]');
    if(tag){const input=tag.closest('form').elements.tags;input.value=[...new Set([...input.value.split(/[,，\s]+/).filter(Boolean),tag.dataset.firmwareTag])].join(', ');return;}
    const button=event.target.closest('[data-firmware-action]');
    if(!button||state.busy)return;
    const action=button.dataset.firmwareAction;
    if(action==='edit'){state.editId=button.dataset.id;refresh();doc.querySelector('.firmware-upload')?.scrollIntoView({block:'start'});}
    if(action==='cancel'){state.editId='';refresh();}
    if(action==='download')try {
      const record=await firmwareStore('get',button.dataset.id);
      if(!record?.file)throw new Error('固件文件不存在。');
      const url=URL.createObjectURL(record.file),link=doc.createElement('a');link.href=url;link.download=record.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }catch(err){error(err);}
  });
  doc.addEventListener('submit',async event=>{
    const bundleForm=event.target.closest('[data-firmware-bundle-form]');
    if(bundleForm){event.preventDefault();if(state.busy)return;state.busy=true;const submit=bundleForm.querySelector('[type=submit]');submit.disabled=true;try{const bundle=createFirmwareBundle(Object.fromEntries(new FormData(bundleForm)),state.records);await firmwareStore('put',bundle);await reload();location.hash='#/equipment/firmware/'+bundle.id;notify('固件组合已保存',{level:'success'});refresh();}catch(err){error(err);}finally{state.busy=false;submit.disabled=false;}return;}
    const form=event.target.closest('[data-firmware-form]');if(!form)return;
    event.preventDefault();if(state.busy)return;
    const submit=form.querySelector('[type="submit"]');
    state.busy=true;submit.disabled=true;submit.textContent='正在保存…';
    try {
      const metadata=firmwareMetadata(Object.fromEntries(new FormData(form)));
      const old=state.editId?await firmwareStore('get',state.editId):null;
      if(old&&state.bundles.some(bundle=>bundle.components.some(part=>part.id===old.id)))throw Error('此版本已被固件组合引用，请添加新版本，避免改变已有组合。');
      const selected=form.elements.file.files[0],file=selected||old?.file;
      validateFirmwareFile(file);
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
      await firmwareStore('put',{...metadata,id:old?.id||crypto.randomUUID(),file,filename:file.name,size:file.size,sha256,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()});
      state.editId='';await reload();state.error=false;state.componentKind='';location.hash='#/equipment/firmware';
      notify('固件版本已保存',{level:'success'});state.busy=false;refresh();
    }catch(err){error(err);}finally{state.busy=false;if(submit.isConnected){submit.disabled=false;submit.textContent='保存版本';}}
  });
  return state;
}
