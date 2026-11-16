/** Animate icon geometry in a fixed viewport, never the button's bounding box. */
const ns='http://www.w3.org/2000/svg';
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let symbols,dirty=true,items=[],last=0;
const node=(name,attrs={})=>{const el=document.createElementNS(ns,name);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);return el;};
fetch('/assets/icons.svg').then(r=>r.text()).then(text=>{symbols=new DOMParser().parseFromString(text,'image/svg+xml');dirty=true;}).catch(()=>{});
new MutationObserver(()=>{dirty=true;}).observe(document.documentElement,{childList:true,subtree:true});
function discover(){
  if(!symbols)return;
  document.querySelectorAll('svg.ui-icon:not([data-live-icon])').forEach(svg=>{
    const use=svg.querySelector('use'),name=use?.getAttribute('href')?.split('#')[1],symbol=symbols.getElementById(name);
    if(!symbol)return;
    svg.dataset.liveIcon=name;
    const group=node('g',{'data-icon-geometry':''});
    if(['wave','algorithm','pulse'].includes(name)){
      if(name!=='algorithm')group.append(node('path',{d:'M3 3v18h18',opacity:'.5'}));
      for(let i=0;i<(name==='algorithm'?3:1);i++)group.append(node('path',{'data-wave-phase':i,fill:'none','stroke-width':name==='algorithm'?'1.35':'1.7',opacity:String(1-i*.18)}));
    }else for(const child of symbol.children)group.append(child.cloneNode(true));
    use.style.display='none';svg.append(group);items.push({svg,group,name});
  });
  items=items.filter(item=>item.svg.isConnected);dirty=false;
}
function frame(time){
  requestAnimationFrame(frame);
  if(time-last<33)return;last=time;
  if(dirty)discover();
  const running=document.documentElement.dataset.iconMotion==='on'&&!reduced.matches&&!document.hidden;
  const t=running?time/1000:0;
  for(const {svg,group,name} of items){
    const rect=svg.getBoundingClientRect();if(rect.bottom<0||rect.top>innerHeight)continue;
    if(['wave','algorithm','pulse'].includes(name)){
      for(const path of group.querySelectorAll('[data-wave-phase]')){
        const phase=Number(path.dataset.wavePhase)*Math.PI*2/3;
        let d='';for(let i=0;i<=48;i++){const x=(name==='algorithm'?2:5)+i*(name==='algorithm'?20:16)/48;const angle=i/48*Math.PI*2-t*2.2+phase;const y=12-5*Math.sin(angle);d+=(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2);}
        path.setAttribute('d',d);
      }
    }else if(['motor','rotor','cycle'].includes(name)){
      // The outer housing remains fixed; only internal geometry rotates.
      const parts=[...group.children];parts.forEach((part,index)=>part.setAttribute('transform',index===0?'':`rotate(${t*35} 12 12)`));
    }else if(['import','export','arrow-right','play'].includes(name)){
      const offset=running?Math.sin(t*2)*1.2:0;
      const part=group.firstElementChild;
      part?.setAttribute('transform',`translate(${['arrow-right','play'].includes(name)?offset:0} ${['import','export'].includes(name)?offset:0})`);
    }else{
      // A moving highlight follows the icon's lines, like a travelling signal.
      for(const path of group.querySelectorAll('path')){
        path.setAttribute('pathLength','100');
        path.style.strokeDasharray=running?'85 15':'';
        path.style.strokeDashoffset=running?String(-t*18):'';
      }
    }
  }
}
requestAnimationFrame(frame);
