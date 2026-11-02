import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
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
test('file import cancels without storage, bounds bytes, rejects invalid UTF-8 and multiple games',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'study-file-')),path=join(dir,'input.pgn'),handlers=new Map();let canceled=true;
 const service=registerPersonalStudies({app:{getPath:()=>dir},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},authorize:()=>true,getWindow:()=>null,dialog:{showOpenDialog:async()=>({canceled,filePaths:[path]})}});
 const open=()=>handlers.get('personal-studies:openPgn')({},undefined);
 try{
  assert.deepEqual(await open(),{canceled:true});canceled=false;
  for(const data of ['1. e4 *\n\n1. d4 *','x'.repeat(2097153),Buffer.from([0xff,0xfe])]){writeFileSync(path,data);await assert.rejects(open());}
  writeFileSync(path,'1. e4 {[%cal Ge2e4]} *');assert.equal((await open()).pgn,'1. e4 {[%cal Ge2e4]} *');
  assert.equal(existsSync(join(dir,'personal-studies.sqlite3')),false);
 }finally{service.close();rmSync(dir,{recursive:true,force:true});}
});
