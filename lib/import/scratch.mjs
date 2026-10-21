import { readdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
export function markScratch(path) {writeFileSync(join(path,'.owner.json'),JSON.stringify({pid:process.pid,host:hostname()}),{flag:'wx'});}
export function cleanAbandonedScratch(parent) {
 for(const item of readdirSync(parent,{withFileTypes:true})) {
  if(!item.isDirectory() || !item.name.startsWith('.unified-import-'))continue;
  const directory=join(parent,item.name);
  try {
   const names=readdirSync(directory).filter(n=>n==='.owner.json' || /^\.worker-\d+\.json$/.test(n));
   if(!names.includes('.owner.json'))continue;
   const inactive=names.every(name=>{
    const value=JSON.parse(readFileSync(join(directory,name),'utf8'));
    if(value.host!==hostname() || !Number.isSafeInteger(value.pid) || value.pid<1)return false;
    try {process.kill(value.pid,0);return false;}catch(error){return error.code==='ESRCH';}
   });
   if(inactive)rmSync(directory,{recursive:true,force:true});
  } catch { /* Unrecognized directories are never removed. */ }
 }
}
