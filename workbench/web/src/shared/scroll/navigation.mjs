/** Tabs and selections inside the same workspace retain their scroll position. */
export function navigationContext(hash='') {
  const [path,query='']=hash.replace(/^#\/?/,'').split('?');
  const params=new URLSearchParams(query);
  const parts=path.split('/').filter(Boolean);
  if(parts[0]==='project'&&params.get('module'))return `module:${params.get('module')}:${parts[1]}`;
  if(parts[0]==='equipment')return `equipment:${parts[1]||'assemblies'}`;
  return path;
}
