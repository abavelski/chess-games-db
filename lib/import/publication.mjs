import { lstatSync, existsSync, readFileSync, writeFileSync, renameSync, linkSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import Database from 'better-sqlite3';
import { hash, fileHash } from './discovery.mjs';
export function assertNew(path) {
 for(const file of [path,...['-wal','-shm','-journal'].map(s=>path+s)]) {
  try{lstatSync(file);throw new Error('Refusing existing output or sidecar: '+file);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
export function assertUpdateTarget(path) {
 const stat=lstatSync(path);
 if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1) throw new Error('Update requires a regular target with no symlink/hardlink aliases');
}
function flush(path) {const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export async function onlineBackup(db,path) {
 assertNew(path);await db.backup(path);flush(path);
 const copy=new Database(path,{readonly:true,fileMustExist:true});
 try {if(copy.pragma('integrity_check',{simple:true})!=='ok' || copy.pragma('foreign_key_check').length) throw new Error('Backup verification failed');}
 finally {copy.close();}
 return {path,sha256:await fileHash(path),verified:true};
}
export function publishArchive(staged,path) {flush(staged);assertNew(path);linkSync(staged,path);unlinkSync(staged);}
export function registryChecksum(path) {return existsSync(path)?hash(readFileSync(path)):null;}
export function publishRegistry(path,registry,expected,runId) {
 if(registryChecksum(path)!==expected) throw new Error('Registry edited since planning; recover proposal from import_runs');
 const temporary=path+'.tmp-'+runId;
 writeFileSync(temporary,JSON.stringify(registry,null,2)+'\n',{flag:'wx'});flush(temporary);
 try {
  if(expected===null) {linkSync(temporary,path);unlinkSync(temporary);}
  else renameSync(temporary,path);
 } finally {try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
