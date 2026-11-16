export function createAlgorithmPath() {
 return {id:crypto.randomUUID(),name:'新保护路径',field:'',operator:'gt',threshold:null,comparisonSource:'constant',comparisonField:'',action:'disable_output',triggerDurationMs:0,recoveryDurationMs:0,compiled:true,enabled:true};
}
export function checkAlgorithmPaths(paths) {
 if(!Array.isArray(paths)||paths.length>32)throw Error('算法保护路径最多 32 项。');
 const ids=new Set();
 for(const p of paths){
  if(!p||Object.keys(p).sort().join(',')!=='action,comparisonField,comparisonSource,compiled,enabled,field,id,name,operator,recoveryDurationMs,threshold,triggerDurationMs'||typeof p.id!=='string'||!p.id||ids.has(p.id))throw Error('算法保护路径格式或标识无效。');
  ids.add(p.id);
  if(!['constant','field'].includes(p.comparisonSource)||typeof p.comparisonField!=='string')throw Error('比较值来源无效。');
  for(const key of ['triggerDurationMs','recoveryDurationMs'])if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<0)throw Error('触发时长和恢复时长必须为非负有限数值。');
  if(!['disable_output','report','asc'].includes(p.action)||typeof p.enabled!=='boolean'||typeof p.compiled!=='boolean'||typeof p.name!=='string'||typeof p.field!=='string'||!['gt','lt','abs_gt','eq','ne','invalid'].includes(p.operator)||!(p.threshold===null||typeof p.threshold==='number'&&Number.isFinite(p.threshold)))throw Error('算法保护路径参数无效。');
 }
}
export function algorithmPathIssues(project) {
 const paths=project.instances['foc-lifecycle'].parameters.protectionPaths||[],issues=[];
 const add=(id,level,message)=>issues.push({id:'algorithm-path-'+id,level,title:'算法保护路径',message,moduleId:'foc-lifecycle',paramKey:'protectionPaths'});
 try{checkAlgorithmPaths(paths);}catch(e){add('shape','error',e.message);return issues;}
 for(const p of paths.filter(p=>p.compiled&&p.enabled)){
  {
    const field=algorithmFields(project).find(field=>field.id===p.field);
    if(!field)add(p.id+'-field','pending','选择已编译模块中的数据字段。');
    if(p.operator!=='invalid'&&p.comparisonSource==='constant'&&p.threshold===null)add(p.id+'-threshold','pending','填写比较值。');
    if(field?.type==='bool'&&!['eq','ne'].includes(p.operator))add(p.id+'-operator','error','布尔字段使用等于或不等于条件。');
  }
  const needsValue=p.operator!=='invalid';
  if(needsValue&&p.comparisonSource==='field'){
    const available=algorithmFields(project),left=available.find(field=>field.id===p.field),right=available.find(field=>field.id===p.comparisonField);
    if(!right)add(p.id+'-comparison','pending','选择有效的比较数据字段。');
    else {
      const unit=left?.unit;
      if(unit!==undefined&&unit!==right.unit)add(p.id+'-unit','error','两侧字段单位不一致，需先换算到相同单位。');
      if(left&&((left.type==='bool')!==(right.type==='bool')))add(p.id+'-type','error','布尔字段与数值字段不能直接比较。');
    }
  }
  if(p.action==='asc')add(p.id+'-asc','error','三相短路制动需要独立的功率级适配与进入、退出逻辑；当前尚未接入，不能生成可用制动代码。');
 }
 if(paths.some(p=>p.compiled))add('implementation','error','自定义算法保护路径尚未接入生成器，不能据此生成可用保护代码。');
 return issues;
}

export function algorithmFields(project) {
 const fields=[];
 for(const structure of project.design.structures){
  if(!project.instances[structure.owner]?.enabled)continue;
  for(const field of structure.fields||[]){
   if(!/^(bool|[fiu](8|16|32|64))$/.test(field.type))continue;
   for(let index=0;index<Math.min(field.count||1,256);index++)fields.push({
    id:structure.id+':'+field.id+':'+index,
    label:structure.name+'.'+field.name+((field.count||1)>1?'['+index+']':''),
    type:field.type,unit:field.unit||''
   });
  }
 }
 return fields;
}
