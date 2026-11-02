import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerPersonalStudies } from '../electron/personal-studies.mjs';

test('IPC is lazy, allowlisted, validates requests, and closes storage',()=>{
 const dir=mkdtempSync(join(tmpdir(),'study-ipc-')),handlers=new Map();
 const service=registerPersonalStudies({app:{getPath:()=>dir},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},authorize:event=>event.sender==='trusted'});
 const call=(name,request,sender='trusted')=>handlers.get('personal-studies:'+name)({sender},request);
 try {
  assert.equal(existsSync(join(dir,'personal-studies.sqlite3')),false);
  assert.equal(handlers.has('personal-studies:sql'),false);
  assert.throws(()=>call('status',null,'foreign'),/denied/);
  assert.throws(()=>call('get',{id:'x',path:'arbitrary'}),/fields/);
  const a=call('create',{title:'IPC study'});assert.equal(call('get',{id:a.id}).title,'IPC study');
  assert.throws(()=>call('get',{id:'missing'}),/not found/);
  assert.equal(call('status').path,join(dir,'personal-studies.sqlite3'));
 } finally {service.close();rmSync(dir,{recursive:true,force:true});}
});
