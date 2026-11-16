const TYPES={u8:'uint8_t',u16:'uint16_t',u32:'uint32_t',i16:'int16_t',i32:'int32_t',f32:'float',bool:'bool'};
const RESERVED=new Set('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Alignas _Alignof _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local'.split(' '));
export function cIdentifier(value){return typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(value)&&!RESERVED.has(value);}
const comment=text=>String(text||'').replace(/\*\//g,'* /').replace(/[\r\n]/g,' ');
export function renderStructure(structure){
  if(!structure||!cIdentifier(structure.name))throw Error('结构名称必须是有效的 C 标识符。');
  if(!structure.fields?.length)throw Error(`${structure.name} 没有字段，不能生成空结构。`);
  const seen=new Set();
  return `typedef struct {\n${structure.fields.map(f=>{
    if(!cIdentifier(f.name)||seen.has(f.name)||!TYPES[f.type]||!Number.isSafeInteger(f.count)||f.count<1||f.count>4096)throw Error(`${structure.name} 的字段定义无效：${f.name}`);
    seen.add(f.name);
    return `    ${TYPES[f.type]} ${f.name}${f.count===1?'':`[${f.count}]`}; /* ${comment(f.meaning)} */`;
  }).join('\n')}\n} ${structure.name};\n`;
}
export function moduleStructures(project,moduleId){
  return ['input','output','state'].map(role=>{
    const structure=project.design.structures.find(s=>s.id===project.design.moduleContracts?.[moduleId]?.[role]);
    if(!structure||structure.owner!==moduleId)throw Error(`${moduleId} 的${role}结构未正确绑定。`);
    return structure;
  });
}
export function checkRuntimeLayout(project,module){
  const issues=[];
  let structures;
  try{structures=moduleStructures(project,module.id);}catch(error){return [error.message];}
  for(const [index,role] of ['input','output','state'].entries()){
    const actual=structures[index],expected=module.contracts[role];
    try{renderStructure(actual);}catch(error){issues.push(error.message);continue;}
    if(actual.name!==expected.name||JSON.stringify(actual.fields.map(({name,type,count,unit})=>({name,type,count,unit})))!==JSON.stringify(expected.fields.map(({name,type,count,unit})=>({name,type,count,unit}))))issues.push(`${module.title}的${role}字段与运行实现不一致，需要同步模块代码。`);
  }
  return issues;
}
