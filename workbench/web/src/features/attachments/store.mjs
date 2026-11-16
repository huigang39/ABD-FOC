let connection;
function database() {
  return connection ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('abd-foc-attachments',1);
    request.onupgradeneeded=()=>{ const store=request.result.createObjectStore('firmware',{keyPath:'id'}); store.createIndex('versionKey','versionKey',{unique:true}); };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{connection=null;reject(request.error);};
  });
}
export async function firmwareStore(operation, value) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('firmware',operation==='put'?'readwrite':'readonly');
    const store=tx.objectStore('firmware');
    const request=operation==='put'?store.put(value):operation==='get'?store.get(value):store.getAll();
    tx.oncomplete=()=>resolve(request.result);
    tx.onabort=()=>reject(tx.error || request.error || new Error('附件保存失败。'));
    tx.onerror=()=>{};
  });
}
