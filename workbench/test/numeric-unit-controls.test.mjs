import test from 'node:test';
import assert from 'node:assert/strict';
import { installNumericInputs, readNumericInput } from '../web/src/shared/forms/numeric-input.mjs';

// Minimal DOM adapter. Number probes retain the browser's min-anchored step grid;
// this catches unit stepping bugs without a browser dependency in node --test.
function setup() {
  const listeners=new Map(), commits=[];
  const doc={activeElement:null,defaultView:{location:{hash:'#/numeric-test'}},addEventListener:(type,fn)=>listeners.set(type,fn)};
  const fire=(type,target,extra={})=>{
    const event={type,target,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    listeners.get(type)?.(event);
    if(type==='change'&&!event.stopped&&target.dataset.numberInput==='true')commits.push(readNumericInput(target));
    return event;
  };
  function element(tag) {
    const attrs=new Map();
    const node={localName:tag,type:'',value:'',className:'',dataset:{},children:[],parentElement:null,disabled:false,readOnly:false,validationMessage:'',textContent:'',selectionStart:0,selectionEnd:0,
      append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},
      replaceChildren(...children){this.children=[];this.append(...children);},
      remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);},
      getAttribute:key=>attrs.get(key)??null,hasAttribute:key=>attrs.has(key),setAttribute:(key,value)=>attrs.set(key,String(value)),removeAttribute:key=>attrs.delete(key),
      setCustomValidity(message){this.validationMessage=message;},reportValidity(){return !this.validationMessage;},
      setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
      dispatchEvent(event){return !fire(event.type,this,{key:event.key,detail:event.detail}).defaultPrevented;},
      matches(selector){
        if(selector.includes(','))return selector.split(',').some(part=>this.matches(part.trim()));
        if(/^\[data-(guide-module|parameter-module|module)\]$/.test(selector)){const key=selector.slice(6,-1).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return this.dataset[key]!==undefined;}
        if(selector===':disabled')return this.disabled;
        if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));
        if(selector==='[data-live-input-error]')return this.dataset.liveInputError==='true';
        return selector==='input[data-number-input="true"]'?tag==='input'&&this.dataset.numberInput==='true':selector==='select[data-unit-choice="true"]'?tag==='select'&&this.dataset.unitChoice==='true':false;
      },
      closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;},
      querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);},
      querySelector(selector){return selector.startsWith(':scope > ')?this.children.find(child=>child.matches(selector.slice(9)))||null:this.querySelectorAll(selector)[0]||null;},
    };
    node.classList={add(...classes){node.className=[...new Set([...node.className.split(' '),...classes])].filter(Boolean).join(' ');}};
    for(const key of ['min','max','step'])Object.defineProperty(node,key,{get:()=>attrs.get(key)||'',set:value=>attrs.set(key,String(value))});
    const grid=()=>({value:Number(node.value),min:node.min===''?-Infinity:Number(node.min),max:node.max===''?Infinity:Number(node.max),step:node.step==='any'?null:Number(node.step||1),base:node.min===''?0:Number(node.min)});
    Object.defineProperty(node,'validity',{get(){const {value,min,max,step,base}=grid(),q=(value-base)/step;return {rangeUnderflow:node.value!==''&&value<min,rangeOverflow:node.value!==''&&value>max,stepMismatch:node.value!==''&&step!==null&&Math.abs(q-Math.round(q))>1e-8};}});
    const stepBy=direction=>{const {value,min,max,step,base}=grid();assert(step>0);const quotient=(value-base)/step;const index=direction>0?Math.floor(quotient+1e-10)+1:Math.ceil(quotient-1e-10)-1;node.value=String(Math.max(min,Math.min(max,base+index*step)));};
    node.stepUp=()=>stepBy(1);node.stepDown=()=>stepBy(-1);
    return node;
  }
  const body=element('body');doc.createElement=element;doc.querySelectorAll=selector=>body.querySelectorAll(selector);
  const helper=installNumericInputs(doc);
  const field=(value,unit,{label='数值',...attributes}={})=>{
    const host=element('div'),caption=element('span'),wrapper=element('div'),input=element('input'),suffix=element('span');
    host.className='form-field';caption.className='field-label';caption.textContent=label;wrapper.className='field-input-wrap';suffix.className='field-unit';suffix.textContent=unit;
    input.type='text';input.dataset.numberInput='true';input.value=String(value??'');input.step='any';
    for(const [key,value] of Object.entries(attributes))if(key==='integer')input.dataset.valueType=value?'integer':'number';else input.setAttribute(key,value);
    wrapper.append(input,suffix);host.append(caption,wrapper);body.append(host);helper.refresh(host);return input;
  };
  const choose=(input,unit)=>{const select=input.parentElement.querySelector('select[data-unit-choice="true"]');assert(select);select.value=unit;return fire('change',select);};
  const enter=(input,value)=>{doc.activeElement=input;input.value=value;fire('input',input);fire('change',input);doc.activeElement=null;fire('focusout',input);};
  const arrow=(input,key)=>fire('keydown',input,{key});
  return {doc,helper,field,choose,enter,arrow,commits};
}

test('unit choices do not commit or drift the canonical angle or affine temperature value',()=>{
  for(const [value,base,units] of [[Math.PI/7,'rad',['°','arcmin','rad']],[37.123456789,'°C',['°F','K','°C']],[-40,'°C',['K','°F','°C']]]) {
    const {field,choose,helper,commits}=setup(),input=field(value,base);
    for(let count=0;count<50;count++)for(const unit of units){choose(input,unit);helper.refresh();assert.equal(readNumericInput(input),value);}
    assert.deepEqual(commits,[],'unit selection does not emit a project-value change');
  }
});

test('any-step arrows add one displayed unit without snapping to a canonical min grid',()=>{
  const {field,arrow,helper}=setup(),input=field(400000000,'Hz',{label:'主频',min:1,max:480000000});
  assert.equal(input.value,'400');arrow(input,'ArrowUp');assert.equal(readNumericInput(input),401000000);assert.equal(input.value,'401');
  helper.setValue(input,400000000);arrow(input,'ArrowDown');assert.equal(readNumericInput(input),399000000);
  helper.setValue(input,480000000);arrow(input,'ArrowUp');assert.equal(readNumericInput(input),480000000);
  helper.setValue(input,1);arrow(input,'ArrowDown');assert.equal(readNumericInput(input),1);
});

test('any-step angles and temperatures preserve the fractional display part when stepping',()=>{
  const {field,choose,arrow}=setup(),angle=field(Math.PI/7,'rad');choose(angle,'°');
  const before=Number(angle.value);arrow(angle,'ArrowUp');assert(Math.abs(Number(angle.value)-(before+1))<1e-12);
  const temperature=field(20,'°C');choose(temperature,'°F');arrow(temperature,'ArrowUp');
  assert(Math.abs(readNumericInput(temperature)-(20+5/9))<1e-12);
});

test('explicit steps and integer constraints remain in canonical units after display conversion',()=>{
  const {field,choose,enter,arrow,commits}=setup(),period=field(333,'μs',{min:1,max:2000,step:1,integer:true});choose(period,'ms');
  enter(period,'1.5');assert.equal(readNumericInput(period),1500);assert.equal(period.validationMessage,'');assert.equal(commits.at(-1),1500);
  arrow(period,'ArrowUp');assert.equal(readNumericInput(period),1501,'one stored μs, not one displayed ms');
  const count=commits.length;enter(period,'0.0001');assert.match(period.validationMessage,/整数/);assert.equal(commits.length,count);
  enter(period,'3');assert.match(period.validationMessage,/大于/);assert.equal(commits.length,count);
  const current=field(1,'A',{min:0,step:0.1});choose(current,'mA');enter(current,'1,250');assert.match(current.validationMessage,/步长/);
  enter(current,'1,200');assert.equal(current.validationMessage,'');assert.equal(readNumericInput(current),1.2);
});

test('blur commits converted values, while refresh, setValue and rerender never multiply them again',()=>{
  const {field,choose,enter,helper,commits}=setup(),input=field(400000000,'Hz',{label:'主频',min:1});
  choose(input,'kHz');enter(input,'399500');assert.equal(commits.at(-1),399500000);
  for(let index=0;index<50;index++){helper.refresh();helper.setValue(input,399500000);assert.equal(readNumericInput(input),399500000);}
  const recreated=field(399500000,'Hz',{label:'主频',min:1});assert.equal(recreated.dataset.unitDisplay,'kHz');assert.equal(recreated.value,'399,500');
  assert.equal(readNumericInput(recreated),399500000);
});

test('invalid input and overflowing unit choices never commit another finite value',()=>{
  const {field,choose,enter,commits}=setup(),input=field(1e308,'A');choose(input,'mA');
  assert.equal(input.dataset.unitDisplay,'A');assert.equal(readNumericInput(input),1e308);assert.deepEqual(commits,[]);
  for(const text of ['1e999','NaN','Infinity','1,2','-']){enter(input,text);assert(input.validationMessage);assert.deepEqual(commits,[]);}
});

test('live draft errors expose module context and emit only error-state changes without committing invalid data',()=>{
  const {doc,field,enter,helper,commits}=setup(),input=field(400000000,'Hz',{label:'内核时钟',min:1,max:480000000});
  Object.assign(input.dataset,{edit:'platform-core',key:'clockHz',child:'cm7'});
  const events=[];doc.addEventListener('numeric-draft-change',event=>events.push(event.detail));
  enter(input,'900');
  const [error]=helper.getDraftErrors();
  assert.equal(error.input,input);assert.equal(error.moduleId,'hw-platform');assert.equal(error.scope,'platform-core');assert.equal(error.child,'cm7');assert.equal(error.key,'clockHz');
  assert.equal(error.label,'内核时钟');assert.match(error.message,/480 MHz/);assert.equal(error.value,'900');
  assert.equal(events.length,1,'input + change with the same error emits once');assert.equal(events[0].error.message,error.message);assert.deepEqual(commits,[]);
  enter(input,'450');assert.deepEqual(helper.getDraftErrors(),[]);assert.equal(events.at(-1).error,null);assert.equal(commits.at(-1),450000000);
  enter(input,'900');helper.setValue(input,400000000);assert.deepEqual(helper.getDraftErrors(),[]);assert.equal(events.at(-1).error,null);
});

test('draft error collection follows standalone module context and excludes disabled or removed fields',()=>{
  const {field,enter,helper}=setup(),input=field(1000,'μs',{min:1});
  const host=input.closest('.form-field');host.dataset.parameterModule='app-runtime';input.dataset.key='periodUs';
  enter(input,'-2');assert.equal(helper.getDraftErrors()[0].moduleId,'app-runtime');
  input.disabled=true;assert.deepEqual(helper.getDraftErrors(),[]);input.disabled=false;
  input.readOnly=true;assert.deepEqual(helper.getDraftErrors(),[]);input.readOnly=false;
  assert.equal(helper.getDraftErrors().length,1);host.remove();assert.deepEqual(helper.getDraftErrors(),[]);
});
