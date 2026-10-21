import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, existsSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
// The gate serializes lease registration with maintenance acquisition. A desktop
// holds its lease until close; import maintenance refuses all live desktops.
function alive(value) {
 if(value.host!==hostname()) return true;
 try {process.kill(value.pid,0);return true;}catch(error){return error.code!=='ESRCH';}
}
function state(path) {
 const canonical=existsSync(path)?realpathSync(path):resolve(path);
 return {directory:canonical+'.access',gate:canonical+'.access-gate'};
}
function gated(path,fn) {
 const paths=state(path);
 try {mkdirSync(paths.gate);}catch(error){if(error.code==='EEXIST')throw new Error('Archive access gate is busy; retry after other archive operations finish: '+paths.gate);throw error;}
 try {mkdirSync(paths.directory,{recursive:true});return fn(paths.directory);}
 finally {rmdirSync(paths.gate);}
}
function liveLeases(directory) {
 const leases=[];
 for(const name of readdirSync(directory)) {
  const file=join(directory,name);let value;
  try{value=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('Invalid archive lease: '+file);}
  if(alive(value)) leases.push({name,...value});else unlinkSync(file);
 }
 return leases;
}
function acquire(path,maintenance) {
 const name=(maintenance?'maintenance-':'desktop-')+randomUUID()+'.json';
 gated(path,directory=>{
  const leases=liveLeases(directory);
  if(leases.some(l=>l.name.startsWith('maintenance-')) || (maintenance && leases.length)) throw new Error('Archive is in use. Close the desktop and other importers before updating.');
  writeFileSync(join(directory,name),JSON.stringify({pid:process.pid,host:hostname()}),{flag:'wx'});
 });
 let released=false;
 return ()=>{if(released)return;gated(path,directory=>{unlinkSync(join(directory,name));});released=true;};
}
export const desktopLease=path=>acquire(path,false);
export const maintenanceLease=path=>acquire(path,true);
