/** Preserve smooth transitions even when a change replaces the entire view. */
const selector = '.switch-field,.module-toggle';
const snapshots = new WeakMap();
const sample = label => {
  const track = label.querySelector('.switch-ui,.module-toggle-pill');
  if (!track) return null;
  const style = getComputedStyle(track), thumb = getComputedStyle(track, '::after');
  return {track, surface:{backgroundColor:style.backgroundColor,boxShadow:style.boxShadow},
    thumb:{left:thumb.left,right:thumb.right,backgroundColor:thumb.backgroundColor,boxShadow:thumb.boxShadow}};
};
for (const eventName of ['pointerdown','keydown']) document.addEventListener(eventName,event=>{
  const label=event.target.closest?.(selector);
  if(label) snapshots.set(label,sample(label));
},true);
document.addEventListener('change',event=>{
  const input=event.target, label=input.closest?.(selector);
  if(input.type!=='checkbox'||!label)return;
  let before=snapshots.get(label);
  // Label activation and keyboard/programmatic clicks may have no pointer snapshot.
  if (!before) {
    label.dataset.switchSampling='true';
    input.checked=!input.checked;
    before=sample(label);
    input.checked=!input.checked;
    delete label.dataset.switchSampling;
  }
  snapshots.delete(label);
  const identity=JSON.stringify(input.dataset);
  const inRuntime=Boolean(label.closest('.runtime-configuration'));
  queueMicrotask(()=>{
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const next=[...document.querySelectorAll('.switch-field input,.module-toggle input')]
      .find(node=>JSON.stringify(node.dataset)===identity && Boolean(node.closest('.runtime-configuration'))===inRuntime);
    const nextLabel=next?.closest(selector);
    if (!nextLabel) return;
    nextLabel.dataset.switchSampling='true';
    const after=sample(nextLabel);
    delete nextLabel.dataset.switchSampling;
    if(!before||!after)return;
    const options={duration:380,easing:'cubic-bezier(.4,0,.2,1)'};
    after.track.animate([before.surface,after.surface],options);
    const track=after.track;
    for(const [key,value] of Object.entries(before.thumb)) track.style.setProperty('--switch-from-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);
    for(const [key,value] of Object.entries(after.thumb)) track.style.setProperty('--switch-to-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);
    delete track.dataset.switchReplay;
    void track.offsetWidth;
    track.dataset.switchReplay='true';
    setTimeout(()=>{if(track.isConnected)delete track.dataset.switchReplay;},420);
  });
},true);
