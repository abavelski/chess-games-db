import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function applyInWorker(path,stagePath,entry,extraction,options,signal) {
 if(signal?.aborted) return Promise.reject(new Error('Import cancelled'));
 return new Promise((resolve,reject)=>{
  const child=fork(fileURLToPath(new URL('../../scripts/import-apply-worker.mjs',import.meta.url)),[],{stdio:['ignore','ignore','inherit','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  writeFileSync(join(dirname(stagePath),`.worker-${child.pid}.json`),JSON.stringify({pid:child.pid,host:hostname()}));
  let message;
  const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
  child.once('message',value=>{message=value;});
  child.once('error',reject);
  child.once('exit',(code)=>{
   signal?.removeEventListener('abort',abort);
   if(code===0 && message?.result)resolve(message.result);
   else reject(new Error(message?.error??(signal?.aborted?'Import cancelled':'Source apply worker failed')));
  });
  child.send({path,stagePath,entry,extraction,options});
 });
}
